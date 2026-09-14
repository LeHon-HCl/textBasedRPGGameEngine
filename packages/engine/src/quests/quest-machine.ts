import { EngineError } from '@game/shared';
import type { GameId, QuestDef, QuestState } from '@game/shared';
import type { EngineEvent } from '../runtime/index.js';
import { canTransition, transitionVias } from './transitions.js';
import type { ObjectiveProgress, QuestContext, QuestStateEnum } from './types.js';

/**
 * 任务状态机（设计 §4.5；11 号模块）。
 *
 * 与 runtime 解耦的纯状态机：不持有 GameState/runtime，全部操作经
 * {@link QuestContext} 在调用方提供的事务 draft 上完成（DD-06 状态/流程分界，
 * §1.2 R5）。迁移合法性统一由 {@link canTransition} 的规则表裁决。
 *
 * 依赖注入面：
 * - `defs`：任务目录（QuestDef.stages 阶段序 / acceptIf / failWhen /
 *   requires / conflicts 的唯一来源）；
 * - `questRefs`：加载器 compile 步骤产出的 refs 反查表（`VarRef.path → 任务 id`），
 *   供 evaluateTouched 判定「本次事务触碰了哪些任务的条件」——不轮询的数据基础
 *   （§4.5「与事件系统同一机制」）。
 */
export interface QuestMachineOptions {
  /** 任务目录（缺省空表：接取/推进仍可用，仅不做目录级校验） */
  readonly defs: ReadonlyMap<GameId, QuestDef>;
  /** refs 反查表（compile 步骤 poolIndex.questRefs；缺省 = 不参与触碰评估） */
  readonly questRefs?: ReadonlyMap<string, ReadonlySet<GameId>>;
}

export class QuestMachine {
  readonly #defs: ReadonlyMap<GameId, QuestDef>;
  /** 任务 id → 其条件表达式依赖的 GameState 路径前缀（由 questRefs 归一化而来） */
  readonly #conditionPrefixes: ReadonlyMap<GameId, readonly string[]>;

  constructor(options: QuestMachineOptions) {
    this.#defs = options.defs;
    this.#conditionPrefixes = buildConditionPrefixes(options.questRefs);
  }

  /** 任务目录（只读视图；宿主装配 introspection 用） */
  get defs(): ReadonlyMap<GameId, QuestDef> {
    return this.#defs;
  }

  /** 六态迁移合法性（规则表查询；供调用方在写入前自检） */
  canTransition(from: QuestStateEnum, to: QuestStateEnum): boolean {
    return canTransition(from, to);
  }

  /**
   * 目标进度投影（FR-QUEST-05 文本插值数据源；11 任务 6）。
   *
   * 对任务每一阶段输出 {stageId, objectiveKey, complete, value}：
   * - complete：done / ready_to_submit 全阶段真；否则当前阶段之前的阶段为真；
   * - value：优先取 `QuestState.objectives[stageId]`，缺省按 complete 取 1/0
   *   （作者/宿主将进度计数写入 objectives；本投影不解释其来源）。
   *
   * 未接取（无 QuestState）或目录缺失 → 空数组。
   */
  progress(quests: Readonly<Record<GameId, QuestState>>, questId: GameId): ObjectiveProgress[] {
    const def = this.#defs.get(questId);
    const quest = quests[questId];
    if (def === undefined || quest === undefined) return [];
    const allComplete = quest.state === 'done' || quest.state === 'ready_to_submit';
    const currentIndex = def.stages.findIndex((stage) => stage.id === quest.stage);
    return def.stages.map((stage, index) => {
      const complete = allComplete || (currentIndex >= 0 && index < currentIndex);
      const value = quest.objectives[stage.id] ?? (complete ? 1 : 0);
      return {
        stageId: stage.id,
        objectiveKey: stage.objectiveKey,
        complete,
        value,
      };
    });
  }

  /**
   * 接取任务（available/undiscovered → active，§4.5；FR-QUEST-04）。
   *
   * 校验顺序（状态门优先，避免无谓求值）：
   * 1. 状态门：当前态须能迁移到 active（undiscovered / available），否则拒绝；
   * 2. conflicts：任一互斥任务处于 active / ready_to_submit → 拒绝（进行中互斥）；
   * 3. requires：任一前置任务未 done → 拒绝；
   * 4. acceptIf：表达式为假 → 拒绝。
   *
   * 副作用：写入 active + 首阶段 + startedDay + 空 objectives；emit
   * `quest_state_changed`。拒绝抛 `EFFECT_FAILED{op:'quest', quest, detail}`
   * （原因可读，UI 错误卡片直接展示）。无目录时仅跳过 2–4 步（05 号兼容）。
   */
  accept(ctx: QuestContext, questId: GameId): void {
    const def = this.#defs.get(questId);
    const current = ctx.quests[questId];
    const from: QuestStateEnum = current?.state ?? 'undiscovered';
    // 表驱动状态门：仅 accept 触发方式允许迁入 active（active→active 虽合法但
    // 属 stage 触发，不构成「可接取」）
    if (!transitionVias(from, 'active').includes('accept')) {
      throw this.#reject(`任务 '${questId}' 当前状态 ${from}，不可接取`, questId);
    }
    if (def !== undefined) {
      for (const conflict of def.conflicts ?? []) {
        const state = ctx.quests[conflict]?.state;
        if (state === 'active' || state === 'ready_to_submit') {
          throw this.#reject(
            `任务 '${questId}' 与进行中的互斥任务 '${conflict}'（${state}）冲突，不可接取`,
            questId,
          );
        }
      }
      for (const required of def.requires ?? []) {
        if (ctx.quests[required]?.state !== 'done') {
          throw this.#reject(
            `任务 '${questId}' 的前置任务 '${required}' 尚未完成，不可接取`,
            questId,
          );
        }
      }
      if (def.acceptIf !== undefined && !ctx.evalCondition(def.acceptIf)) {
        throw this.#reject(
          `任务 '${questId}' 接取条件不满足（acceptIf: ${def.acceptIf}）`,
          questId,
        );
      }
    }
    const stage = def?.stages[0]?.id;
    ctx.quests[questId] = {
      state: 'active',
      objectives: {},
      startedDay: ctx.state.world.time.day,
      ...(stage !== undefined ? { stage } : {}),
    };
    ctx.emit({ type: 'quest_state_changed', quest: questId, from, to: 'active' });
  }

  /**
   * 显式推进阶段（作者 `quest.advance`；仅 active 态）。
   *
   * - 显式 `stage`：目录存在时校验阶段合法；无目录时直接采用；
   * - 缺省：取目录当前阶段的下一阶段（无目录报错；已在末阶段报错——自动进入
   *   ready_to_submit 由 completeWhen 评估负责）；
   * - 副作用：写 stage + 发 `quest_stage`（目标阶段目标键可由目录推导）。
   */
  advance(ctx: QuestContext, questId: GameId, stage?: string): void {
    const current = ctx.quests[questId];
    if (current === undefined) {
      throw this.#reject(`任务 '${questId}' 尚未存在，不可推进`, questId);
    }
    if (current.state !== 'active') {
      throw this.#reject(`任务 '${questId}' 当前状态 ${current.state}，仅 active 可推进`, questId);
    }
    const def = this.#defs.get(questId);
    if (stage !== undefined && def !== undefined && !def.stages.some((s) => s.id === stage)) {
      throw this.#reject(`任务 '${questId}' 不存在阶段 '${stage}'`, questId);
    }
    let target = stage;
    if (target === undefined) {
      const stages = def?.stages;
      if (stages === undefined) {
        throw this.#reject(
          `缺省「下一阶段」需要任务目录（QuestDef）；未注入时必须显式给出 stage`,
          questId,
        );
      }
      const index = stages.findIndex((s) => s.id === current.stage);
      if (index < 0) {
        target = stages[0]?.id; // 尚无阶段 → 取首阶段
      } else if (index === stages.length - 1) {
        throw this.#reject(
          `任务 '${questId}' 已在最终阶段（提交就绪归 completeWhen 评估）`,
          questId,
        );
      } else {
        target = stages[index + 1]?.id;
      }
    }
    if (target === undefined) {
      throw this.#reject(`任务 '${questId}' 无可推进阶段`, questId);
    }
    ctx.quests[questId] = { ...current, stage: target };
    const objectiveKey = def?.stages.find((s) => s.id === target)?.objectiveKey;
    ctx.emit({
      type: 'quest_stage',
      quest: questId,
      from: current.stage,
      to: target,
      ...(objectiveKey !== undefined ? { objectiveKey } : {}),
    });
  }

  /**
   * 显式完成（作者 `quest.complete`；05 号语义保留 + 11 号 submit 正路）。
   *
   * - ready_to_submit → 走 {@link submit}：结算 rewards（child 原子批）后 done；
   * - active → 直接 done（作者强制完成，不结算 rewards；六态表 `active→done`）；
   * - 其他态 → 拒绝。
   */
  complete(ctx: QuestContext, questId: GameId): void {
    const current = ctx.quests[questId];
    if (current === undefined) {
      throw this.#reject(`任务 '${questId}' 尚未存在，不可完成`, questId);
    }
    if (current.state === 'ready_to_submit') {
      this.submit(ctx, questId);
      return;
    }
    if (current.state === 'active') {
      ctx.quests[questId] = { ...current, state: 'done' };
      ctx.emit({ type: 'quest_state_changed', quest: questId, from: 'active', to: 'done' });
      return;
    }
    throw this.#reject(`任务 '${questId}' 当前状态 ${current.state}，不可完成`, questId);
  }

  /**
   * 提交任务（ready_to_submit → done + rewards 结算；§4.5，11 任务 4）。
   *
   * rewards 经 `ctx.child` 在**同一 draft** 上原子执行：任一奖励效果失败沿调用栈
   * 上抛 → 整批事务回滚 → 任务保持 ready_to_submit（不会出现「奖励发一半」）。
   * 奖励成功后才写入 done 并发 `quest_state_changed`。
   */
  submit(ctx: QuestContext, questId: GameId): void {
    const current = ctx.quests[questId];
    if (current === undefined || current.state !== 'ready_to_submit') {
      throw this.#reject(
        `任务 '${questId}' 当前状态 ${current?.state ?? '不存在'}，不可提交（需 ready_to_submit）`,
        questId,
      );
    }
    const rewards = this.#defs.get(questId)?.rewards;
    if (rewards !== undefined && rewards.length > 0) {
      ctx.child(rewards);
    }
    ctx.quests[questId] = { ...current, state: 'done' };
    ctx.emit({
      type: 'quest_state_changed',
      quest: questId,
      from: 'ready_to_submit',
      to: 'done',
    });
  }

  /**
   * 显式失败（作者 `quest.fail`；active / ready_to_submit → failed）。
   * `failWhen` 自动判定（含时间截止）见 evaluateTouched / evaluateFailures。
   */
  fail(ctx: QuestContext, questId: GameId): void {
    const current = ctx.quests[questId];
    const from = current?.state;
    if (current === undefined || (from !== 'active' && from !== 'ready_to_submit')) {
      throw this.#reject(
        `任务 '${questId}' 当前状态 ${current?.state ?? '不存在'}，不可失败`,
        questId,
      );
    }
    ctx.quests[questId] = { ...current, state: 'failed' };
    ctx.emit({ type: 'quest_state_changed', quest: questId, from, to: 'failed' });
  }

  /**
   * 事务触碰后评估受影响任务（§4.5「completeWhen 经 refs 反查表按 TouchReport
   * 触发，不轮询」；11 任务 3）。
   *
   * - `touched` 为本次事务触碰的 GameState 路径（点分前缀，如 `world.flags.x`）；
   *   空数组 = 直接短路（零条件求值，行为级证明不轮询）；
   * - 仅评估条件依赖命中任一 touched 前缀的任务（脏标记精确）；
   * - 对 active 任务：当前阶段 completeWhen 达成则推进（可级联多个已满足阶段），
   *   末阶段达成 → ready_to_submit；推进发 `quest_stage`，转待提交发
   *   `quest_state_changed`；
   * - 返回本次产出的事件列表（与 ctx.emit 同一批，供调用方断言/日志）。
   *
   * 注意：本方法不改动非 active 任务，也不主动评估未命中路径（不轮询）。
   */
  evaluateTouched(ctx: QuestContext, touched: readonly string[]): EngineEvent[] {
    const events: EngineEvent[] = [];
    if (touched.length === 0) return events;
    const emit = (event: EngineEvent): void => {
      events.push(event);
      ctx.emit(event);
    };
    for (const [questId, prefixes] of this.#conditionPrefixes) {
      if (!prefixes.some((prefix) => touchedMatches(prefix, touched))) continue;
      const current = ctx.quests[questId];
      if (current === undefined || current.state !== 'active') continue;
      const def = this.#defs.get(questId);
      if (def === undefined) continue;
      // failWhen 优先于阶段推进：条件触达即失败（终态不再推进）
      if (this.#evaluateFailWhen(ctx, questId, current, def, emit)) continue;
      this.#advanceStages(ctx, questId, current, def, emit);
    }
    return events;
  }

  /**
   * 全量失败判定（时间截止挂载点：§4.3 管线步骤 7 / 11 任务 5）。
   *
   * 遍历任务目录，对 active / ready_to_submit 且 failWhen 为真者转 failed。
   * 与 evaluateTouched 的差异：本方法是**主动全量**扫描（时间推进后必须检查所有
   * 活跃任务，即便其 failWhen 未登记 refs）；仅应由时间管线步骤 7 的
   * `__quest.deadline` 调用，常规事务仍走脏标记 evaluateTouched（不轮询）。
   *
   * 返回本次产出的事件列表（同时已 ctx.emit）。
   */
  evaluateFailures(ctx: QuestContext): EngineEvent[] {
    const events: EngineEvent[] = [];
    const emit = (event: EngineEvent): void => {
      events.push(event);
      ctx.emit(event);
    };
    for (const [questId, def] of this.#defs) {
      if (def.failWhen === undefined) continue;
      const current = ctx.quests[questId];
      if (current === undefined) continue;
      if (current.state !== 'active' && current.state !== 'ready_to_submit') continue;
      this.#evaluateFailWhen(ctx, questId, current, def, emit);
    }
    return events;
  }

  /**
   * 单任务 failWhen 判定：为真则 active/ready_to_submit → failed 并 emit
   * `quest_state_changed`（on_fail 的作者侧等价物——QuestDef 无 on_* 效果字段，
   * 作者经事件订阅挂后果）。返回是否已失败。
   */
  #evaluateFailWhen(
    ctx: QuestContext,
    questId: GameId,
    current: QuestState,
    def: QuestDef,
    emit: (event: EngineEvent) => void,
  ): boolean {
    if (def.failWhen === undefined || !ctx.evalCondition(def.failWhen)) return false;
    ctx.quests[questId] = { ...current, state: 'failed' };
    emit({ type: 'quest_state_changed', quest: questId, from: current.state, to: 'failed' });
    return true;
  }

  /** 阶段推进（含级联）：current 为 active 态，def 为目录 */
  #advanceStages(
    ctx: QuestContext,
    questId: GameId,
    current: QuestState,
    def: QuestDef,
    emit: (event: EngineEvent) => void,
  ): void {
    let entry: QuestState = current;
    // 当前阶段下标：无 stage（缺省）视作首阶段；目录中找不到（脏数据）回退首阶段
    let index = entry.stage === undefined ? 0 : def.stages.findIndex((s) => s.id === entry.stage);
    if (index < 0) index = 0;
    while (index < def.stages.length) {
      const stage = def.stages[index] as QuestDef['stages'][number];
      if (!ctx.evalCondition(stage.completeWhen)) break;
      const next = def.stages[index + 1];
      if (next === undefined) {
        // 末阶段达成：active → ready_to_submit（等待 submit 结算奖励）
        ctx.quests[questId] = { ...entry, state: 'ready_to_submit' };
        emit({
          type: 'quest_state_changed',
          quest: questId,
          from: 'active',
          to: 'ready_to_submit',
        });
        return;
      }
      ctx.quests[questId] = { ...entry, stage: next.id };
      emit({
        type: 'quest_stage',
        quest: questId,
        from: entry.stage,
        to: next.id,
        objectiveKey: next.objectiveKey,
      });
      entry = ctx.quests[questId] as QuestState;
      index++;
    }
  }

  /** 任务级拒绝（EFFECT_FAILED；where.op='quest' + quest 定位 + detail 可读原因） */
  #reject(detail: string, quest: GameId): EngineError {
    return new EngineError({
      code: 'EFFECT_FAILED',
      where: { op: 'quest', quest, detail },
      messageKey: 'error.effects.instructionFailed',
    });
  }
}

/**
 * 构建条件路径反查：questRefs（表达式路径 → 任务 id）反演为
 * 任务 id → GameState 路径前缀集合。表达式路径经 {@link exprRefToStatePrefix}
 * 归一化到状态树前缀（如 `flag.x` → `world.flags.x`），使事务补丁路径可直接前缀匹配。
 */
function buildConditionPrefixes(
  questRefs: ReadonlyMap<string, ReadonlySet<GameId>> | undefined,
): ReadonlyMap<GameId, readonly string[]> {
  const table = new Map<GameId, Set<string>>();
  for (const [refPath, questIds] of questRefs ?? []) {
    const prefix = exprRefToStatePrefix(refPath);
    if (prefix === undefined) continue;
    for (const questId of questIds) {
      const bucket = table.get(questId) ?? new Set<string>();
      bucket.add(prefix);
      table.set(questId, bucket);
    }
  }
  return new Map([...table].map(([questId, prefixes]) => [questId, [...prefixes]]));
}

/**
 * 表达式 ref 路径 → GameState 路径前缀（§2.3 白名单 → §3.1 状态树映射，
 * 11 任务 3）。meta 等不入 GameState 的域返回 undefined（Profile 由宿主路由）。
 */
function exprRefToStatePrefix(refPath: string): string | undefined {
  const [root, ...rest] = refPath.split('.');
  const [first, second, third] = rest;
  switch (root) {
    case 'attr':
      return first !== undefined ? `player.attrs.${first}` : undefined;
    case 'skill':
      return first !== undefined ? `player.skills.${first}` : undefined;
    case 'flag':
      return first !== undefined ? `world.flags.${first}` : undefined;
    case 'item':
      return 'player.bag';
    case 'outfit':
      return 'player.outfit';
    case 'body':
      return first !== undefined ? `player.body.${first}` : undefined;
    case 'npc': {
      if (first === undefined) return undefined;
      if (second === 'flags' && third !== undefined) return `npcs.${first}.flags.${third}`;
      if (second === 'favor' || second === 'stage' || second === 'met') {
        return `npcs.${first}.${second}`;
      }
      // 自定义 flag 形态（npc.<id>.<flag>，§2.3）落在 npcs.<id>.flags.<flag>
      return second !== undefined ? `npcs.${first}.flags.${second}` : `npcs.${first}`;
    }
    case 'faction':
      return first !== undefined ? `factions.${first}` : undefined;
    case 'time':
      return first !== undefined ? `world.time.${first}` : undefined;
    case 'loop':
      return 'loop';
    case 'quest':
      if (first === undefined) return undefined;
      return second !== undefined ? `quests.${first}.${second}` : `quests.${first}`;
    case 'wallet':
      return first !== undefined ? `player.wallet.${first}` : undefined;
    default:
      return undefined;
  }
}

/** 前缀匹配：touched 命中条件前缀（相等 / touched 更深 / 前缀更深三种形态） */
function touchedMatches(prefix: string, touched: readonly string[]): boolean {
  for (const path of touched) {
    if (path === prefix || path.startsWith(`${prefix}.`) || prefix.startsWith(`${path}.`)) {
      return true;
    }
  }
  return false;
}
