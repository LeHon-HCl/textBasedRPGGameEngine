import type { GameId, Profile } from '@game/shared';

/**
 * 成就与元进度契约（detail-design §5.4，18 号；**P0 冻结面**——变更只增不改）。
 *
 * 边界（DD-04 持久化倒置）：
 * - **引擎不直接写 Profile**（无 IO）：评估器产出 {@link AchievementUnlocked} 事件，
 *   宿主（runtime-ui）订阅后经 `ProfileStore.mutate` 入账 + Toast（§5.4）；
 * - {@link ProfileStore} 接口定义在引擎、实现归宿主（内存实现供测试，
 *   Dexie 实现归 25 号）；
 * - Perk 购买两步协议（FR-ACHV-06）：`mutate` 扣点/记录 → 建档；失败 →
 *   宿主补偿回加（{@link PerkPurchaseOutcome} 表达结果，补偿策略见 §6.2）。
 */

/** 成就解锁事件载荷（评估器产出；宿主据此入 Profile） */
export interface AchievementUnlocked {
  readonly id: GameId;
  /** 解锁入账点数（AchievementDef.points） */
  readonly points: number;
  /** 进度型成就的终态进度快照（FR-ACHV-01） */
  readonly progress?: { readonly cur: number; readonly goal: number };
}

/** 成就评估结果（一次评估的全部新解锁） */
export interface AchievementEvaluation {
  readonly unlocked: readonly AchievementUnlocked[];
}

/**
 * Profile 存储契约（DD-04）。乐观锁：`mutate` 写前读版本，冲突重试或抛错
 * 由实现裁决（内存实现用同步队列保证一致）。
 */
export interface ProfileStore {
  load(): Promise<Profile>;
  /** 读-改-写事务：fn 收到 draft（浅拷贝语义），成功后持久化并递增版本 */
  mutate(fn: (profile: Profile) => Profile): Promise<void>;
}

/** Perk 购买结果（两步协议的宿主侧裁决面，FR-ACHV-06） */
export interface PerkPurchaseOutcome {
  readonly perkId: GameId;
  /** 扣点是否成功（false = 点数不足/前置不满足，宿主应提示并不建档） */
  readonly charged: boolean;
  /** 建档是否成功（false 且 charged = 需补偿回加，见 §6.2 两步协议） */
  readonly bootstrapped: boolean;
  /** 拒绝原因（charged=false 时填充；用于 UI 提示文案选择） */
  readonly rejection?: 'insufficient_points' | 'requires_missing' | 'conflicts' | 'not_repeatable';
}

/** 图鉴条目（FR-ACHV-04；UI 成就图鉴的展示面） */
export interface AchievementGalleryEntry {
  readonly id: GameId;
  /** 隐藏型未解锁 = true（仅此信息可见） */
  readonly hidden: boolean;
  readonly unlocked: boolean;
  readonly points: number;
  /** hidden 且未解锁时不下发 */
  readonly nameKey?: string;
  readonly group?: string;
  readonly progress?: AchievementProgress;
}

/** 成就进度投影（FR-ACHV-01 progress 型；UI 进度条数据源） */
export interface AchievementProgress {
  readonly id: GameId;
  readonly cur: number;
  readonly goal: number;
  /** 是否已解锁（Profile 侧记录） */
  readonly unlocked: boolean;
}

/** Profile 视图辅助（重导出 shared 类型，避免双份定义） */
export type { Profile };
