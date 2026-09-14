import { EngineError } from '@game/shared';
import type { CompiledExpr, EffectData, ExprFunctionRegistry, GameId, TextKey } from '@game/shared';
import { compileExpr } from '../expr-eval/index.js';
import { createBuiltinFunctionRegistry } from '../expr-eval/index.js';
import type { InterpVars } from '../i18n/index.js';
import type { CompiledScene } from '../loader/index.js';
import type { MediaIntent } from '../runtime/index.js';
import type { ChoiceDef } from '@game/shared';
import { expandMacro, parseMacro } from './macros.js';
import type { MacroExpansionContext, NarrativeMacro } from './macros.js';
import type { ExecContext, ExecOutcome, JumpTarget } from '../runtime/index.js';
import type {
  ChoiceView,
  NarrativeContentFilter,
  NarrativeEndReason,
  NarrativeHistoryEntry,
  NarrativeWarning,
  RenderSegment,
  RunnerPhase,
  SceneRunnerDef,
  SceneRunnerOptions,
  SceneRunnerRuntime,
} from './types.js';

/**
 * 场景会话状态机（设计 §4.2，08 号模块 A 组：五相位骨架）。
 *
 * 叙事是「会话」而非全局单例（§4.2）：主叙事、回想重放（FR-GAL-01 只读）、
 * 事件子会话共用本状态机。相位迁移严格遵循 §4.2 状态机图：
 *
 * ```
 * [*] ──构造──▶ entering ──首段渲染列表就绪──▶ await_advance
 * await_advance ──advance()（还有段落）──▶ await_advance
 * await_advance ──段落尽且存在可见选项──▶ await_choice
 * await_advance ──段落尽且无可见选项──▶ finished（endReason='exhausted'）
 * await_choice ──choose(id)──▶ resolving
 * resolving ──jumps.scene──▶ entering（新场景帧；事件场景压栈见 C 组）
 * resolving ──jumps.ending / back / loop_transition──▶ finished（记录终态类型）
 * ```
 *
 * 相位语义与错误契约：
 * - `entering`：帧已建立、段落流未展开——首调 {@link renderList} 完成展开
 *   （宏惰性求值点，B 组）并迁移 `await_advance`；`advance()` 在此相位抛错；
 * - `await_advance`：{@link advance} 依次揭示后续段落（`renderList` 返回前缀）；
 *   段落已尽时的一次 `advance()` 触发终局迁移（有可见选项 → `await_choice`，
 *   否则 `finished`）；
 * - `await_choice`：{@link choices} 给出可用选项，{@link choose} 消费一次选择；
 * - `resolving`：choose 的执行中相位——同步流程本不可观测，作为**错误挂起态**
 *   保留可观测语义：choose 内部执行/迁移失败（事务已原子回滚或迁移目标非法）
 *   时会话停留在 `resolving`，由宿主经 GameRuntime.rollback 恢复（FR-READ-03
 *   「选择前打回滚点」的配套约定）；入参校验失败（相位/未知选项）则在进入
 *   `resolving` 之前抛出，相位不变；
 * - `finished`：终态，advance/choose 抛错；renderList 返回最后一次渲染列表。
 *
 * 渲染模型（A 组最小面，B/C 组增量扩展）：场景段落数据（segments）经 show_if
 * 过滤后构成段落流，renderList 返回已揭示前缀；宏展开（FR-NARR-04）、场景级
 * 媒体绑定（FR-NARR-01）在后续子任务接入。文本一律键 + 延迟插值 vars（D4），
 * 字符串物化由宿主经 TextResolver 完成（§4.1，engine 不做文本层求值）。
 */
export class SceneRunner {
  readonly #rt: SceneRunnerRuntime;
  readonly #def: SceneRunnerDef;
  readonly #readonlySession: boolean;
  readonly #paramsSource: SceneRunnerOptions['params'];
  readonly #onWarn: ((warning: NarrativeWarning) => void) | undefined;
  /** 内容过滤器（§5.8 应用点 2/3；缺省 = 不过滤段落，选项沿用 08 号直查语义） */
  readonly #contentFilter: NarrativeContentFilter | undefined;
  /** 事件场景 id 集（def.events 声明的 event.scene，§4.2 子会话判定面） */
  readonly #eventSceneIds: ReadonlySet<GameId>;

  #phase: RunnerPhase = 'entering';
  /** 当前场景帧（子会话挂起栈见 C 组；单帧阶段即主会话帧） */
  #frame: SessionFrame;
  /** 挂起的主会话帧栈（C 组接入；A 组恒空） */
  readonly #suspended: SessionFrame[] = [];
  #endReason: NarrativeEndReason | undefined;
  #endingId: string | undefined;
  #lastOutcome: ExecOutcome | undefined;
  #lastRender: RenderSegment[] = [];
  /** 宏条件表达式编译缓存（键 = 表达式原文；词典承载表达式按需编译） */
  readonly #macroExprs = new Map<string, CompiledExpr>();
  /** 历史缓冲（环形 500 段，FR-READ-04 数据源；seq 会话内单调递增） */
  readonly #history: NarrativeHistoryEntry[] = [];
  #historySeq = 0;

  constructor(rt: SceneRunnerRuntime, options: SceneRunnerOptions) {
    this.#rt = rt;
    this.#def = options.def;
    this.#readonlySession = options.readonly ?? false;
    this.#paramsSource = options.params;
    this.#onWarn = options.onWarn;
    this.#contentFilter = options.contentFilter;
    this.#eventSceneIds = new Set(options.def.events.map((event) => event.scene));
    const scene = options.def.scenes.get(options.sceneId);
    if (scene === undefined) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { scene: options.sceneId },
        messageKey: 'error.narrative.sceneMissing',
      });
    }
    this.#requireEntry(scene);
    this.#frame = createFrame(options.sceneId, scene);
  }

  /** 当前相位（§4.2 RunnerPhase） */
  get phase(): RunnerPhase {
    return this.#phase;
  }

  /** 当前场景 id（finished 后保留最后所在场景，供 UI 呈现） */
  get currentSceneId(): GameId {
    return this.#frame.sceneId;
  }

  /** 终态类型（仅 finished 相位有值，§4.2「记录终态类型」） */
  get endReason(): NarrativeEndReason | undefined {
    return this.#endReason;
  }

  /** 结局 id（endReason='ending' 时有值） */
  get endingId(): string | undefined {
    return this.#endingId;
  }

  /** 最近一次事务产出（非流程跳转如 battle/advanceTime 留给宿主消费，§3.1） */
  get lastOutcome(): ExecOutcome | undefined {
    return this.#lastOutcome;
  }

  /** 当前会话是否只读（回想重放，FR-GAL-01） */
  get isReadonly(): boolean {
    return this.#readonlySession;
  }

  /** 当前子会话嵌套深度（挂起主会话帧数；0 = 顶层主会话） */
  get depth(): number {
    return this.#suspended.length;
  }

  /** 当前场景的内容标签（FR-NARR-01 场景元信息；宿主/分级过滤呈现面） */
  get sceneTags(): readonly string[] {
    return this.#frame.scene.def.tags ?? [];
  }

  /**
   * 当前可渲染段落（§4.2 renderList）：已揭示前缀的段落流。
   * entering 相位首次调用完成段落流展开（show_if 过滤 + 宏惰性求值 + 场景
   * 访问记录）并迁移 await_advance；宏决策按访问快照缓存（重复 renderList
   * 不重复展开、不重复消耗随机序列），vars 每次渲染重新组装（延迟插值）。
   */
  renderList(): RenderSegment[] {
    if (this.#phase === 'entering') {
      // first/again 依据 seen.scenes 的访问快照（§4.2）；readonly 会话强制
      // again 且不写 seen（FR-GAL-01 回想重放无副作用）
      this.#frame.firstVisit =
        !this.#readonlySession && !this.#rt.state.seen.scenes.includes(this.#frame.sceneId);
      this.#frame.expanded = this.#expandPlan(this.#frame);
      this.#frame.cursor = Math.min(1, this.#frame.expanded.length);
      // 写 seen.scenes 的时机 = 正常会话渲染时（§4.2）；只读会话不写
      if (!this.#readonlySession) {
        this.#rt.markSceneSeen(this.#frame.sceneId);
      }
      this.#phase = 'await_advance';
    }
    if (this.#phase === 'finished' || this.#phase === 'resolving') {
      return this.#lastRender;
    }
    const output = this.#buildRenderList(this.#frame);
    this.#lastRender = output;
    return output;
  }

  /**
   * 推进段落（§4.2 advance）：还有段落 → 揭示下一段（保持 await_advance）；
   * 段落已尽 → 终局迁移（存在可见选项 → await_choice；否则 finished）。
   * entering 相位抛错（须先 renderList 完成首段渲染）；await_choice/finished
   * 相位抛错（契约违规 INTERNAL）。
   */
  advance(): void {
    if (this.#phase === 'entering') {
      throw internalWrongPhase('advance', this.#phase, '须先 renderList 完成首段渲染');
    }
    if (this.#phase !== 'await_advance') {
      throw internalWrongPhase('advance', this.#phase);
    }
    if (this.#frame.cursor < this.#frame.expanded.length) {
      this.#frame.cursor += 1;
      this.#lastRender = this.#buildRenderList(this.#frame);
      return;
    }
    this.#transitionAfterExhausted();
  }

  /**
   * 当前可用选项（§4.2 choices）：show_if 过滤 + 置灰条件。
   * 仅 await_choice 相位返回视图（其余相位返回空列表——选项只在段落尽后出现）；
   * 被过滤选项以 hiddenByFilter 标记返回（调试可见，UI 跳过渲染）。
   */
  choices(): ChoiceView[] {
    if (this.#phase !== 'await_choice') return [];
    return this.#choiceViews(this.#frame.scene.def.choices);
  }

  /**
   * 执行一次选择（§4.2 choose）：await_choice → resolving → 消费
   * ExecOutcome.jumps。跳转消费口径（§4.2 状态机图）：
   * - 有效跳转 = 效果序列流程跳转 + `goto` 便捷字段（排在最后）中按序取
   *   **最后一个**（顺序覆写语义，§3.3「跳转类指令不改状态」由 05 号保证）；
   *   非流程跳转（battle/advanceTime）留给宿主/对应子系统，经 {@link lastOutcome}
   *   取用，不在此消费；
   * - `{scene}` → 进入新场景（entering）；`{ending}` → finished（记录结局 id）；
   *   `{back}` → 子会话返回（C 组）或 finished；`{loop_transition}` → finished；
   * - 无流程跳转 → 留在当前场景（剩余选项继续可选，回到 await_choice）。
   *
   * 入参校验（进入 resolving 之前抛出，相位不变）：只读会话（回想重放无任何
   * 副作用，FR-GAL-01）、相位非 await_choice、未知选项 id、被过滤选项
   * （hiddenByFilter）、置灰选项（enabled=false）。
   */
  choose(choiceId: string): void {
    // 只读会话不变量优先于相位校验（回想重放无任何副作用，FR-GAL-01；
    // 常规回想流在段落尽即终局，不进入选项相位——此守卫为纵深防御）
    if (this.#readonlySession) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { scene: this.#frame.sceneId, choice: choiceId },
        messageKey: 'error.narrative.readonlyChoice',
      });
    }
    if (this.#phase !== 'await_choice') {
      throw internalWrongPhase('choose', this.#phase);
    }
    const def = this.#frame.scene.def.choices.find((choice) => choice.id === choiceId);
    if (def === undefined) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { scene: this.#frame.sceneId, choice: choiceId },
        messageKey: 'error.narrative.choiceMissing',
      });
    }
    // 过滤/置灰选项不可选（§4.2：置灰可见但不可用，FR-NARR-02）；校验失败在
    // 进入 resolving 之前抛出，相位不变（UI 不应提供不可用选项的点击面）
    const view = this.#choiceViews(this.#frame.scene.def.choices).find(
      (candidate) => candidate.id === choiceId,
    );
    if (view?.hiddenByFilter === true) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { scene: this.#frame.sceneId, choice: choiceId },
        messageKey: 'error.narrative.choiceFiltered',
      });
    }
    if (view !== undefined && !view.enabled) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { scene: this.#frame.sceneId, choice: choiceId },
        messageKey: 'error.narrative.choiceDisabled',
      });
    }
    this.#phase = 'resolving';
    const outcome = this.#execChoice(def);
    this.#lastOutcome = outcome;
    this.#consumeJumps(collectFlowJumps(collectChoiceJumps(outcome, def)));
  }

  // —— 内部管线 ————————————————————————————————————————————————————

  /**
   * 段落流展开（宏惰性求值点，FR-NARR-04）：show_if 过滤 + 段落键宏解析 →
   * 文本键计划（每场景访问一次快照；随机/条件决策不随重复渲染漂移）。
   * 只读会话经 rng.fork() 派生子序列做随机决策（FR-GAL-01 无副作用：不消耗
   * 运行时主随机序列，派生子序列自当前状态确定性产生）。
   */
  #expandPlan(frame: SessionFrame): readonly TextKey[] {
    const scene = frame.scene;
    const context: MacroExpansionContext = {
      evalCondition: (expr) => this.#evalMacroCondition(expr, frame.sceneId),
      firstVisit: frame.firstVisit,
      rng: this.#readonlySession ? this.#rt.rng.fork() : this.#rt.rng,
    };
    const out: TextKey[] = [];
    for (const segment of scene.def.segments) {
      if (segment.showIf !== undefined && !this.#evalSceneExpr(segment.showIf, scene, 'showIf')) {
        continue;
      }
      const macro = this.#macroFor(segment.key);
      if (macro === null) {
        out.push(segment.key);
        continue;
      }
      const branch = expandMacro(macro, context);
      if (branch !== null) out.push(branch);
    }
    return out;
  }

  /**
   * 宏条件求值（词典承载的表达式不进加载器 exprCache——它不属于场景数据，
   * 编译期校验在首次展开时进行并按原文 memo，与 TextResolver 的 selectCache
   * 同型；DD-01 加载期编译语义的运行时对应）。编译失败 → EXPR_COMPILE
   * （where 携带段落键与表达式原文，NFR-05 显性化）。
   */
  #evalMacroCondition(source: string, sceneId: GameId): boolean {
    let compiled = this.#macroExprs.get(source);
    if (compiled === undefined) {
      try {
        compiled = compileExpr(source, this.#macroRegistry());
      } catch (cause) {
        if (cause instanceof EngineError) {
          throw new EngineError({
            code: 'EXPR_COMPILE',
            where: { ...cause.where, scene: sceneId, expr: source },
            messageKey: cause.messageKey,
            cause,
          });
        }
        throw cause;
      }
      this.#macroExprs.set(source, compiled);
    }
    return this.#rt.evalCondition(compiled);
  }

  /** 宏条件编译用函数注册表（def.functionRegistry 优先；缺省内置 20 函数） */
  #macroRegistry(): ExprFunctionRegistry {
    return this.#def.functionRegistry ?? createBuiltinFunctionRegistry();
  }

  /** 段落键 → 主语言词典记录值中的叙事宏（非宏形态返回 null，按普通键渲染） */
  #macroFor(key: TextKey): NarrativeMacro | null {
    const pack = this.#def.locales[this.#def.manifest.mainLang];
    const value = pack?.keys.get(key);
    if (value === undefined) return null;
    return parseMacro(key, value);
  }

  /**
   * 已揭示前缀的渲染列表（§4.2 RenderSegment 段落流；vars 每次渲染组装）。
   * 新揭示的文本段落（FR-READ-04 数据源）随构建推入历史缓冲（环形 500 段，
   * 含场景 id 与时钟上下文）——重复渲染不重复入账，游标推进才入账。
   *
   * 内容过滤（§5.8 应用点 2，FR-CGRD-03）：注入 contentFilter 且当前场景标签
   * 被屏蔽时，整场文本段落按占位策略处理——配置了占位键则以该键替换，否则
   * 跳过（媒体段落不受影响）。被跳过的屏蔽内容**不入历史**（历史回看不得
   * 泄漏被屏蔽内容）。未注入过滤器 = 08 号既有行为，逐字不变。
   */
  #buildRenderList(frame: SessionFrame): RenderSegment[] {
    const vars = this.#resolveVars();
    const revealed = frame.expanded.slice(0, frame.cursor);
    // 场景级标签过滤：段落 schema（§2.4 segmentSchema）无独立 tags，屏蔽判定
    // 以场景标签为粒度；屏蔽态在本帧渲染期恒定，未配置占位键 → 跳过该场文本
    const filter = this.#contentFilter;
    const blocked = filter !== undefined && !filter.passes(frame.scene.def.tags);
    const placeholder =
      blocked && filter !== undefined ? filter.placeholderFor(frame.scene.def.tags) : null;
    const skipBlocked = blocked && placeholder === null;
    const out: RenderSegment[] = [];
    // 场景级媒体绑定（FR-NARR-01 / DD-05）映射为前置 image 段落（media intent
    // 随段落流产出，engine 不接触播放）；不计入段落游标（advance 语义只针对文本）
    if (frame.media.length > 0) {
      out.push({ kind: 'image', media: frame.media });
    }
    // spacing 只出现在实际产出的文本段落之间（跳过屏蔽段落时不产生悬空间距）
    let textEmitted = false;
    for (let i = 0; i < revealed.length; i++) {
      if (skipBlocked) continue;
      if (textEmitted) out.push({ kind: 'spacing' });
      textEmitted = true;
      // 被屏蔽且配置了占位键 → 以占位键替换；否则渲染原文（08 号既有路径）
      const segment: RenderSegment = {
        kind: 'text',
        key: placeholder ?? (revealed[i] as TextKey),
        vars,
      };
      if (i >= frame.pushed) {
        this.#pushHistory(frame.sceneId, segment);
      }
      out.push(segment);
    }
    frame.pushed = Math.max(frame.pushed, frame.cursor);
    return out;
  }

  /** 历史入账（环形：容量 NARRATIVE_HISTORY_CAPACITY，超出挤出最旧条目） */
  #pushHistory(sceneId: GameId, segment: RenderSegment): void {
    const clock = this.#rt.state.world.time;
    this.#history.push(
      Object.freeze({
        seq: this.#historySeq,
        sceneId,
        segment: Object.freeze({ ...segment }),
        clock: Object.freeze({ day: clock.day, slotIndex: clock.slotIndex }),
      }),
    );
    this.#historySeq += 1;
    if (this.#history.length > NARRATIVE_HISTORY_CAPACITY) {
      this.#history.splice(0, this.#history.length - NARRATIVE_HISTORY_CAPACITY);
    }
  }

  /**
   * 历史缓冲只读访问器（FR-READ-04 历史回看数据源）：返回渲染序快照副本
   * （段落 + 场景 id + 渲染时时钟投影），调用方改写副本不影响会话内部。
   */
  history(): readonly NarrativeHistoryEntry[] {
    return [...this.#history];
  }

  /** 段落尽后的终局迁移（§4.2：存在可见选项 → await_choice，否则 finished） */
  #transitionAfterExhausted(): void {
    // 只读会话（回想重放）不可交互：段落尽即自然终局，不进入选项相位
    if (this.#readonlySession) {
      this.#finish('exhausted');
      return;
    }
    const views = this.#choiceViews(this.#frame.scene.def.choices);
    const hasVisible = views.some((view) => view.hiddenByFilter !== true);
    if (hasVisible) {
      this.#phase = 'await_choice';
      return;
    }
    this.#finish('exhausted');
  }

  /**
   * 选项视图（§4.2 ChoiceView：已过 show_if + 内容过滤 + 一次性隐藏）：
   * - show_if 不满足 → hiddenByFilter（整个选项不出现，FR-NARR-02）；
   * - 选项内容标签被内容过滤命中 → hiddenByFilter（FR-CGRD-02）：注入
   *   contentFilter 时经其单点判定（FR-CGRD-03），未注入时沿用 08 号既有的
   *   `settings.disabledTags` 直查（缺省不过滤的向后兼容口径）；
   * - once 选项的已选标记（world.flags `__choice.<scene>.<choice>`，§4.2
   *   自动生成、无需作者声明）→ hiddenByFilter；
   * - disabledIf 满足 → enabled=false 的置灰视图（可见但不可用），
   *   disabledReasonKey 携带原因键（作者声明时）。
   */
  #choiceViews(choices: readonly ChoiceDef[]): ChoiceView[] {
    const scene = this.#frame.scene;
    const filter = this.#contentFilter;
    const disabledTags = this.#rt.state.settings.disabledTags;
    const flags = this.#rt.state.world.flags;
    const out: ChoiceView[] = [];
    for (const choice of choices) {
      const hiddenByShowIf =
        choice.showIf !== undefined && !this.#evalSceneExpr(choice.showIf, scene, 'showIf');
      const hiddenByTags =
        filter !== undefined
          ? !filter.passes(choice.tags)
          : choice.tags !== undefined && choice.tags.some((tag) => disabledTags.includes(tag));
      const hiddenByOnce =
        choice.once === true && flags[onceChoiceKey(scene.def.id, choice.id)] === true;
      const hidden = hiddenByShowIf || hiddenByTags || hiddenByOnce;
      const disabled =
        choice.disabledIf !== undefined &&
        this.#evalSceneExpr(choice.disabledIf, scene, 'disabledIf');
      out.push({
        id: choice.id,
        textKey: choice.textKey,
        enabled: !disabled,
        ...(disabled && choice.disabledReasonKey !== undefined
          ? { disabledReasonKey: choice.disabledReasonKey }
          : {}),
        ...(hidden ? { hiddenByFilter: true } : {}),
      });
    }
    return out;
  }

  /**
   * 选项事务（§3.1 exec）：once 选项的已选标记 flag 与选项效果同一事务
   * （原子——失败即整体回滚，标记不残留）；无效果声明 = 单 flag 空效果事务，
   * 跳转仅来自 goto 便捷字段。
   */
  #execChoice(def: ChoiceDef): ExecOutcome {
    const effects: EffectData[] = [];
    if (def.once === true) {
      effects.push({ flag: { name: onceChoiceKey(this.#frame.sceneId, def.id), value: true } });
    }
    if (def.effects !== undefined) effects.push(...def.effects);
    return this.#rt.exec(effects, this.#choiceContext());
  }

  /** 选项事务上下文（source='choice' + 场景定位 + 运行时单一随机序列，DD-09） */
  #choiceContext(): ExecContext {
    return { source: 'choice', where: { scene: this.#frame.sceneId }, rng: this.#rt.rng };
  }

  /** 消费流程类跳转（取最后一个为有效跳转，顺序覆写语义见 choose TSDoc） */
  #consumeJumps(flowJumps: readonly JumpTarget[]): void {
    const effective = flowJumps[flowJumps.length - 1];
    if (effective === undefined) {
      // 无流程跳转：留在当前场景，回到 await_choice（剩余选项继续可选）
      this.#phase = 'await_choice';
      return;
    }
    switch (effective.type) {
      case 'scene':
        this.#enterScene(effective.scene);
        return;
      case 'ending':
        this.#finish('ending', effective.ending);
        return;
      case 'back':
        this.#resumeOrFinish();
        return;
      case 'loopTransition':
        this.#finish('loop');
        return;
      default:
        // battle/advanceTime 非流程跳转：留待宿主/对应子系统消费
        this.#phase = 'await_choice';
        return;
    }
  }

  /** {back} 消费：有挂起主会话 → 弹栈恢复（回到选项相位）；否则会话终局 */
  #resumeOrFinish(): void {
    const resumed = this.#suspended.pop();
    if (resumed === undefined) {
      this.#finish('back');
      return;
    }
    // 挂起帧在 choose 的 resolving 中被挂起，其选项已消费完毕：恢复到
    // await_choice（剩余选项继续可选；选项视图按恢复时状态现算）
    this.#frame = resumed;
    this.#phase = 'await_choice';
  }

  /**
   * 进入新场景帧（§4.2 子会话挂起栈，C 组）：跳转目标是事件场景（def.events
   * 声明的 event.scene 集合）时，当前帧压入挂起栈、以子会话进入事件场景；
   * 深度限 3——挂起栈已满时发 warning（diagnostic 风格，经 onWarn 出口）且
   * 不再压栈（按普通导航替换当前帧，数据设计问题在调试期显性化）；普通场景
   * 跳转为导航替换。场景缺失 → 错误挂起态。
   */
  #enterScene(sceneId: GameId): void {
    const scene = this.#def.scenes.get(sceneId);
    if (scene === undefined) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { scene: sceneId, from: this.#frame.sceneId },
        messageKey: 'error.narrative.sceneMissing',
      });
    }
    if (this.#eventSceneIds.has(sceneId) && this.#suspended.length < SUBSESSION_DEPTH_LIMIT) {
      this.#suspended.push(this.#frame);
    } else if (this.#eventSceneIds.has(sceneId)) {
      this.#onWarn?.({
        severity: 'warning',
        code: 'subsession_depth_exceeded',
        where: {
          scene: this.#frame.sceneId,
          target: sceneId,
          depth: String(SUBSESSION_DEPTH_LIMIT),
        },
      });
    }
    this.#requireEntry(scene);
    this.#frame = createFrame(sceneId, scene);
    this.#phase = 'entering';
  }

  /** 终态落定（§4.2：记录终态类型；挂起栈一并清空——会话整体结束） */
  #finish(reason: NarrativeEndReason, endingId?: string): void {
    this.#suspended.length = 0;
    this.#endReason = reason;
    this.#endingId = endingId;
    this.#phase = 'finished';
  }

  /**
   * 场景进入条件校验（entry.require，FR-XPLR-04 条件型入口；FR-NARR-01 场景
   * 元信息）：不满足即抛 INTERNAL entryDenied（错误显性化——数据设计问题的
   * 运行期违规不应被静默吞掉；构造期抛出则无实例残留，跳转期抛出则会话停留
   * resolving 错误挂起态，宿主经 GameRuntime.rollback 恢复）。表达式的编译
   * 产物经 def.exprCache 复用（§3.4 步骤 5）。
   */
  #requireEntry(scene: CompiledScene): void {
    const require = scene.def.entry?.require;
    if (require === undefined) return;
    if (this.#evalSceneExpr(require, scene, 'entry.require')) return;
    throw new EngineError({
      code: 'INTERNAL',
      where: { scene: scene.def.id, require },
      messageKey: 'error.narrative.entryDenied',
    });
  }

  /** 场景数据表达式求值（加载期编译产物经 exprCache 复用，§3.4 步骤 5） */
  #evalSceneExpr(source: string, scene: CompiledScene, field: string): boolean {
    const compiled = this.#def.exprCache.get(source);
    if (compiled === undefined) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { scene: scene.def.id, field, expr: source },
        messageKey: 'error.narrative.exprNotCompiled',
      });
    }
    return this.#rt.evalCondition(compiled);
  }

  /** 延迟插值 vars 组装（渲染时求值，FR-NARR-04；冻结防外部改写） */
  #resolveVars(): InterpVars {
    const params =
      typeof this.#paramsSource === 'function' ? this.#paramsSource() : (this.#paramsSource ?? {});
    return Object.freeze({ ...params });
  }
}

// —— 会话帧与模块级辅助（无状态纯函数） ———————————————————————————————————

/** 场景帧：一次场景访问的展开产物与揭示进度（宏为按访问快照语义，B 组） */
interface SessionFrame {
  readonly sceneId: GameId;
  readonly scene: CompiledScene;
  /** 场景级媒体意图（FR-NARR-01：bg/bgm 绑定在进入时产出，DD-05） */
  readonly media: readonly MediaIntent[];
  /** 本次访问是否首次（seen.scenes 快照；first/again 宏依据，readonly 恒 false） */
  firstVisit: boolean;
  /** 段落流展开计划（宏解析后的文本键序列；entering 相位为空数组，首渲染时填充） */
  expanded: readonly TextKey[];
  /** 已揭示段落数（0..expanded.length；仅文本段落计数） */
  cursor: number;
  /** 已入账历史段落数（游标推进才入账，重复渲染不重复入账） */
  pushed: number;
}

function createFrame(sceneId: GameId, scene: CompiledScene): SessionFrame {
  const media: MediaIntent[] = [];
  const bound = scene.def.media;
  if (bound?.bg !== undefined) media.push({ type: 'bg', assetId: bound.bg });
  if (bound?.bgm !== undefined) media.push({ type: 'bgm', assetId: bound.bgm, loop: true });
  return { sceneId, scene, media, firstVisit: false, expanded: [], cursor: 0, pushed: 0 };
}

/** 提取流程类跳转（scene/ending/back/loopTransition；battle/advanceTime 留给宿主） */
function collectFlowJumps(jumps: readonly JumpTarget[]): JumpTarget[] {
  return jumps.filter(
    (jump) =>
      jump.type === 'scene' ||
      jump.type === 'ending' ||
      jump.type === 'back' ||
      jump.type === 'loopTransition',
  );
}

/**
 * 一次选择的完整跳转序列（§3.1 ExecOutcome.jumps + 选项便捷字段）：
 * `ChoiceDef.goto` 为「纯跳转便捷字段」（§2.4），排在效果序列跳转之后
 * （顺序覆写语义：后者生效）。
 */
/**
 * 一次性选项的已选标记键（§4.2「键 __choice.<scene>.<choice>」）：存
 * world.flags，由 choose 的事务自动写入、无需作者声明。
 */
function onceChoiceKey(sceneId: GameId, choiceId: string): string {
  return `__choice.${sceneId}.${choiceId}`;
}

function collectChoiceJumps(outcome: ExecOutcome, def: ChoiceDef): JumpTarget[] {
  const jumps = [...outcome.jumps];
  if (def.goto !== undefined) jumps.push({ type: 'scene', scene: def.goto });
  return jumps;
}

/**
 * 子会话嵌套深度上限（§4.2「深度限 3，超限 = 数据设计问题，warning」）：
 * 挂起主会话帧数达到上限后，事件场景跳转不再压栈（普通导航替换当前帧）。
 */
export const SUBSESSION_DEPTH_LIMIT = 3;

/**
 * 历史缓冲容量（§4.2「环形，容量 500 段」/ FR-READ-04 历史回看数据源）：
 * 每场景帧新揭示的文本段落入账，超出容量挤出最旧条目。
 */
export const NARRATIVE_HISTORY_CAPACITY = 500;

/** 相位契约违规（INTERNAL：调用方在非法相位调用了状态机操作） */
function internalWrongPhase(operation: string, phase: RunnerPhase, detail?: string): EngineError {
  return new EngineError({
    code: 'INTERNAL',
    where: { operation, phase, ...(detail !== undefined ? { detail } : {}) },
    messageKey: 'error.narrative.wrongPhase',
  });
}
