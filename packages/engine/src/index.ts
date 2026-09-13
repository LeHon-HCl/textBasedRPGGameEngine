/**
 * @game/engine 公开 API 唯一出口（导出约定，设计 §10.4 / NFR-13）。
 *
 * 约定：
 * - 包外只允许从包名 `@game/engine` 导入，禁止深入包内文件路径；
 * - 各子系统（state / runtime / effects / loader / i18n / narrative / ...）
 *   的公开类型与函数先在自身目录中定义，再经此处统一 re-export；
 * - 子系统之间禁止横向 import（DD-06），只允许「事务 + EngineEvent +
 *   时间管线编排」三种交互方式（设计 §1.2 R5）；
 * - engine 只依赖 shared，禁止 React 与 DOM API（设计 §1.2 R2，lint 强制）；
 * - 公开 API 文档化并遵循语义化版本（NFR-13）。
 */

// ---- state（§3.1 状态树：GameState / 新档初始化 / 派生重算 / 求值作用域投影） ----
export type {
  BagEntry,
  CheckpointMeta,
  GameState,
  Outfit,
  PlayerSettings,
  ReadStats,
  SkillValue,
} from './state/index.js';
export { DEFAULT_PLAYER_SETTINGS, ENGINE_VERSION, newGameState } from './state/index.js';
export type { NewGameBootstrap, NewGameNpcInit, NewGameVersions } from './state/index.js';
export { DERIVED_TRIGGER_DOMAINS, recomputeDerived } from './state/index.js';
export type { DerivedEvalOptions, DerivedTriggerDomain } from './state/index.js';
export { DEFAULT_META_VIEW, buildExprScope, defaultTimeView } from './state/index.js';
export type { ExprScopeViews, MetaView, TimeViewProvider } from './state/index.js';
export { restoreState, serializeState } from './state/index.js';

// ---- runtime（§3.1 状态事务核心：GameRuntime / 事务上下文与产出 / 引擎事件） ----
export { GameRuntime } from './runtime/index.js';
export type { GameRuntimeOptions } from './runtime/index.js';
export { PERF_GUARD } from './runtime/index.js';
export type { PerfGuard } from './runtime/index.js';
export type {
  EffectContext,
  EffectExecution,
  EffectExecutor,
  ExecContext,
  ExecOutcome,
  ExecSource,
  JumpTarget,
} from './runtime/index.js';
export type {
  CheckResultEvent,
  EngineEvent,
  FavorStageChangedEvent,
  MediaEvent,
  MediaIntent,
  NotifyEvent,
  ReputationBandChangedEvent,
  SnapshotWarnEvent,
  StatChangedEvent,
  UnlockEvent,
  UnlockKind,
  Unsubscribe,
  ItemExpiredEvent,
} from './runtime/index.js';

// ---- effects（§3.3 效果指令系统：注册表机制 / 内置指令契约 / 判定规则缝） ----
export { EffectRegistry, createBuiltinEffectRegistry } from './effects/index.js';
export type {
  BuiltinDefContext,
  CheckRequest,
  CheckResult,
  CheckRule,
  CheckRuleResolver,
  EffectExecuteContext,
  EffectInstructionDef,
  EffectRegistryOptions,
  ErasedEffectDef,
  ReputationBounds,
  TouchReport,
} from './effects/index.js';

// ---- loader（§3.4 游戏包加载器：包源抽象 / 七步管线 / 冻结 GameDefinition） ----
export { InMemoryPackageSource, loadGamePackage } from './loader/index.js';
export type {
  CompiledScene,
  GameDefinition,
  LocalePack,
  LocaleRecord,
  LocaleValue,
  LoadGameOptions,
  MediaAsset,
  MediaCatalog,
  PackageSource,
  PoolIndex,
  ScriptModule,
  ScriptSetupApi,
} from './loader/index.js';

// ---- i18n（§4.1 文本解析与本地化运行时：TextResolver 解析/回退/插值/变体） ----
export { consoleWarn, createLocaleProvider, createTextResolver } from './i18n/index.js';
export { collectTranslationStats } from './i18n/index.js';
export type { TranslationStats, TranslationStatsInput } from './i18n/index.js';
export type {
  InterpVars,
  LocaleProvider,
  ResolvedText,
  TextResolver,
  TextResolverOptions,
  TextResolverWarn,
} from './i18n/index.js';

// ---- narrative（§4.2 叙事运行时：场景会话状态机 / 渲染段落 / 选项视图） ----
export {
  NARRATIVE_HISTORY_CAPACITY,
  SceneRunner,
  SUBSESSION_DEPTH_LIMIT,
} from './narrative/index.js';
export type {
  ChoiceView,
  NarrativeEndReason,
  NarrativeHistoryEntry,
  NarrativeWarning,
  RenderSegment,
  RunnerPhase,
  SceneRunnerDef,
  SceneRunnerOptions,
  SceneRunnerRuntime,
} from './narrative/index.js';

// ---- time（§4.3 时间系统：Clock 推进纯函数 / 固定次序推进管线，09 号） ------
export {
  advanceClock,
  createTimeViewProvider,
  DEFAULT_TIME_CONFIG,
  dayOfMonth,
  projectCalendar,
  TimePipeline,
  weekdayIndex,
} from './time/index.js';
export type {
  CalendarView,
  ClockAdvanceResult,
  TimeHooks,
  TimePipelineOptions,
  TimeStepContext,
  TimeStepProvider,
} from './time/index.js';

// ---- items（§4.7 物品：Inventory 纯函数集 / 装备修正明细投影，13 号） --------
export { bagCount, bagGive, bagMerge, bagSplit, bagTake, equipModDetails } from './items/index.js';
export type { EquipModDetail } from './items/index.js';
export { createItemTickProvider } from './items/index.js';
