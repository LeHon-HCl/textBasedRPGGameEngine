import { createRng } from '@game/shared';
import { EngineError } from '@game/shared';
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
  locationEntryKey,
  MediaResolver,
  newGameState,
  projectCalendar,
  projectQuestLog,
  QuestMachine,
  SaveService,
  SceneRunner,
  TimePipeline,
} from '@game/engine';
import type {
  CalendarView,
  ExecContext,
  GameDefinition,
  InterpVars,
  NarrativeHistoryEntry,
  PlayerSettings,
  QuestLogView,
  SaveBlob,
  SceneRunner as SceneRunnerType,
  SceneRunnerRuntime,
  TextResolver,
  Unsubscribe,
} from '@game/engine';
import { PersistenceError, selectAdapter } from '../persistence/index.js';
import type {
  AdapterSelection,
  PersistenceAdapter,
  SaveSlotSummary,
} from '../persistence/index.js';
// `UiPersistenceAdapter`（engine 契约 + `name` 诊断字段）尚未经 persistence 出口发布，
// 且本切片出口归属另一模块（禁止改其 index.ts）。类型导入不改变运行期结构，
// 故直接自内部 types 模块取用——与上方 `withSlotDisplayMeta` 同一理由。
import type { UiPersistenceAdapter } from '../persistence/types.js';
// `withSlotDisplayMeta` 在 persistence 切片的**内部**模块（types.ts）而不在其出口
// （出口只发布 projectSaveMeta(slot, blob)——它要求调用方先持有 blob）。本宿主只
// 有槽位元信息（listSaves 产物）、不需要读 blob，故直接取内部实现，避免为了一个
// 展示字段去逐槽 load 整档。不修改 persistence 切片（其出口归属另一模块）。
import { withSlotDisplayMeta } from '../persistence/types.js';
import { bridgeRuntimeEvents } from './types.js';
import { checkHostWiring } from './wiring-check.js';
import type { WiringWarning } from './wiring-check.js';
import { createUiStore } from './store.js';
import type { SessionView, UiStoreApi } from './types.js';
import { projectAreaViews } from '../panels/map-projection.js';
import { projectStatusPanel } from '../panels/types.js';
import { exploreCandidates } from '@game/engine';
import { projectHistory } from '../panels/history-projection.js';
import type { HistoryGroup } from '../panels/history-projection.js';
import { projectAchievementGallery } from '../panels/achievements-projection.js';
import {
  openShop,
  projectBattleSession,
  projectShopSession,
  startBattle,
  type BattleActionRequest,
  type BattleSessionView,
  type ShopSessionHandle,
  type ShopSessionView,
} from './panel-wiring.js';
import {
  AchievementEvaluator,
  createBuiltinCheckResolver,
  createMemoryProfileStore,
  recordAchievements,
} from '@game/engine';
import type { BattleController } from '@game/engine';

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
  /**
   * 开发者模式（FR-DEBG；2026-09-15 人类裁定）。
   *
   * 开启时地图**全量列出所有区域**（含未解锁），供开发/内容走查；关闭时只列
   * 已解锁区域（默认，FR-UI-02「地图展示已解锁区域/地点」）。
   * 完整调试面板（变量查看/修改、跳场景、时间快进）属 25 号 C 组，不在此处。
   */
  readonly developerMode?: boolean;
  /**
   * 持久化适配器（缺省：`selectAdapter` 自动选择——浏览器 Dexie、不可用时回落内存）。
   *
   * 为什么留这个注入缝：宿主是**可测的装配逻辑**，而真实探测依赖 IndexedDB
   * （jsdom 不提供）。测试据此注入 `MemoryAdapter` / 失败桩适配器，无需自己
   * 重写一份探测（探测逻辑的唯一事实源仍是 `persistence/fallback.ts`）。
   */
  readonly persistence?: PersistenceAdapter;
}

/** 宿主级错误摘要（UI 错误卡片的数据面；控件不抛异常给 React） */
export interface HostError {
  readonly code: string;
  readonly messageKey: TextKey;
  readonly detail: string;
}

/**
 * 持久化状态（存读档能力的环境诊断；`PrivacyBanner` 与控件禁用位的数据源）。
 *
 * 为什么发布到宿主面而不是让 UI 自己探测：探测是**异步一次**的装配动作
 * （`selectAdapter`），宿主持有结果才能保证「横幅显示的状态」与「实际写入
 * 用的适配器」是同一个（UI 再探一次会有竞态与双份真相）。
 */
export interface HostPersistenceStatus {
  /** 适配器是否就绪（false = 装配失败，存读档不可用） */
  readonly ready: boolean;
  /** 是否已降级到内存适配器（NFR-10；true 时须常驻导出提醒） */
  readonly degraded: boolean;
  /** 实际生效的适配器标识（'dexie' | 'memory'；未就绪时为空串） */
  readonly adapter: string;
  /** 降级原因（degraded=true 时有值；横幅文案源） */
  readonly reason?: string;
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
  /**
   * 回退 N 步（rollback + 会话重建，FR-READ-03；M2 验收第 4 条）。
   * 口径甲（2026-09-23 人类裁定）：状态精确还原；叙事位置按设计 §6.3
   * 重建会话至入口场景（叙事位置不保证）。
   * @param steps 回退的选择步数（缺省 1）
   */
  rollback(steps?: number): void;
  /** 历史回看投影（FR-READ-04；数据源 = 宿主累积历史 `historyLog`，见 #9 说明） */
  history(): ReturnType<typeof projectHistory>;
  /**
   * 当前可回退步数（历史面板 `canRollback` 的数据源，修 demo-issues #9c）。
   *
   * 语义：等于宿主回退锚点的条数（与引擎回滚栈同长同序，栈深上限
   * `PERF_GUARD.checkpointStackDepth`）。0 = 回滚栈空 → 面板应置灰回退按钮
   * （`canRollback={host.availableRollbackSteps() > 0}`）。
   */
  availableRollbackSteps(): number;

  // —— 面板接线（2026-09-25；引擎能力早已就绪，本次补齐宿主消费面） ——

  /** 当前商店会话（`shop_open` 事件置位；null = 未打开） */
  shopSession(): ShopSessionView | null;
  /** 商店操作：买 / 卖 / 关闭 */
  shopBuy(itemId: string, count?: number): { readonly ok: boolean; readonly detail: string };
  shopSell(itemId: string, count?: number): { readonly ok: boolean; readonly detail: string };
  closeShop(): void;

  /** 当前战斗会话（`battle_start` 事件置位；null = 未在战斗中） */
  battleSession(): BattleSessionView | null;
  /** 战斗操作：行动（skill/item/defend/flee）与目标选中 */
  battleAct(action: BattleActionRequest): void;

  /** 成就图鉴投影（FR-ACHV-04；Profile 在宿主侧以内存实现承接） */
  achievementGallery(): ReturnType<typeof projectAchievementGallery>;
  /** 成就进度刷新（事务后调用；评估器产出 → Profile 入账） */
  refreshAchievements(): void;
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

  // —— 存读档（FR-SAVE-01/03/04；demo-issues #11 的宿主入口） ——

  /**
   * 存档到槽位（FR-SAVE-01）。
   *
   * 语义：把**当前运行时状态**（`runtime.serialize()` + rngState + 版本三元组 +
   * meta）经 `SaveService` 写入槽位。持久层由 {@link persistenceStatus} 报告的
   * 适配器承载（浏览器 Dexie / 降级内存）。
   *
   * 失败显性化：写失败（quota 等）由 `SaveService` 抛 `SAVE_CORRUPT`，此处转成
   * `lastError`（与 `guard()` 同口径）并返回 `{ok:false, detail}`——**不静默**。
   *
   * @param slot 槽位 id（宿主命名；UI 固定槽位如 `slot_manual` 或 `quick`）
   */
  saveToSlot(slot: string): Promise<{ readonly ok: boolean; readonly detail?: string }>;
  /**
   * 从槽位读档并恢复（FR-SAVE-03）。
   *
   * 收口次序（**不可交换**，见 {@link loadFromSlot} 的实现注释）：
   * 状态就位（`SaveService.load` → `runtime.restore`，引擎已清回滚栈）
   * → 清历史缓冲（{@link resetHistoryBuffers}）
   * → 重建会话（{@link replaceSession}，场景取 `definition.manifest.entryScene`）
   * → 同步投影。
   *
   * 失败显性化：空槽位/版本过高/迁移失败/档损坏 → `lastError` 且**状态不变**。
   */
  loadFromSlot(slot: string): Promise<{ readonly ok: boolean; readonly detail?: string }>;
  /** 槽位摘要列表（存档/读档 UI 的数据源，FR-SAVE-01；空存储返回空数组） */
  listSlots(): Promise<readonly SaveSlotSummary[]>;
  /**
   * 导出槽位（FR-SAVE-04）：返回可下载/复制的 `SaveBlob`（JSON 文档）。
   *
   * 实现即 `SaveService.exportSlot`（= `loadBlob` 的别名）——本次不新增语义，
   * 宿主只是把它发布到公开面供 demo 触发下载。
   */
  exportSlot(slot: string): Promise<SaveBlob>;
  /**
   * 持久化状态（降级横幅 `PrivacyBanner` 的数据源，NFR-10）。
   *
   * `ready=false` = 适配器装配失败（连内存回落都不可用）——此时存读档一律
   * 以 `lastError` 拒绝，UI 应禁用入口。
   */
  persistenceStatus(): HostPersistenceStatus;

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
 * 战斗相位驱动的迭代上限（#8 死锁修复的防御边界）。
 *
 * 正常数据下「驱动到玩家可行动」只需几次 `beginTurn()`（队列长度 + 换轮），
 * 上限只为防御异常数据（如 AI 决策反复不收敛）导致的死循环——超限即经
 * `lastError` 显性化，不静默吞掉（与引擎「数据问题要看得见」同规）。
 */
const BATTLE_DRIVE_LIMIT = 100;

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
  /** 开发者模式（地图全量列出区域；见 GameHostOptions.developerMode） */
  const developerMode = options.developerMode ?? false;

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
  /**
   * 成就评估器持有者（装配期创建——需要 definition 的成就域与 refs 反查表）。
   * 用 holder 是因为评估器在 start 时才可构造（依赖定义），而调用面在返回对象里。
   */
  const achievementEvaluatorHolder: {
    evaluator: import('@game/engine').AchievementEvaluator | null;
  } = { evaluator: null };

  /** 商店会话（`shop_open` 事件置位；null = 未打开） */
  let shopHandle: ShopSessionHandle | null = null;
  /** 战斗控制器（`battle_start` 事件置位；null = 未在战斗中） */
  let battleController: BattleController | null = null;
  let battleEncounterId = '';
  /** 成就 Profile（宿主侧内存实现——DD-04：Profile 不在引擎；Dexie 归 25C） */
  const achievementStore = createMemoryProfileStore();
  /**
   * 已解锁成就缓存（同步镜像；评估器需要同步的已解锁集合，而 ProfileStore
   * 是异步接口——启动与每次评估后刷新，避免求值路径 await）。
   */
  let unlockedAchievements = new Set<string>();

  /** 叙事会话（每次 start/rollback 重建） */
  let session: SceneRunnerType | undefined;
  let unsubscribeBridge: Unsubscribe | undefined;
  let lastError: HostError | null = null;
  /** 当前位置（宿主态；见模块 TSDoc「位置语义」） */
  let currentLocation: { area: GameId; location?: GameId } = resolveStartLocation();

  // —— 存读档装配（FR-SAVE；demo-issues #11） ——
  //
  // **为什么在宿主而非 demo**：存读档不是「一根接线」，而是「宿主 API + 收口次序」
  // 的装配——读档必须与宿主自持的历史缓冲/会话重建协同（见 loadFromSlot 的次序
  // 注释），这些状态只有宿主持有。demo 只负责按钮与调用。
  //
  // 装配策略（**不自写探测**）：注入 `persistence` 则直接用；否则经既有
  // `selectAdapter()`（`persistence/fallback.ts` 的探测与三条降级路径）挑选——
  // 浏览器优先 DexieAdapter，不可用（隐私模式/无 IndexedDB/工厂抛错）时回落
  // MemoryAdapter。探测是异步的，而宿主构造是同步的，故以 **promise 持有 + 就绪
  // 回调** 承接：装配期立即发起，后续 save/load await 同一个 promise。
  /**
   * 适配器选择结果（异步装配；undefined 表示尚未完成）。
   * 用 promise 而非 await 构造：`createGameHost` 是同步 API（demo 在 mount 里直接
   * 调用并渲染），若改成异步会波及全部既有调用点（含 30+ 条测试）。
   */
  let adapterSelection:
    { adapter: PersistenceAdapter; degraded: boolean; reason?: string } | undefined;
  /** 适配器标识（诊断与降级提示；注入面可能给非 UI 侧适配器 → 取不到时回落 unknown） */
  let adapterDisplayName = '';
  /** 装配失败原因（连内存回落都不可用；仅在异常路径有值） */
  let adapterFailure: string | undefined;
  let saveService: SaveService | undefined;
  const persistenceReady: Promise<void> = (async () => {
    try {
      const selection: AdapterSelection | { adapter: PersistenceAdapter; degraded: false } =
        options.persistence !== undefined
          ? // 外部注入：视为已就绪（调用方对自己的适配器负责，探测语义由其决定）
            { adapter: options.persistence, degraded: false }
          : await selectAdapter();
      adapterSelection = selection;
      adapterDisplayName = readAdapterName(selection.adapter);
      saveService = new SaveService({ adapter: selection.adapter });
    } catch (error) {
      // `selectAdapter` 自身承诺不抛（探测/工厂异常都被它吞成降级结果），
      // 走到这里的只有「内存回落也失败」这类不可恢复情形——显性化，不静默。
      adapterFailure = error instanceof Error ? error.message : String(error);
    }
  })();

  /**
   * 等待持久层就绪并返回服务（未就绪即记 `lastError` 并返回 null）。
   *
   * 为什么每次存读档都 await 而非「就绪后再暴露按钮」：装配是异步的，而玩家可能
   * 在装配完成前就点了按钮——await 同一 promise 让首次点击自然排队，不必让 UI
   * 处理「还没好」。失败路径统一走 `lastError`（错误卡片可见）。
   */
  async function requireSaveService(): Promise<SaveService | null> {
    await persistenceReady;
    if (adapterFailure !== undefined) {
      lastError = {
        code: 'PERSISTENCE_UNAVAILABLE',
        messageKey: 'ui.error.internal',
        detail: `持久化适配器装配失败：${adapterFailure}`,
      };
      return null;
    }
    if (saveService === undefined) {
      lastError = {
        code: 'PERSISTENCE_UNAVAILABLE',
        messageKey: 'ui.error.internal',
        detail: '持久化服务未就绪',
      };
      return null;
    }
    return saveService;
  }

  /**
   * 存档时刻所在场景 id（`SaveInput.location`，FR-SAVE-01「位置」）。
   * 优先取当前会话场景；会话未建立时回落入口场景（此时也没什么东西可存）。
   */
  function currentSceneId(): GameId {
    return session?.currentSceneId ?? definition.manifest.entryScene;
  }

  // —— 历史保留与回退截断（demo-issues #9，2026-09-26） ——
  //
  // **为什么宿主要自持历史**：`SceneRunner` 的历史环形缓冲属于**会话对象**，
  // 而回滚必须重建会话（设计 §6.3：回滚只还原 GameState，叙事位置须重开会话
  // ——M2 验收口径甲，已知且已裁定）。重建后新会话历史为空 → 历史面板从多组
  // 塌成入口场景 1 组，玩家看到「退一步像全退了」（用户实测 #9）。历史缓冲
  // 不属于状态树，回滚不该把它清掉——故在宿主侧累积并按其截断。
  //
  // 引擎无历史播种 API，且引擎 rollback 语义正确（弹出最近 steps 个快照）——
  // 全部修复在宿主侧完成，**不改引擎**。
  /**
   * 跨会话重建累积的历史（FR-READ-04 的宿主权威数据面）。
   *
   * `seq` 由宿主重编号（{@link historySeq}）：`SceneRunner` 的 seq 是**会话内**
   * 自增的，会话替换后从 0 重来——直接沿用会让投影的 seq 重复、历史面板的
   * React key 冲突、排序失真。
   */
  const historyLog: NarrativeHistoryEntry[] = [];
  /** 宿主侧单调递增序号分配器（跨会话可比、唯一且有序） */
  let historySeq = 0;
  /**
   * **本会话已入账条数**（`historyLog` 累积的游标）。
   *
   * 为什么不用「seq 比对」判断是否已入账：会话内 seq 从 0 重新开始，会话被
   * 替换后旧判据会把新会话的条目录成「已入账」（丢历史）或重复入账。
   * **任何替换 session 的地方都必须把它清零**——见 `replaceSession()`。
   */
  let accumulatedInSession = 0;
  /**
   * 回退锚点（与引擎回滚栈**同长同序**）：每次打检查点的同一时刻记录当时的
   * `historyLog.length`。引擎栈超深丢最旧（`PERF_GUARD.checkpointStackDepth`），
   * 故宿主也必须 `shift()` 保持镜像——否则回滚截断会指向错误的界。
   */
  const rollbackMarks: number[] = [];

  /**
   * 把当前会话历史中**尚未入账的尾部**追加进 {@link historyLog}（重编号 seq）。
   *
   * 调用时机：每次 `syncSession()` 前（即状态推进后）。**必须先于**记录
   * `rollbackMarks`——否则 mark 会指向错误的截断点（后续回滚会截错位置）。
   */
  function accumulateHistory(): void {
    if (session === undefined) return;
    const entries = session.history();
    for (let i = accumulatedInSession; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry === undefined) continue; // 不可达：i < entries.length
      historyLog.push({ ...entry, seq: historySeq });
      historySeq += 1;
    }
    accumulatedInSession = entries.length;
  }

  /**
   * 替换叙事会话（**唯一的会话替换入口**）：重建后清空「本会话已入账条数」游标，
   * 使新会话的历史从下标 0 起被累积（历史本体跨会话保留——#9 的修复要点）。
   *
   * 为什么收敛到一个函数：会话替换点散落多处（rollback 重建、choose 失败重建、
   * 设置/导航/事件切场景），任一处漏清游标都会导致历史丢失或重复入账。
   */
  function replaceSession(sceneId: GameId): void {
    session = createRunnerSession(runnerRuntime(), sceneId);
    accumulatedInSession = 0;
  }

  /**
   * 记录回退锚点（在 `rt.checkpoint()` 的**同一时刻**调用；镜像引擎的丢最旧）。
   *
   * 顺序约定：调用方必须**先** {@link accumulateHistory} 再调本函数，
   * 使 mark 指向「该检查点当时的 historyLog 长度」。
   *
   * @param limit 引擎回滚栈**当前的**深度（`rt.state.checkpoints.length`）。
   *   用它而非硬编码 `PERF_GUARD.checkpointStackDepth`：宿主未配置
   *   `checkpointLimit` 时两者同值，但以引擎的镜像为准可避免「将来有人在宿主
   *   传入自定义栈深」时两份账本静默漂移（本函数的唯一职责就是与引擎同长同序）。
   */
  function markRollbackPoint(limit: number): void {
    rollbackMarks.push(historyLog.length);
    while (rollbackMarks.length > limit) rollbackMarks.shift();
  }

  /**
   * 回滚时截断历史到对应的检查点位置（#9 的截断口径）。
   *
   * 与引擎 `rollback(steps)` 的对应关系：引擎弹出的是**最近的 steps 个**
   * 快照（`popped[0]` 是最早的那个 = 我们将要恢复到的目标检查点）。故：
   * - 宿主同样弹出最近 steps 个 mark：`splice(len - steps, steps)`；
   * - 截断目标 = `popped[0]`——最早被回退到的那个检查点当时的 `historyLog.length`；
   * - 若 steps **清空了** marks（回滚栈见底 = 回到最初状态）→ 截断目标 = 0：
   *   此时玩家的状态就是开局状态，历史面板应只呈现重建后的入口场景，
   *   不保留「回到最初之前」的残留（否则会显出与当前状态不符的重复分组）。
   */
  function truncateHistoryForRollback(steps: number): void {
    if (steps <= 0) return;
    const count = Math.min(steps, rollbackMarks.length);
    const popped = count > 0 ? rollbackMarks.splice(rollbackMarks.length - count, count) : [];
    // 栈见底 → 0；否则截到最早被弹出的那个检查点记下的长度
    const target = popped.length === 0 || rollbackMarks.length === 0 ? 0 : (popped[0] as number);
    if (historyLog.length > target) historyLog.length = target;
  }

  /** 清空历史缓冲与回退锚点（与引擎清空快照栈同规；读档/重开用） */
  function resetHistoryBuffers(): void {
    historyLog.length = 0;
    rollbackMarks.length = 0;
    historySeq = 0;
    accumulatedInSession = 0;
  }

  /**
   * 为历史分组附带**回退步数**（修 demo-issues #9b）。
   *
   * 语义：`rollbackSteps` = 从当前位置回退到**该组刚开始时**的状态所需的检查点
   * 步数——即「回退 N 步到这里」的「这里」是该组本身。
   *
   * 推导（口径须与引擎 `rollback` 精确对齐，差一格就是点不动或退错位的按钮）：
   * - 设分组边界 `e_0=0 < e_1 < … < e_m=L`（`e_j` = 前 j 组的条目数），组 `G_j`
   *   覆盖 `[e_{j-1}, e_j)`；
   * - {@link rollbackMarks}[i] = 第 i 次检查点**当时**的 `historyLog.length`。
   *   `SceneRunner` 的选项只在段落揭示完毕后才出现，故「在 `G_j` 里做的第一次
   *   选择」那时的历史长度恰好是 **`e_j`（该组的结束边界）**；
   * - 引擎 `rollback(steps)` 恢复 `popped[0]` = marks 的第 `available-steps` 项
   *   → `steps = available - index`（index = 命中的 mark 下标）；
   * - 取**最早**命中者（`indexOf`）：该检查点的状态正是「`G_j` 的文本刚展示完、
   *   尚未做出组内任何选择」= **该组开始时的状态**。取最新者会退到组内后续
   *   选择之后的状态（退不回「这里」）。
   *
   * 无对应 mark 的组 → **不附字段**（面板据此不渲染按钮）：当前组若还没做过组内
   * 选择（无处可退）、由时间推进/事件/战斗回流开出的组、或已随栈深丢最旧的组
   * 都属此类。宁可没有按钮，也不给会报错的错按钮（自算「分组距离」正是 #9b 的病根）。
   */
  function withRollbackSteps(groups: readonly HistoryGroup[]): readonly HistoryGroup[] {
    const available = rollbackMarks.length;
    if (available === 0) return groups;
    let end = 0;
    return groups.map((group) => {
      end += group.entries.length;
      const index = rollbackMarks.indexOf(end);
      if (index < 0) return group;
      const steps = available - index;
      if (steps <= 0) return group; // 不可达：index < available 恒成立，保留作纵深防御
      return { ...group, rollbackSteps: steps };
    });
  }

  /**
   * 文本物化的**单一入口**（历史投影与 `textOf` 共用口径）。
   *
   * 语言来源 = {@link settingsMirror}.lang（当前设置语言），不是包主语言
   * `mainLang`——切换语言后历史条目须随叙事区一起变（FR-L10N-05）。
   * 每次调用现读镜像，故 `updateSettings` 之后无需重建投影即生效。
   *
   * 历史投影此前未传 resolver（`projectHistory(historyLog)`），缺省降级直接用键，
   * 导致玩家在历史面板看到 `scenes.arrival.open` 这类原始文本键（问题 #5）。
   */
  const resolveText = (key: TextKey, vars?: InterpVars): string =>
    resolver.resolve(key, settingsMirror.lang, vars).text;

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
    // 历史累积（#9）：**投影之后**再累积——`projectSession` 内部的 `renderList()`
    // 才是段落揭示/历史入账的触发点（`SceneRunner.#pushHistory` 在渲染时写入），
    // 先累积会漏掉本次新揭示的段落（表现为 history() 总慢一拍）。
    const view = projectSession(session);
    accumulateHistory();
    store.getState().setSession(view);
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
        // 阵营声望播种（约束 8）：`faction.<id>` 是表达式封闭域（缺 key 即 EVAL_ERROR），
        // 而 NPC 日程的 showIf（如 'faction.town >= 0'）等条件会读它——不播种则
        // 任何声望条件都抛错（M1 验收路径实测暴露，与 NPC/钱包同类的「包内有数据
        // 未初始化进状态」缺口）。初值取 FactionDef.init。
        factions: Object.fromEntries(
          [...definition.factions.values()].map((faction) => [faction.id, faction.init]),
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
        // 商店目录注入（约束 8 同款缺口）：`__shop.set_stock` 读 options.shops
        // 判「有限/无限库存」——不注入则所有商品被视为无限库存，交易不记账
        // （L2-A 检查 + panel-wiring 测试抓出；与 M1「事件零触发」同类装配遗漏）
        shops: definition.shops,
        // 判定规则解析器（15 号）：`check` 指令经它解析 coc/generic 规则——
        // **不注入则检定抛错**（EFFECT_FAILED，被 guard 吞进 lastError），
        // 表现为「点了检定选项但什么都没发生」（L2-C 主线检查抓出；
        // GameDefinition 未发布该面，属 06 号导出面缺口的第四例）。
        checkResolver: createBuiltinCheckResolver(),
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
    // —— 面板接线（2026-09-25）：消费 shop_open / battle_start 事件 ——
    // 这两个事件此前**无人消费**（引擎已 emit、宿主未订阅），导致浏览器里点
    // 「逛杂货铺」「打岩鼠」完全没反应（L2-A 检查抓出的真实缺口）。
    unsubscribeShop?.();
    unsubscribeShop = runtime.on('shop_open', (event) => {
      const handle = openShop(
        {
          definition,
          runtime: requireRuntime(),
          rng,
          ...(definition.items.size > 0 ? { items: definition.items } : {}),
        },
        event.shop as never,
      );
      if (handle === null) {
        lastError = {
          code: 'UNKNOWN_SHOP',
          messageKey: 'ui.error.unknown_shop',
          detail: `商店 '${event.shop}' 不存在于游戏包`,
        };
        return;
      }
      shopHandle = handle;
      store.getState().openPanel('shop' as never); // 'shop' 为本次新增面板 id
    });
    unsubscribeBattle?.();
    unsubscribeBattle = runtime.on('battle_start', (event) => {
      // 引擎的 battle_start 携带三分支（指令参数面）——控制器据此建会话
      const controller = startBattle(
        {
          definition,
          runtime: requireRuntime(),
          rng,
          // 玩家技能：从运行时技能表投影 + 一件缺省基础攻击（游戏包无战斗技能
          // 声明时仍可行动——否则玩家在战斗里无任何可用指令，只能防御/逃跑）
          playerSkills: (() => {
            const skills = Object.entries(requireRuntime().state.player.skills).map(([id]) => ({
              id,
            }));
            return skills.length > 0 ? skills : [{ id: 'strike' }];
          })(),
        },
        event.encounter,
        {
          ...(event.onVictory !== undefined ? { onVictory: event.onVictory } : {}),
          ...(event.onDefeat !== undefined ? { onDefeat: event.onDefeat } : {}),
          ...(event.onEscape !== undefined ? { onEscape: event.onEscape } : {}),
        },
      );
      battleController = controller;
      battleEncounterId = event.encounter;
      store.getState().openPanel('battle' as never);
      // **起步驱动（#8，2026-09-26）**：会话构造后相位是 turn_order，而面板只在
      // await_player 渲染行动按钮——不在此驱动，玩家看不到任何按钮（「等待你的
      // 行动…」是假提示：此时等的是宿主），战斗永久卡死。驱动到玩家可行动或终局。
      driveBattle(controller);
      if (controller.session.result() !== null) {
        // 起步即终局（如首轮敌方全灭/玩家倒下）：与 battleAct 的终局消费同一条路径
        consumeBattleOutcome(controller);
      }
    });
    // 成就评估（18 号）：解锁链路是「引擎评估 → 宿主 mutate Profile」——
    // 启动时同步一次已解锁集合，事务后按 touched 增量评估（桥接来自 store）。
    void achievementStore.load().then((profile) => {
      unlockedAchievements = new Set(Object.keys(profile.achievements));
    });
    if (definition.achievements.size > 0) {
      achievementEvaluatorHolder.evaluator = new AchievementEvaluator({
        achievements: definition.achievements,
        refs: definition.poolIndex.achievementRefs,
        functionRegistry: definition.functionRegistry,
        rng,
      });
    }
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
    // 新档：历史缓冲与回退锚点必须清空——与引擎「新状态树的 checkpoints=[]」
    // 同规（`newGameState` 已清空快照栈）；不清则上一局的历史会串进新档。
    resetHistoryBuffers();
    replaceSession(definition.manifest.entryScene);
    syncSession();
  };

  /** 面板事件的订阅句柄（start 时建立；重复 start 前先解绑） */
  let unsubscribeShop: (() => void) | undefined;
  let unsubscribeBattle: (() => void) | undefined;

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

  // —— 存读档实现（FR-SAVE；demo-issues #11） ——

  /**
   * 「未开始」守卫（存读档的公共前置）。
   *
   * 口径与 {@link withSession} 一致：`session === undefined` 即宿主未 start
   * （start 同时建立 runtime 与 session；两者只在 dispose/未启动时缺失）。
   * 处理方式也是同一风格——**记 `lastError` 并返回 false**，不抛异常、不静默：
   * 未就绪时不写半成品档、也不做无意义的空恢复。
   *
   * @param action 动作名（错误文案用：'存档' / '读档'）
   */
  function requireStarted(action: '存档' | '读档'): boolean {
    if (session !== undefined) return true;
    lastError = {
      code: 'NOT_STARTED',
      messageKey: 'ui.error.not_started',
      detail: `宿主尚未调用 start()，无法${action}（缺少可用的会话）`,
    };
    return false;
  }

  /**
   * 存档：把当前运行时状态写入槽位。
   *
   * 失败路径**全部**转成 `lastError` 与 `{ok:false}`：
   * - 未 start（`session === undefined`）→ `NOT_STARTED`（见 {@link requireStarted}）；
   * - 适配器未就绪/装配失败 → `PERSISTENCE_UNAVAILABLE`；
   * - 写失败（quota 等）→ `SaveService` 抛 `SAVE_CORRUPT` / `EngineError`，
   *   经 {@link toHostError} 取 code 与 messageKey（保留 MIGRATION_FAILED /
   *   SAVE_CORRUPT 等引擎码，不被抹成 INTERNAL）。
   *
   * @param slot 槽位 id（宿主命名；FR-SAVE-01）
   */
  async function saveToSlot(slot: string): Promise<{ ok: boolean; detail?: string }> {
    if (!requireStarted('存档') || runtime === undefined) {
      return { ok: false, detail: lastError?.detail ?? '宿主未启动' };
    }
    const service = await requireSaveService();
    if (service === null) {
      return { ok: false, detail: lastError?.detail ?? '持久化服务不可用' };
    }
    const rt = runtime;
    try {
      await service.save(slot, {
        runtime: rt,
        location: currentSceneId(),
        // 游玩时长（FR-SAVE-01）：状态树 readStats.playSeconds 是权威累计面
        // （时间管线/读取统计写入），meta 只是快照——不另立宿主计时器（双份真相）。
        playSeconds: rt.state.readStats.playSeconds,
      });
      lastError = null;
      return { ok: true };
    } catch (error) {
      lastError = toHostError(error);
      return { ok: false, detail: lastError.detail };
    }
  }

  /**
   * 读档：从槽位恢复运行时状态并**收口**到可继续游玩。
   *
   * ## 收口次序（不可交换，逐条给理由）
   *
   * 1. **状态就位**：`SaveService.load(slot, runtime)` 内部完成「读取 → 版本闸门
   *    → 迁移 → Zod 终验 → `runtime.restore(blob)`」。引擎的 `restore` 会清空
   *    回滚栈（#246 已实现），故本步之后 `availableRollbackSteps()` 也应为 0
   *    ——这正是「跨档不沿用旧检查点」的保证（旧检查点快照属于旧状态树，沿用
   *    会退到不属于本档的状态）。
   * 2. **清历史缓冲**：`historyLog` / `rollbackMarks` / `historySeq` 是宿主自持的
   *    跨会话累积面（#9），**不属于状态树**，`runtime.restore` 不会碰它。不清则
   *    旧档的历史会串进新档（历史面板显示不属于本档的段落，回退锚点指向错误的
   *    截断界）。顺序上必须先于 `replaceSession`：后者会重置
   *    `accumulatedInSession` 游标，若先重建再清缓冲，第 1 步 `accumulateHistory`
   *    就可能把新会话的段落记进尚未清空的旧 `historyLog`。
   * 3. **重建会话**：`replaceSession(entryScene)` —— 唯一的会话替换入口，同时清零
   *    `accumulatedInSession` 游标（否则新会话历史从错误的游标起点累积）。场景取
   *    `definition.manifest.entryScene`：**与 rollback 同规（口径甲，2026-09-23
   *    人类裁定）**——状态精确还原，叙事位置按设计 §6.3 重建至入口场景（叙事
   *    位置不保证）。存档里没有会话位置（`SaveMeta.location` 只是展示元信息），
   *    若要精确还原需扩展 CheckpointMeta，属 M4 打磨项。
   * 4. **同步投影**：`syncSession()` 把新会话投影进 store（组件据此重渲染）。
   *
   * ## 失败语义（状态不变）
   * `SaveService.load` 的失败分支（`VERSION_UNSUPPORTED` / `MIGRATION_FAILED`）
   * 与适配器/Zod 抛错（空槽位 → `SAVE_CORRUPT`）都在**触碰会话之前**返回/抛出，
   * 故失败时运行时状态与会话均保持原样——只写 `lastError`（错误卡片可见）。
   *
   * @param slot 槽位 id
   */
  async function loadFromSlot(slot: string): Promise<{ ok: boolean; detail?: string }> {
    if (!requireStarted('读档') || runtime === undefined) {
      return { ok: false, detail: lastError?.detail ?? '宿主未启动' };
    }
    const service = await requireSaveService();
    if (service === null) {
      return { ok: false, detail: lastError?.detail ?? '持久化服务不可用' };
    }
    const rt = runtime;
    let result: Awaited<ReturnType<SaveService['load']>>;
    try {
      result = await service.load(slot, rt);
    } catch (error) {
      // 空槽位（适配器抛）/ 档损坏（Zod 终验）：`runtime.restore` 未被调用，
      // 状态不变——只显性化错误。
      lastError = toHostError(error);
      return { ok: false, detail: lastError.detail };
    }
    if (!result.ok) {
      // 版本闸门拒绝（VERSION_UNSUPPORTED / MIGRATION_FAILED）：引擎承诺不触碰
      // 运行时数据（FR-MIGR-02），宿主同样不收口——状态保持原样。
      lastError = {
        code: result.reason,
        // 两个键都是**运行时产出**的引擎/宿主内部键（不出现在 data/ 中），
        // 依 2026-09-27 裁定「引擎内置键由引擎随包提供基础词典」——宿主无需
        // 为它们找游戏包译文（#10 的边界）。命名沿用引擎存档子系统的
        // `error.save.*` 前缀（与 `error.save.writeFailed` / `slotMissing` 同域）。
        messageKey:
          result.reason === 'VERSION_UNSUPPORTED'
            ? 'error.save.versionUnsupported'
            : 'error.save.migrationFailed',
        detail: result.detail,
      };
      return { ok: false, detail: result.detail };
    }
    // 收口（次序见 TSDoc）：状态已就位 → 清历史缓冲 → 重建会话 → 同步投影。
    resetHistoryBuffers();
    replaceSession(definition.manifest.entryScene);
    lastError = null;
    syncSession();
    return { ok: true };
  }

  /** 槽位摘要列表（listSaves + UI 展示口径；空存储返回空数组） */
  async function listSlots(): Promise<readonly SaveSlotSummary[]> {
    const service = await requireSaveService();
    if (service === null) return [];
    try {
      const metas = await service.listSaves();
      // 叠加 UI 展示口径（slotName 分组字段）——单一事实源仍在 persistence 切片，
      // 本处只做「元信息 → 展示摘要」的组合（不读 blob，避免逐槽 load 整档）。
      return metas.map((meta) => withSlotDisplayMeta(meta.slot, meta));
    } catch (error) {
      lastError = toHostError(error);
      return [];
    }
  }

  /** 导出槽位（FR-SAVE-04：blob 即 JSON 文档，由 demo 触发下载） */
  async function exportSlot(slot: string): Promise<SaveBlob> {
    const service = await requireSaveService();
    if (service === null) {
      // 与其余失败路径同口径：`requireSaveService` 已记 `lastError`（错误卡片
      // 可见），此处再抛。本方法返回类型是 SaveBlob（调用方要 blob 才能下载），
      // 无法用 ok/detail 表达失败，故异常是唯一出口；用 EngineError 保持
      // 「code + messageKey」三元组约定（UI 层禁裸 throw new Error）。
      // messageKey 复用宿主既有的 `ui.error.internal`（不新造键——键面归属
      // 是 #10 的收尾范围）。
      throw new EngineError({
        code: 'SAVE_CORRUPT',
        messageKey: 'ui.error.internal',
        where: { slot, operation: 'export' },
      });
    }
    try {
      return await service.exportSlot(slot);
    } catch (error) {
      lastError = toHostError(error);
      throw error;
    }
  }

  /** 持久化状态（降级横幅数据源；见 GameHost.persistenceStatus） */
  function persistenceStatus(): HostPersistenceStatus {
    if (adapterFailure !== undefined) {
      return {
        ready: false,
        degraded: false,
        adapter: '',
        reason: adapterFailure,
      };
    }
    const selection = adapterSelection;
    if (selection === undefined) {
      // 装配中：尚未探测完。报告「未就绪」但**不**报降级（避免横幅闪一下），
      // UI 若要禁用入口应看 ready。
      return { ready: false, degraded: false, adapter: '' };
    }
    return {
      ready: true,
      degraded: selection.degraded,
      adapter: adapterDisplayName,
      ...(selection.reason !== undefined ? { reason: selection.reason } : {}),
    };
  }

  // —— 战斗相位驱动（#8 死锁修复，2026-09-26） ——

  /**
   * 把战斗会话从 `turn_order` 驱动到**玩家可行动或终局**（有界循环）。
   *
   * 为什么必须有这个函数：`BattleSession` 构造后相位是 `turn_order`（八相位状态机
   * 第一相），而 `BattlePanel` 只在 `phase === 'await_player'` 时渲染行动按钮
   * （`BattlePanel.tsx` 的 `canAct`）——`turn_order` 落进 else 只显示
   * 「等待你的行动…」。此前的宿主只在**收到玩家行动之后**才调 `beginTurn()`，
   * 没有按钮就没人能发出第一次行动 → 战斗永久卡死（用户实测 #8）。
   *
   * 相位语义（引擎 `session.ts#beginTurn`）：弹出队首——玩家侧 → 返回
   * `await_player`（停，等输入）；敌方侧 → **内部完成 AI 决策与结算**并把相位
   * 收敛到 `victory`/`defeat`/`escaped`/`turn_order`。故须循环：相位仍为
   * `turn_order` 就继续 `beginTurn()`，直到玩家可行动或终局。
   *
   * 迭代上限（{@link BATTLE_DRIVE_LIMIT}）防御异常数据导致的死循环——超限经
   * `lastError` 显性化，**不静默吞掉**（与宿主既有错误机制同规）。
   *
   * 异常捕获：`driveBattle` 会在 `battle_start` 订阅内被调用，而引擎的事件送达
   * 会**隔离监听器异常**（`GameRuntime.#dispatch` 的 try/catch 静默）——不在此
   * 捕获则 AI/结算异常会变成「面板打开但相位停在 turn_order」的静默死锁。
   * 故统一转成 `lastError`（错误卡片可消费），与 `guard()` 同口径。
   */
  function driveBattle(controller: BattleController): void {
    const battleSession = controller.session;
    try {
      for (let guard = 0; battleSession.result() === null; guard += 1) {
        // 玩家可行动 = 停点；其余非 turn_order 相位（理论上不可达）也停，避免空转
        if (battleSession.phase() !== 'turn_order') return;
        if (guard >= BATTLE_DRIVE_LIMIT) {
          lastError = {
            code: 'BATTLE_DRIVE_LIMIT',
            messageKey: 'ui.error.internal',
            detail: `战斗相位驱动超过 ${String(BATTLE_DRIVE_LIMIT)} 次仍未到玩家可行动或终局（encounter=${battleEncounterId}）`,
          };
          return;
        }
        battleSession.beginTurn();
      }
    } catch (error) {
      lastError = toHostError(error);
    }
  }

  /**
   * 终局消费（与 `battleAct` 同一条路径，两处不漂移）：`pollOutcome()` 执行路由
   * 效果（rewards + 分支）→ 清控制器 → 关面板 → `jumps` 经 `withSession` 注回叙事。
   *
   * @returns 是否已消费终局（false = 会话未终局或已消费过）
   */
  function consumeBattleOutcome(controller: BattleController): boolean {
    const outcome = controller.pollOutcome();
    if (outcome === null) return false;
    battleController = null;
    store.getState().openPanel(null);
    if (outcome.jumps.length > 0) {
      withSession((runner) => runner.applyFlowJumps(outcome.jumps));
    }
    return true;
  }

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
          const sceneBefore = runner.currentSceneId;
          // 回退锚点与引擎检查点**同时**记录：先累积本轮已渲染的历史（使 mark
          // 指向该检查点当时的 historyLog 长度），再打点。顺序不可交换。
          accumulateHistory();
          rt.checkpoint(label);
          markRollbackPoint(rt.state.checkpoints.length);
          try {
            runner.choose(choiceId);
          } catch (error) {
            rt.rollback(1);
            // **会话重建（2026-09-15 修复）**：状态回滚只还原状态树，会话仍停在
            // `resolving` 错误挂起态（设计 §4.2），而 `choices()` 仅在该相位为
            // `await_choice` 时返回列表——不重建则选项全部消失、玩家卡死在场景
            // （用户实测：重复点击「辨认徽记」触发 EFFECT_FAILED 后无任何选项）。
            // 在**失败前所在场景**重开会话：玩家留在原处、可另选其他选项。
            // 回退锚点同步弹出（引擎已 popped 一个快照；不弹则后续截断错位）。
            truncateHistoryForRollback(1);
            replaceSession(sceneBefore);
            throw error;
          }
        });
      }),
    rollback: (steps = 1) =>
      guard(() => {
        const rt = requireRuntime();
        // 步数前置校验（显性化）：引擎 rollback 会把超深步数 clamp 到可用快照数
        // ——那会让「回退 5 步」在只剩 2 个快照时静默只退 2 步。宿主按状态树的
        // checkpoints 镜像（与内部栈同步维护）先判可用性，不足即报错不改状态。
        const available = rt.state.checkpoints.length;
        if (steps > available) {
          lastError = {
            code: 'NO_CHECKPOINT',
            messageKey: 'ui.error.no_checkpoint',
            detail: `回滚栈仅有 ${String(available)} 步，请求 ${String(steps)} 步`,
          };
          return;
        }
        const result = rt.rollback(steps);
        if (!result.ok) {
          lastError = {
            code: 'NO_CHECKPOINT',
            messageKey: 'ui.error.no_checkpoint',
            detail: `回滚栈不足 ${String(steps)} 步`,
          };
          return;
        }
        // 历史截断（#9）：引擎刚弹出最近 steps 个检查点，宿主按其回退锚点把
        // 累积历史截断到**最早被回退到的那个检查点**的位置——重建会话后历史
        // 仍在（只少了回退掉的那一段），玩家能确认「只退了 steps 步」。
        truncateHistoryForRollback(steps);
        // 会话重建：回滚只还原状态，叙事位置须重开会话（§6.3「重建 session」；
        // M2 验收口径甲 2026-09-23：仅状态一致，叙事位置回入口场景）
        replaceSession(definition.manifest.entryScene);
      }),

    /**
     * 历史回看投影（FR-READ-04）。
     *
     * 数据源 = 宿主的 {@link historyLog}（跨会话累积），**不是** `session.history()`
     * ——会话在回滚时被重建，其历史缓冲为空（#9 的根因）。投影额外为每个分组
     * 附带 `rollbackSteps`（#9b：面板不再用「分组距离」冒充检查点步数）。
     */
    history: () => withRollbackSteps(projectHistory(historyLog, resolveText)),

    availableRollbackSteps: () => rollbackMarks.length,

    // —— 面板接线实现（2026-09-25） ——

    shopSession: () => {
      if (shopHandle === null) return null;
      return projectShopSession(shopHandle, {
        definition,
        runtime: requireRuntime(),
        // 运行时持有同一 Rng（DD-09 单一序列）——此处经公开面取用
        rng: requireRuntime().rng,
        ...(definition.items.size > 0 ? { items: definition.items } : {}),
      });
    },
    shopBuy: (itemId, count = 1) => {
      if (shopHandle === null) return { ok: false, detail: '未打开商店' };
      const before = JSON.stringify(requireRuntime().state.player.bag);
      try {
        shopHandle.service.buy(shopHandle.shopId, itemId as never, count);
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
      void before;
      return { ok: true, detail: `已购买 ${itemId} ×${count}` };
    },
    shopSell: (itemId, count = 1) => {
      if (shopHandle === null) return { ok: false, detail: '未打开商店' };
      try {
        shopHandle.service.sell(shopHandle.shopId, itemId as never, count);
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
      return { ok: true, detail: `已出售 ${itemId} ×${count}` };
    },
    closeShop: () => {
      shopHandle = null;
      store.getState().openPanel(null);
    },

    battleSession: () => {
      if (battleController === null) return null;
      return projectBattleSession(battleController, battleEncounterId);
    },
    battleAct: (action) =>
      guard(() => {
        const controller = battleController;
        if (controller === null) return;
        const battleSession = controller.session;
        if (battleSession.result() === null) {
          // 会话相位驱动：正常路径下 battle_start 的起步驱动已把相位停在
          // await_player（#8），此处 turn_order 分支是纵深防御（不空转、不漂移）。
          if (battleSession.phase() === 'turn_order') driveBattle(controller);
          if (battleSession.phase() === 'await_player') {
            battleSession.playerAction(action as never);
          }
        }
        // 终局消费：pollOutcome → 清控制器 → 关面板 → jumps 注回叙事（与起步驱动同路径）
        if (!consumeBattleOutcome(controller) && battleSession.result() === null) {
          // 未终局：继续推进到下一次玩家输入（敌方可能连续行动多轮——有界循环）
          driveBattle(controller);
          // 续推可能直接终局（敌方把玩家打倒等）——终局消费不能漏
          consumeBattleOutcome(controller);
        }
      }),

    achievementGallery: () => {
      const evaluator = achievementEvaluatorHolder.evaluator;
      if (evaluator === null) {
        return projectAchievementGallery([], { unlocked: 0, total: 0, rate: 0 });
      }
      const state = requireRuntime().state;
      const entries = evaluator.gallery(state as never, unlockedAchievements);
      const rate = evaluator.collectionRate(unlockedAchievements);
      return projectAchievementGallery(entries, rate);
    },
    refreshAchievements: () => {
      const evaluator = achievementEvaluatorHolder.evaluator;
      if (evaluator === null) return;
      const state = requireRuntime().state;
      const newly = evaluator.all(state as never, unlockedAchievements);
      if (newly.length === 0) return;
      for (const entry of newly) unlockedAchievements.add(entry.id);
      void recordAchievements(achievementStore, newly, Date.now());
    },
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
        // **地图导航切场景**（FR-XPLR-02；2026-09-15 补，用户实测问题 1c）：
        // 点击地图地点 = 一次导航跳转（与选项 goto 同语义：替换当前帧，不压栈）。
        // 若上一步的事件评估已把会话带入事件子会话（depth > 0），则不覆盖——
        // 玩家的点击被事件打断，符合叙事直觉。
        const entryScene = definition.locationEntries.get(
          locationEntryKey(target.area, target.location),
        );
        const runner = session;
        if (
          entryScene !== undefined &&
          runner !== undefined &&
          runner.depth === 0 &&
          runner.currentSceneId !== entryScene
        ) {
          session = createRunnerSession(runnerRuntime(), entryScene);
        }
        // **探索发现型事件**（`trigger.type === 'explore'`）的驱动点（2026-09-25 补）：
        // 这类事件不参与时间管线的自动 select（评估器按设计把它们归入
        // `untriggered(reason: 'explore')`，由宿主在**进入地点**时主动询问）。
        // 此前宿主零调用 → 夹具里 4 条 explore 事件永不触发（L2-B 检查抓出，
        // 与「事件零评估」「商店库存不记账」同类的宿主装配遗漏）。
        if (session !== undefined && session.depth === 0 && session.phase !== 'finished') {
          const candidates = exploreCandidates(definition.events, (source) =>
            evalConditionSource(source),
          );
          const inScope = candidates.find((candidate) => {
            const where = candidate.event.where;
            if (where.area !== target.area) return false;
            if (where.location !== undefined && where.location !== target.location) return false;
            return candidate.event.scene !== session?.currentSceneId;
          });
          if (inScope !== undefined) {
            session = createRunnerSession(runnerRuntime(), inScope.event.scene);
          }
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
    /**
     * 区域图投影（FR-UI-02）。
     *
     * **只列已解锁区域**（`includeLockedAreas: false`，2026-09-15 用户裁定）：
     * 未解锁区域不再显示为「未解锁」条目。开发者模式（`developerMode` 选项）
     * 打开时改为全量列出，供调试与内容走查。
     */
    areas: () =>
      projectAreaViews(definition.areas, {
        unlockedAreas: requireRuntime().state.world.unlockedAreas,
        evaluate: evalConditionSource,
        includeLockedAreas: developerMode,
        locationEntries: definition.locationEntries,
      }),
    location: () => currentLocation,
    // 语言口径（M1 收尾修正）：按**当前设置语言**解析，而非固定 mainLang ——
    // 面板/UI 文案须随设置面板的语言切换即时变更（FR-L10N-05 运行时切换）；
    // 固定 mainLang 会让切换语言后所有组件文案仍停留在主语言。
    textOf: (key, vars) => resolveText(key, vars),
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

    // —— 存读档（FR-SAVE；见各方法 TSDoc） ——
    saveToSlot,
    loadFromSlot,
    listSlots,
    exportSlot,
    persistenceStatus,

    wiringWarnings: () => wiringWarnings,
    dispose: () => {
      unsubscribeBridge?.();
      unsubscribeBridge = undefined;
    },
  };
}

/**
 * 错误 → 宿主摘要（EngineError 取三元组；持久化层错误映射到存档错误码；其余取 message）。
 *
 * 为什么单列 {@link PersistenceError}：适配器（MemoryAdapter/DexieAdapter）抛的是
 * UI 包自有的错误类型，**不带** code/messageKey（它不属于引擎错误体系）。不映射
 * 就会一律落成 `INTERNAL`——空槽位读档将表现为「内部错误」，玩家无从判断是
 * 「没存过档」还是「引擎坏了」。映射后 code 为 `SAVE_CORRUPT`（存档面错误，
 * 与引擎 `SAVE_CORRUPT` 同域），messageKey 指明槽位缺失。
 */
function toHostError(error: unknown): HostError {
  if (error instanceof PersistenceError) {
    return {
      code: 'SAVE_CORRUPT',
      messageKey: 'error.save.slotMissing',
      detail: error.message,
    };
  }
  const candidate = error as { code?: string; messageKey?: string; message?: string };
  return {
    code: typeof candidate.code === 'string' ? candidate.code : 'INTERNAL',
    messageKey:
      typeof candidate.messageKey === 'string' ? candidate.messageKey : 'ui.error.internal',
    detail: typeof candidate.message === 'string' ? candidate.message : String(error),
  };
}

/**
 * 适配器标识（诊断面）。 *
 * runtime-ui 的两个实现都带 `name`（{@link UiPersistenceAdapter}），但
 * `PersistenceAdapter` 契约本身没有该字段（engine 不感知平台）。故此处按结构
 * 探测：注入面给了不带 name 的实现时回落 `unknown`，**不**改写引擎契约
 * （DD-04 的边界；`persistenceStatus().adapter` 只是诊断信息）。
 */
function readAdapterName(adapter: PersistenceAdapter): string {
  const name = (adapter as Partial<UiPersistenceAdapter>).name;
  return typeof name === 'string' ? name : 'unknown';
}
