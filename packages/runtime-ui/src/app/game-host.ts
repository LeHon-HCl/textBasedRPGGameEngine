import { createRng } from '@game/shared';
import type {
  AttrDefs,
  CompiledExpr,
  ContentTagDef,
  ContentTagsDef,
  GameId,
  TextKey,
} from '@game/shared';
import {
  ContentFilter,
  createBuiltinEffectRegistry,
  createEventStepProvider,
  createItemTickProvider,
  createNpcScheduleDeriver,
  createNpcScheduleProvider,
  createQuestConditionEvaluator,
  createQuestDeadlineProvider,
  createQuestDeriver,
  createTextResolver,
  createTimeViewProvider,
  DEFAULT_PLAYER_SETTINGS,
  DEFAULT_TIME_CONFIG,
  ENGINE_VERSION,
  EventPool,
  GameRuntime,
  MediaResolver,
  newGameState,
  projectCalendar,
  projectQuestLog,
  QuestMachine,
  SceneRunner,
  TimePipeline,
} from '@game/engine';
import type {
  CalendarView,
  ExecContext,
  GameDefinition,
  InterpVars,
  PlayerSettings,
  QuestLogView,
  SceneRunner as SceneRunnerType,
  SceneRunnerRuntime,
  TextResolver,
  Unsubscribe,
} from '@game/engine';
import { bridgeRuntimeEvents } from './types.js';
import { checkHostWiring } from './wiring-check.js';
import type { WiringWarning } from './wiring-check.js';
import { createUiStore } from './store.js';
import type { SessionView, UiStoreApi } from './types.js';
import { projectAreaViews } from '../panels/map-projection.js';
import { projectStatusPanel } from '../panels/types.js';

/**
 * 游戏宿主（设计 §6.1/§6.2 的集成层，25 号 A 组的可运行载体）。
 *
 * 职责：把 `GameDefinition` 装配成可玩的会话——运行时、时间管线、叙事会话、
 * 文本解析、内容过滤、面板投影——并把结果投影进 UiStore；React 组件只消费
 * 投影，不直接接触引擎（组件契约保持「props 受控」）。
 *
 * 为什么放在 runtime-ui 而非 apps：宿主接线是**可测的装配逻辑**（面板数据源、
 * 会话推进、选择前 checkpoint 次序），放在包内可用 node 环境直接覆盖
 * （不依赖浏览器）；apps/player-demo 只负责「读夹具 + 挂 React 根」。
 *
 * 位置语义（as-built 记录）：本宿主用 `currentLocation` 维护「玩家当前地点」
 * ——引擎状态树没有该字段（`world.unlockedAreas` 只有区域解锁；地点归属是
 * 场景数据 `scene.area` 与事件 `where.location` 的查询维度）。地图高亮与
 * 移动消耗消费该宿主态，不入存档（与「追踪为 UI 状态」同口径）。
 */

/** 宿主装配选项（GameDefinition + 初始数据） */
export interface GameHostOptions {
  readonly definition: GameDefinition;
  /**
   * 属性定义（data/attrs.yaml 解析产物）。
   *
   * 为什么不在 GameDefinition 上：as-built 的加载管线校验并持有 `attrs` 域，
   * 但 freeze 步骤未将其发布到 GameDefinition（06 号导出面缺口，见本轮报告）。
   * 本宿主以**显式注入**承接（调用方从包源解析后传入），不修改 engine 内部
   * ——缺口补齐归 06 号模块后续修复，届时 Options 增加缺省回落即可。
   */
  readonly attrDefs?: AttrDefs;
  /** 内容标签定义（data/content-tags.yaml 解析产物；同上，属 06 号导出面缺口） */
  readonly contentTags?: ContentTagsDef;
  /** 初始属性（attrs.yaml 的 init 投影；缺省空） */
  readonly initialAttrs?: Readonly<Record<string, number>>;
  /**
   * 初始钱包（多货币，FR-ECON-01）。
   *
   * 为什么需要显式注入：`wallet` 是表达式的**封闭域**（DD-01：缺 key 即
   * `EVAL_ERROR`，无静默默认值），而游戏包没有「钱包初值」的声明面
   * （`money` 效果只做增减）。因此形如 `wallet.<currency>` 的读取要求宿主
   * 在建档时先写入该货币——本选项即该写入口（缺省空 = 无货币可读）。
   */
  readonly initialWallet?: Readonly<Record<string, number>>;
  /** 初始已解锁区域（缺省：第一个区域） */
  readonly initialUnlockedAreas?: readonly GameId[];
  /** 随机种子（DD-09；缺省固定种子以便复现） */
  readonly seed?: number;
  /** 起始地点（缺省：入口场景所在区域；地图高亮的初始值） */
  readonly startLocation?: { readonly area: GameId; readonly location?: GameId };
}

/** 宿主级错误摘要（UI 错误卡片的数据面；控件不抛异常给 React） */
export interface HostError {
  readonly code: string;
  readonly messageKey: TextKey;
  readonly detail: string;
}

/** 游戏宿主公开面（apps 与测试的消费点） */
export interface GameHost {
  readonly store: UiStoreApi;
  /** 当前运行时（会话推进与调试面） */
  readonly runtime: GameRuntime;
  readonly resolver: TextResolver;
  /** 开始（或重开）一局：装配运行时与会话，投影初始界面 */
  start(): void;
  /** 推进一段（打字机结束后或点击继续） */
  advance(): void;
  /** 选择选项（内部先打 checkpoint；FR-READ-03） */
  choose(choiceId: string): void;
  /** 回退一步（rollback + 会话重建，FR-READ-03） */
  rollback(): void;
  /** 移动地点（时间消耗经推进管线，FR-XPLR-02） */
  moveTo(target: { readonly area: GameId; readonly location: GameId }): void;
  /** 当前日历投影（ClockBadge 数据源） */
  calendar(): CalendarView;
  /** 任务日志投影（QuestLogPanel 数据源） */
  questLog(): QuestLogView;
  /** 状态面板投影 */
  statusPanel(): ReturnType<typeof projectStatusPanel>;
  /** 区域图投影（地图面板数据源） */
  areas(): ReturnType<typeof projectAreaViews>;
  /** 当前位置（地图高亮） */
  location(): { readonly area: GameId; readonly location?: GameId };
  /** 本地化文本（UI 文案物化入口） */
  textOf(key: TextKey, vars?: InterpVars): string;
  /**
   * 当前玩家设置（宿主镜像；见 `updateSettings` TSDoc）。
   * 界面读设置一律经此处（而非 `runtime.state.settings`）——镜像才是权威。
   */
  settings(): PlayerSettings;
  /** 已注册语言清单（设置面板的语言选择项） */
  langs(): readonly string[];
  /** 版本三元组（设置面板「关于」区，FR-UI-08 数据源） */
  versions(): { engineVersion: string; gameVersion: string; schemaVersion: number };
  /**
   * 更新玩家设置（设置面板的写入面）。
   *
   * 语义：`settings` 的持久化归宿主（写入运行时状态树）；`disabledTags` 变更
   * 同时重建内容过滤（FR-CGRD-03 即时生效）。引擎不提供写 settings 的指令，
   * 故此处经 `newGameState` 之外的窄路径：以 `runtime.exec` 的 `set` 指令写
   * `world.flags` 不可达 settings——因此 settings 由**宿主侧镜像**持有并在
   * 存档序列化时合并（20 号 SaveService 落地前的过渡形态，见 TSDoc「设置语义」）。
   */
  updateSettings(partial: Partial<PlayerSettings>): void;
  /** 内容标签目录（首启向导/设置面板的数据源；空数组 = 游戏未声明分级） */
  wizardTags(): readonly ContentTagDef[];
  /**
   * 更新玩家禁用的内容标签（FR-CGRD-03 即时生效：内部重建 ContentFilter）。
   * 后续渲染的段落/选项立即采用新过滤集——已渲染的段落不追溯（与设计一致）。
   */
  setDisabledTags(disabledTags: readonly string[]): void;
  /** 最近一次错误（null = 无） */
  lastError(): HostError | null;
  /**
   * 接线缺口告警（约束 8 自检产物；`start()` 时刷新）。
   *
   * 用途：调试面板展示、「接线完备性」测试断言、E2E 在控制台校验。
   * 空数组 = 包内数据与宿主能力匹配（正常态）。
   */
  wiringWarnings(): readonly WiringWarning[];
  /** 换档/卸载时退订事件桥（防旧运行时事件串入） */
  dispose(): void;
}

/** 宿主默认随机种子（DD-09；演示可复现） */
export const DEFAULT_HOST_SEED = 2026;

/**
 * 创建游戏宿主（见模块 TSDoc）。
 *
 * @param options 定义与初始数据（见 {@link GameHostOptions}）
 */
export function createGameHost(options: GameHostOptions): GameHost {
  const { definition } = options;
  const seed = options.seed ?? DEFAULT_HOST_SEED;
  const store = createUiStore();
  const timeConfig = definition.time ?? DEFAULT_TIME_CONFIG;
  const mainLang = definition.manifest.mainLang;

  const resolver = createTextResolver({
    mainLang,
    locales: definition.locales,
    functionRegistry: definition.functionRegistry,
  });
  const mediaResolver = new MediaResolver({
    catalog: definition.mediaCatalog,
    onWarn: () => undefined,
  });

  /** 玩家禁用的内容标签（向导/设置写入；重建 ContentFilter 即生效，FR-CGRD-03） */
  /**
   * 玩家设置的宿主侧镜像（as-built 过渡形态）。
   *
   * 背景：引擎侧 `GameState.settings` 是**状态树字段**，但 02 号指令集没有写
   * settings 的指令（§3.3 的 set/add 只覆盖 attr/flag/counter/npc.flags）——
   * 玩家设置的写入路径在设计上是「宿主经 SaveService/序列化合并」（§6.5 设置项
   * 即 PlayerSettings 的表单化）。20 号 SaveService 落地前，本宿主以镜像持有
   * 并提供 `updateSettings`，序列化时由宿主合并进 blob.state.settings
   * （零语义改写：镜像初值取自 newGameState 的缺省设置）。
   */
  /**
   * 玩家设置的宿主侧镜像。
   *
   * **初值口径（M1 收尾修正）**：以 `DEFAULT_PLAYER_SETTINGS` 立即初始化，而非留
   * undefined 等到 `start()`——因为首启内容向导（FR-CGRD-04）在**开始游戏之前**
   * 就要读设置（语言/标签名经 `textOf` 物化、`setDisabledTags` 写标签开关）。
   * 留空会让这些读取落到 `requireRuntime()` 并抛「宿主未启动」，导致向导屏白屏。
   * `start()` 时以 `newGameState` 的缺省设置覆盖（两处同源）。
   */
  let settingsMirror: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS };
  let disabledTags: readonly string[] = [];
  const contentFilter = (): ContentFilter =>
    new ContentFilter({ tags: options.contentTags?.tags ?? [] }, { disabledTags });

  let runtime: GameRuntime | undefined;
  /**
   * 事件池持有者（约束 8 接线）：装配期创建（供 `__events.eval` 注入），
   * start 后由 `moveTo` 经 `locate()` 同步当前作用域（池按 area/location 过滤候选）。
   * 用 holder 对象是因为池在 `new GameRuntime` 之前构造、而位置在之后才更新。
   */
  const eventPoolHolder: { pool?: EventPool } = {};
  /** 接线缺口告警（constraint 8 自检产物；start() 时刷新，调试面板与测试消费） */
  let wiringWarnings: readonly WiringWarning[] = [];
  /** 叙事会话（每次 start/rollback 重建） */
  let session: SceneRunnerType | undefined;
  let unsubscribeBridge: Unsubscribe | undefined;
  let lastError: HostError | null = null;
  /** 当前位置（宿主态；见模块 TSDoc「位置语义」） */
  let currentLocation: { area: GameId; location?: GameId } = resolveStartLocation();

  /** 起始地点推导：显式传入优先，否则取入口场景所在区域 */
  function resolveStartLocation(): { area: GameId; location?: GameId } {
    if (options.startLocation !== undefined) return options.startLocation;
    const entry = definition.scenes.get(definition.manifest.entryScene);
    const area = entry?.def.area ?? [...definition.areas.keys()][0] ?? '';
    const firstLocation =
      definition.areas.get(area) !== undefined
        ? Object.keys(
            (definition.areas.get(area) as { locations: Record<string, unknown> }).locations,
          )[0]
        : undefined;
    return { area, ...(firstLocation !== undefined ? { location: firstLocation } : {}) };
  }

  /** 表达式求值：优先命加载期编译缓存，未命中即视为数据缺陷（返回 undefined/false） */
  const evalConditionSource = (source: string): boolean => {
    const compiled = definition.exprCache.get(source) as CompiledExpr | undefined;
    if (compiled === undefined || runtime === undefined) return false;
    return runtime.evalCondition(compiled);
  };

  /** 会话依赖的运行时最小视图（SceneRunnerRuntime 的结构化满足） */
  const runnerRuntime = (): SceneRunnerRuntime => {
    const rt = requireRuntime();
    return {
      get state() {
        return rt.state;
      },
      get rng() {
        return rt.rng;
      },
      exec: (effects: Parameters<GameRuntime['exec']>[0], ctx: ExecContext) =>
        rt.exec(effects, ctx),
      eval: (expr: CompiledExpr) => rt.eval(expr),
      evalCondition: (expr: CompiledExpr) => rt.evalCondition(expr),
      markSceneSeen: (sceneId: string) => {
        rt.markSceneSeen(sceneId);
      },
      markCgSeen: (assetId: string) => {
        rt.markCgSeen(assetId);
      },
    };
  };

  /** 运行时缺失即编程错误（装配次序：start 之后才有会话） */
  function requireRuntime(): GameRuntime {
    if (runtime === undefined) {
      throw new Error('宿主未启动：请先调用 start()');
    }
    return runtime;
  }

  /** 组装叙事会话（带内容过滤与媒体解析注入） */
  function createRunnerSession(rt: SceneRunnerRuntime, sceneId: GameId): SceneRunnerType {
    const filter = contentFilter();
    return new SceneRunner(rt, {
      def: definition,
      sceneId,
      params: () => buildInterpVars(),
      contentFilter: {
        passes: (tags?: readonly string[]) => filter.passes(tags),
        placeholderFor: (tags?: readonly string[]) => filter.placeholderFor(tags),
      },
      mediaResolver: { decorate: (intent) => mediaResolver.decorate(intent) },
      evalSpriteCondition: (source: string) => evalConditionSource(source),
      onWarn: () => undefined,
    });
  }

  /** 插值变量袋（延迟插值：每次渲染时组装，反映渲染时刻状态，FR-NARR-04） */
  function buildInterpVars(): InterpVars {
    const state = requireRuntime().state;
    return {
      player: {
        name: state.player.bootstrap.name,
        attrs: { ...state.player.attrs },
        wallet: { ...state.player.wallet },
      },
      world: { time: { day: state.world.time.day, slotIndex: state.world.time.slotIndex } },
      location: {
        area: currentLocation.area,
        ...(currentLocation.location !== undefined ? { location: currentLocation.location } : {}),
      },
    };
  }

  /** 会话投影：SceneRunner → SessionView（store 消费的只读快照） */
  function projectSession(runner: SceneRunnerType): SessionView {
    const segments = runner.renderList().map((segment) => ({
      kind: segment.kind,
      ...(segment.key !== undefined ? { key: segment.key } : {}),
      ...(segment.literal !== undefined ? { literal: segment.literal } : {}),
      ...(segment.vars !== undefined ? { vars: segment.vars } : {}),
      ...(segment.media !== undefined && segment.media.length > 0 ? { media: segment.media } : {}),
    }));
    const choices = runner.choices().map((choice) => ({
      id: choice.id,
      textKey: choice.textKey,
      enabled: choice.enabled,
      ...(choice.disabledReasonKey !== undefined
        ? { disabledReasonKey: choice.disabledReasonKey }
        : {}),
      ...(choice.hiddenByFilter === true ? { hiddenByFilter: true } : {}),
    }));
    const view: SessionView = {
      phase: runner.phase,
      sceneId: runner.currentSceneId,
      segments,
      choices,
      ...(runner.endReason !== undefined ? { endReason: runner.endReason } : {}),
      ...(runner.endingId !== undefined ? { endingId: runner.endingId } : {}),
    };
    return view;
  }

  /** 同步会话到 store（每次状态推进后调用；组件经 selector 消费） */
  function syncSession(): void {
    if (session === undefined) return;
    store.getState().setSession(projectSession(session));
    store.getState().setScreen('game');
  }

  /** 运行一段宿主操作并捕获错误（不把异常抛给 React；错误卡片消费 lastError） */
  function guard(action: () => void): void {
    // 先清空再执行：动作内部可显式设 lastError（如 NO_CHECKPOINT 的非异常路径）
    lastError = null;
    try {
      action();
    } catch (error) {
      lastError = toHostError(error);
    }
    syncSession();
  }

  /** 时间推进管线（每步注入步骤钩子；13/12/11 号挂载点，09 号编排） */
  function timePipeline(rt: GameRuntime): TimePipeline {
    return new TimePipeline({
      runtime: rt,
      config: timeConfig,
      statusTick: createItemTickProvider(),
      npcSchedule: createNpcScheduleProvider(timeConfig),
      // 步骤 6 事件池评估（§4.4；develop.md 约束 8「宿主接线完整性」）：
      // 此前缺失导致 10 条事件零触发——包内有 events.yaml 却无人评估。
      eventEval: createEventStepProvider(),
      questDeadline: createQuestDeadlineProvider(),
    });
  }

  const start = (): void => {
    const rng = createRng(seed);
    const state = newGameState(
      {
        versions: {
          gameVersion: definition.manifest.gameVersion,
          schemaVersion: definition.manifest.schemaVersion,
          minEngineVersion: definition.manifest.minEngineVersion,
        },
        attrs: { ...(options.initialAttrs ?? {}) },
        // 玩家设置在开局时**保留**（主菜单阶段可改语言/标签；见 start 尾部注释）
        settings: { ...settingsMirror },
        // 钱包初值（见 GameHostOptions.initialWallet：wallet 是封闭域，读前必须先有键）
        wallet: { ...(options.initialWallet ?? {}) },
        // NPC 播种（M1 收尾）：按包内声明的 NpcDef 为**全部** NPC 建记录（met=false、
        // favor 取 favor.min 或 0）。理由：`npc.<id>.*` 是**封闭域**（未建档即
        // EVAL_ERROR，用于保护 ID 拼写错误——03/12 号刻意语义），因此「尚未遇见」
        // 的条件（如 `!npc.ferryman.met`）必须靠**建档**表达，而不是靠引擎放宽语义。
        // 不播种的后果：新档读取任何未遇见 NPC 的条件都会抛错（M1 收尾实测阻断跨区域跳转）。
        npcs: Object.fromEntries(
          [...definition.npcs.values()].map((npc) => [
            npc.id,
            {
              favor: npc.favor?.min ?? 0,
              ...(npc.favor?.stages?.[0]?.id !== undefined
                ? { stage: npc.favor.stages[0].id }
                : {}),
              met: false,
            },
          ]),
        ),
        // 缺省解锁区域 = **入口场景所在区域**（语义口径，不是 areas.keys() 的首项：
        // 后者依赖字典序，多区域夹具下会解锁到字母序最前的区域而非玩家真正起步的区域。
        // 见 docs/architecture.md §5.4 宿主装配。）
        unlockedAreas: [
          ...(options.initialUnlockedAreas ??
            [definition.scenes.get(definition.manifest.entryScene)?.def.area].filter(
              (area): area is GameId => area !== undefined,
            )),
        ],
      },
      rng,
    );
    const machine = new QuestMachine({
      defs: definition.quests,
      questRefs: definition.poolIndex.questRefs,
    });
    const questEvaluator = createQuestConditionEvaluator({
      functionRegistry: definition.functionRegistry,
      rng,
    });
    runtime = new GameRuntime({
      state,
      rng,
      attrDefs: options.attrDefs,
      itemDefs: definition.items,
      functionRegistry: definition.functionRegistry,
      timeViewProvider: createTimeViewProvider(timeConfig),
      // 宿主装配的效果注册表：加载器产出的注册表缺 timeConfig 注入（06 号
      // 导出面缺口——`advance_time` / 移动消耗经 `__time.advance` 需要它），
      // 故宿主以公开构造器重新装配并补上 timeConfig；脚本扩展指令在此场景
      // 不参与（夹具无脚本），故直接以内置注册表为基座。
      effectExecutor: createBuiltinEffectRegistry({
        // 缺省 = 内置 20 函数（与运行时同源；脚本扩展归 23 号，夹具无脚本）
        functionRegistry: definition.functionRegistry,
        items: definition.items,
        npcs: definition.npcs,
        factions: definition.factions,
        quests: definition.quests,
        timeConfig,
        // 事件池注入（`__events.eval` 需要；develop.md 约束 8「宿主接线完整性」）：
        // 此前缺失导致包内 10 条事件零触发（有 events.yaml 却无人评估）。
        // require 的字符串求值走 exprCache（加载期编译）+ 运行时 evalCondition，
        // 与地图解锁条件（evalConditionSource）同一口径。
        eventPool: (eventPoolHolder.pool = new EventPool({
          events: definition.events,
          poolIndex: definition.poolIndex,
          area: currentLocation.area,
          ...(currentLocation.location !== undefined ? { location: currentLocation.location } : {}),
          config: timeConfig,
          // 闭包内懒取运行时：装配发生在 newGameState/new GameRuntime 之前，
          // 而池的实际求值总在 start() 之后（此时 requireRuntime 已可用）。
          runtime: {
            get state() {
              return requireRuntime().state as never;
            },
            eval: ((expr: unknown) => requireRuntime().eval(expr as never)) as never,
            evalCondition: ((expr: unknown) =>
              requireRuntime().evalCondition(expr as never)) as never,
            rng: { next: () => rng.next() },
          },
          evalRequire: (source) => evalConditionSource(source),
          contentFilter: contentFilter(),
        })),
      }),
      derivers: [
        createQuestDeriver(machine, {
          evaluator: questEvaluator,
          functionRegistry: definition.functionRegistry,
          rng,
        }),
        createNpcScheduleDeriver({
          npcs: definition.npcs,
          config: timeConfig,
          functionRegistry: definition.functionRegistry,
          rng,
        }),
      ],
    });
    unsubscribeBridge?.();
    unsubscribeBridge = bridgeRuntimeEvents(runtime, store);
    lastError = null;
    // 接线自检（develop.md 约束 8）：把「包内有数据但宿主未接线」显性化。
    // 不阻断启动（这是装配告警而非数据错误），但必须可见——写控制台并记入
    // 宿主告警列表，调试面板与 E2E 可断言（M1 收尾的「事件零触发」即此类缺口）。
    wiringWarnings = checkHostWiring(definition, {
      eventEval: true, // timePipeline 恒定接入（见 timePipeline 装配）
      statusTick: true,
      npcSchedule: true,
      questDeadline: true,
      bodyRevert: false, // 14 号的临时变身回退尚未接入管线（见 wiring-check 说明）
    });
    for (const warning of wiringWarnings) {
      // 显性化：控制台告警（宿主是浏览器包，直接 console.warn；文案用中文，
      // 与引擎侧 engine.warn 的「数据问题要看得见」标准一致）。
      console.warn(`[host-wiring-gap] ${warning.capability}: ${warning.detail}`);
    }
    // 玩家设置**跨开局保留**：主菜单阶段即可改语言/内容标签（FR-CGRD-04 向导、
    // FR-UI-05 设置面板）。此处把镜像同步进 store（受控回流），新档缺省由
    // newGameState 的 bootstrap.settings 承担（见上方 start 的 bootstrap 注入）。
    store.getState().setSettings(settingsMirror);
    session = createRunnerSession(runnerRuntime(), definition.manifest.entryScene);
    syncSession();
  };

  /** 已启动才可推进（未启动即编程错误，显性化） */
  const withSession = (action: (runner: SceneRunnerType) => void): void => {
    if (session === undefined) {
      lastError = {
        code: 'NOT_STARTED',
        messageKey: 'ui.error.not_started',
        detail: '宿主尚未调用 start()',
      };
      return;
    }
    action(session);
  };

  return {
    store,
    get runtime() {
      return requireRuntime();
    },
    resolver,
    start,
    advance: () =>
      guard(() => {
        withSession((runner) => runner.advance());
      }),
    choose: (choiceId) =>
      guard(() => {
        withSession((runner) => {
          const rt = requireRuntime();
          // 选择前 checkpoint（FR-READ-03）：先打点再执行，顺序不可交换；
          // 失败时会话可能停在 resolving，由宿主 rollback 恢复（§4.2 约定）
          const label = `choice:${runner.currentSceneId}:${choiceId}`;
          rt.checkpoint(label);
          try {
            runner.choose(choiceId);
          } catch (error) {
            rt.rollback(1);
            throw error;
          }
        });
      }),
    rollback: () =>
      guard(() => {
        const rt = requireRuntime();
        const result = rt.rollback(1);
        if (!result.ok) {
          lastError = {
            code: 'NO_CHECKPOINT',
            messageKey: 'ui.error.no_checkpoint',
            detail: '回滚栈为空',
          };
          return;
        }
        // 会话重建：回滚只还原状态，叙事位置须重开会话（§6.3「重建 session」）
        session = createRunnerSession(runnerRuntime(), definition.manifest.entryScene);
      }),
    moveTo: (target) =>
      guard(() => {
        const area = definition.areas.get(target.area);
        const location = area?.locations[target.location];
        if (location === undefined) {
          lastError = {
            code: 'UNKNOWN_LOCATION',
            messageKey: 'ui.error.unknown_location',
            detail: `${target.area}/${target.location}`,
          };
          return;
        }
        currentLocation = target;
        // 移动消耗经时间管线（一次推进 = 一个 undo 点，FR-XPLR-02）。
        // **事件跳转回流**（develop.md 约束 8）：管线步骤 6 的事件评估产出
        // `outcome.jumps`，必须注入当前会话来播放（事件场景按子会话进入，§4.2
        // 挂起栈）。此前宿主丢弃了 jumps → 事件永不呈现（内容完整性反思报告）。
        if (location.moveCost > 0) {
          // 事件池的作用域随位置更新（池按 area/location 过滤候选）
          const pool = eventPoolHolder.pool;
          if (pool !== undefined) pool.locate(target.area, target.location);
          const outcome = timePipeline(requireRuntime()).advance(location.moveCost);
          withSession((runner) => runner.applyFlowJumps(outcome.jumps));
        }
        syncSession();
      }),
    calendar: () => projectCalendar(requireRuntime().state.world.time, timeConfig),
    questLog: () => projectQuestLog(requireRuntime().state, definition.quests),
    statusPanel: () =>
      projectStatusPanel(requireRuntime().state, {
        attrDefs: options.attrDefs,
        items: definition.items,
      }),
    areas: () =>
      projectAreaViews(definition.areas, {
        unlockedAreas: requireRuntime().state.world.unlockedAreas,
        evaluate: evalConditionSource,
        includeLockedAreas: true,
      }),
    location: () => currentLocation,
    // 语言口径（M1 收尾修正）：按**当前设置语言**解析，而非固定 mainLang ——
    // 面板/UI 文案须随设置面板的语言切换即时变更（FR-L10N-05 运行时切换）；
    // 固定 mainLang 会让切换语言后所有组件文案仍停留在主语言。
    textOf: (key, vars) => resolver.resolve(key, settingsMirror.lang, vars).text,
    settings: () => settingsMirror,
    langs: () => [...definition.manifest.langs],
    // versions 在 start() 前也要可读（主菜单的设置抽屉会展示三版本号，FR-UI-05）：
    // engineVersion 取引擎常量而非 runtime 状态（两者同源：newGameState 写入的就是它）。
    versions: () => ({
      engineVersion: ENGINE_VERSION,
      gameVersion: definition.manifest.gameVersion,
      schemaVersion: definition.manifest.schemaVersion,
    }),
    updateSettings: (partial) => {
      const current = settingsMirror;
      settingsMirror = { ...current, ...partial };
      // 发布到 store（受控组件的回流路径；开局前也要发——主菜单即可改设置）
      store.getState().setSettings(settingsMirror);
      if (partial.disabledTags !== undefined) {
        disabledTags = [...partial.disabledTags];
        if (session !== undefined) {
          session = createRunnerSession(runnerRuntime(), session.currentSceneId);
        }
      }
      syncSession();
    },
    wizardTags: () => options.contentTags?.tags ?? [],
    setDisabledTags: (next) => {
      disabledTags = [...next];
      // 会话已建立：重建会话使新过滤集对后续 renderList/choices 生效
      if (session !== undefined && runtime !== undefined) {
        session = createRunnerSession(runnerRuntime(), session.currentSceneId);
      }
      syncSession();
    },
    lastError: () => lastError,
    wiringWarnings: () => wiringWarnings,
    dispose: () => {
      unsubscribeBridge?.();
      unsubscribeBridge = undefined;
    },
  };
}

/** 错误 → 宿主摘要（EngineError 取三元组；其余取 message） */
function toHostError(error: unknown): HostError {
  const candidate = error as { code?: string; messageKey?: string; message?: string };
  return {
    code: typeof candidate.code === 'string' ? candidate.code : 'INTERNAL',
    messageKey:
      typeof candidate.messageKey === 'string' ? candidate.messageKey : 'ui.error.internal',
    detail: typeof candidate.message === 'string' ? candidate.message : String(error),
  };
}
