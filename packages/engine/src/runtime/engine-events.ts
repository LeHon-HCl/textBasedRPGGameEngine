import type { GameId, QuestState, TextKey } from '@game/shared';

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
export type UnlockKind = 'gallery' | 'cg' | 'ending' | 'codex' | 'achievement';

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
 * 好感阶段变化（FR-NPCR-02，§4.6 favor 指令 emit，05 任务 B3）：
 * favor 指令 clamp 后按阈值表（FavorDef.stages）更新 stage，变化即发出。
 * 作者钩子 / 事件条件（12 号）可订阅；from/to 为阶段 id，未达任何阶段为
 * undefined。
 */
export interface FavorStageChangedEvent {
  type: 'favor_stage_changed';
  npc: GameId;
  from: string | undefined;
  to: string | undefined;
}

/**
 * 声望波段变化（FR-NPCR-04，§4.6 reputation 指令 emit，05 任务 B3）：
 * reputation 指令按阈值表（FactionDef.thresholds）计算波段，变化即发出。
 * 商店定价（§5.3）引用声望仍为普通表达式，本事件仅供订阅与呈现。
 */
export interface ReputationBandChangedEvent {
  type: 'reputation_band_changed';
  faction: GameId;
  from: string | undefined;
  to: string | undefined;
}

/** 物品过期（FR-ITEM-06，§4.7，13 任务 5）：引擎只报事件，后果由作者决定 */
export interface ItemExpiredEvent {
  type: 'item_expired';
  item: GameId;
  /** 'expired' = 时效届满；'durability' = 耐久归零 */
  reason: 'expired' | 'durability';
}

/**
 * 任务状态变化（FR-QUEST-02，§4.5，11 任务 1/2）：
 * accept / 阶段推进至待提交 / submit / fail 等六态迁移统一 emit 本事件；
 * from/to 为六态 id（undiscovered/available/active/ready_to_submit/done/failed）。
 * 作者以事件订阅实现「状态变化触发效果」（如 on_accept / on_done / on_fail 的
 * 作者侧等价物——QuestDef 无 on_* 效果字段，效果钩子经事件订阅表达）。
 */
export interface QuestStateChangedEvent {
  type: 'quest_state_changed';
  quest: GameId;
  from: QuestState['state'];
  to: QuestState['state'];
}

/**
 * 任务阶段推进（on_stage；FR-QUEST-02，§4.5，11 任务 3）：
 * active 内当前阶段 completeWhen 达成后推进到下一阶段时 emit（末阶段改为
 * `quest_state_changed → ready_to_submit`，不再发本事件）；objectiveKey 为
 * 新阶段目标文本键，供任务日志/toast 直接消费（FR-QUEST-03）。
 */
export interface QuestStageEvent {
  type: 'quest_stage';
  quest: GameId;
  /** 原阶段 id（无阶段目录或缺省时 undefined） */
  from: string | undefined;
  /** 新阶段 id */
  to: string;
  /** 新阶段目标文本键（QuestDef.stages[].objectiveKey；无目录时显式推进可缺省） */
  objectiveKey?: TextKey;
}

/**
 * 引擎事件全集（04 号核心成员；后续模块在同一文件追加判别成员并纳入本联合）。
 */
/**
 * 临时变身回退（FR-BODY-02，§4.8，14 号）：管线步骤 3 到期还原即发出。
 * 引擎只报事件不解释语义（中立性）——作者订阅后自行决定描写/后果。
 */
export interface BodyRevertedEvent {
  type: 'body_reverted';
  /** 被还原的身体部位 */
  part: string;
  /** 还原到的值（= 首次登记前的原值） */
  restored: string;
}

export type EngineEvent =
  | StatChangedEvent
  | NotifyEvent
  | UnlockEvent
  | CheckResultEvent
  | MediaEvent
  | SnapshotWarnEvent
  | FavorStageChangedEvent
  | ReputationBandChangedEvent
  | ItemExpiredEvent
  | QuestStateChangedEvent
  | QuestStageEvent
  | BodyRevertedEvent;
