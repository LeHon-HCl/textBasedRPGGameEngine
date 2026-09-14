/**
 * runtime 子系统出口（GameRuntime 状态事务核心与事件/上下文契约，设计 §3.1；
 * 04 号模块）。
 *
 * 经 `@game/engine` 根出口对外发布（§10.4 导出约定）；子系统内部仅此文件
 * 对外暴露实现，横向子系统不得深入本目录路径（DD-06）。
 */
export { GameRuntime } from './game-runtime.js';
export type { GameRuntimeOptions } from './game-runtime.js';
export { PERF_GUARD } from './perf-guard.js';
export type { PerfGuard } from './perf-guard.js';
export type {
  EffectContext,
  EffectExecution,
  EffectExecutor,
  ExecContext,
  ExecOutcome,
  ExecSource,
  JumpTarget,
  TransactionDeriveContext,
  TransactionDeriver,
} from './exec-context.js';
export type {
  CheckResultEvent,
  EngineEvent,
  FavorStageChangedEvent,
  ItemExpiredEvent,
  MediaEvent,
  MediaIntent,
  NotifyEvent,
  QuestStageEvent,
  QuestStateChangedEvent,
  ReputationBandChangedEvent,
  SnapshotWarnEvent,
  StatChangedEvent,
  UnlockEvent,
  UnlockKind,
  Unsubscribe,
} from './engine-events.js';
