/**
 * perf.guard 常量（设计 §3.1 快照策略——性能相关阈值的集中管理点）。
 *
 * 阈值调整须同步设计 §3.1 的快照策略描述；GameRuntime 构造选项可逐实例
 * 覆盖（checkpointLimit / snapshotWarnBytes）。
 */
export const PERF_GUARD = Object.freeze({
  /** 回滚栈默认深度（FR-READ-03：栈深度可配置，默认 5） */
  checkpointStackDepth: 5,
  /** 单快照体积告警阈值（字节估算口径见 GameRuntime.checkpoint；§3.1 >5MB 告警） */
  checkpointSnapshotWarnBytes: 5 * 1024 * 1024,
} as const);

/** perf.guard 常量表类型（后续性能阈值统一并入，§10.3） */
export type PerfGuard = typeof PERF_GUARD;
