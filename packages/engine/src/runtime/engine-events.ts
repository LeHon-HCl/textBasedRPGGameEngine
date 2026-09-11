import type { TextKey } from '@game/shared';

/**
 * EngineEvent 判别联合（设计 §3.1 ExecOutcome.events、DD-06 交互面；04 任务 B2）。
 *
 * - 事件是 engine 子系统间唯一的副作用表达（DD-06：§1.3 原则 5——测试断言
 *   事件序列而非 UI 效果）；本文件只定义 04 号运行时核心所需的成员骨架，
 *   后续模块（11 任务 / 12 NPC / 14 身体 / 18 成就等）在同一文件按需追加成员；
 * - 事件随事务收集、事务提交后统一送达 on() 总线（失败事务的半途事件不外泄，
 *   事务原子性涵盖事件面）；rollback 只还原 GameState，已送达事件不撤销
 *   （FR-READ-03 与 Profile 解耦的边界）；
 * - Unsubscribe 为 on() 订阅退订句柄。
 */

/** 订阅退订句柄（on 总线，§3.1 GameRuntime.on） */
export type Unsubscribe = () => void;

/** 属性变化通知（FR-STAT-04：UI 增量高亮 / 可选 Toast；运行时由事务补丁派生） */
export interface StatChangedEvent {
  type: 'stat_changed';
  /** 属性 id（player.attrs 键） */
  attr: string;
  /** 事务前值（事务中新增键取 0） */
  from: number;
  to: number;
  /** to - from（增量高亮直接消费） */
  delta: number;
}

/** Toast 通知（FR-UI-07，§3.3 notify 指令数据面：文本键 + 插值变量，D4） */
export interface NotifyEvent {
  type: 'notify';
  textKey: TextKey;
  vars?: Readonly<Record<string, unknown>>;
}

/** 解锁对象类别（§3.3 unlock 指令参数面） */
export type UnlockKind = 'gallery' | 'ending' | 'codex' | 'achievement';

/** 回想/结局/百科/成就标记（seen 域解锁；结局入 Profile 由宿主路由，§5.4） */
export interface UnlockEvent {
  type: 'unlock';
  kind: UnlockKind;
  id: string;
}

/**
 * 判定呈现数据（§5.1 check 指令 emit，NFR-26 可减弱播放）。
 * level/detail 的精确枚举随 15 号 CheckRule 冻结后对齐（同文件扩展）。
 */
export interface CheckResultEvent {
  type: 'check_result';
  rule: string;
  outcome: 'success' | 'fail';
  level: string;
  /** 含奖惩骰明细（FR-CMBT-05 表现层动画数据） */
  rolls: readonly number[];
  detail: Readonly<Record<string, unknown>>;
}

/**
 * 媒体意图（DD-05：engine 不接触音频/图像，只产出 intent；播放由 runtime-ui
 * 的播放器消费，§6.8）。与 §5.10 MediaIntent 契约一致（24 号模块复用本定义）。
 */
export type MediaIntent =
  | { type: 'bg' | 'cg' | 'sprite'; assetId: string; transition?: 'fade' | 'cut' }
  | { type: 'bgm'; assetId: string; loop: true }
  | { type: 'sfx'; assetId: string };

/** 媒体意图事件（§3.3 media 指令 emit） */
export interface MediaEvent {
  type: 'media';
  intent: MediaIntent;
}

/** 快照体积告警（§3.1 快照策略：单快照超阈值建议调低栈深；阈值见 PERF_GUARD） */
export interface SnapshotWarnEvent {
  type: 'snapshot_warn';
  /** 触发告警的 checkpoint 标签 */
  label: string;
  /** 估算体积（字节口径见 GameRuntime.checkpoint TSDoc） */
  sizeBytes: number;
  thresholdBytes: number;
}

/**
 * 引擎事件全集（04 号核心成员；后续模块在同一文件追加判别成员并纳入本联合）。
 */
export type EngineEvent =
  StatChangedEvent | NotifyEvent | UnlockEvent | CheckResultEvent | MediaEvent | SnapshotWarnEvent;
