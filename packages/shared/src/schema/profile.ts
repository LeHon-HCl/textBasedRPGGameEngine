import { z } from 'zod';
import { refId } from '../ids.js';
import { gameIdSchema } from './common.js';

/**
 * 跨存档 Profile（设计 §2.4 Profile、§5.4，决策 D7）。
 *
 * - 独立于存档槽位持久化（ProfileStore，DD-04）；读档回滚/删档不回收已获点数；
 * - achievements 键为成就引用（refId('achievement')）——迁移 redirects 按该
 *   元数据定向改写（FR-MIGR-06，与存档迁移同一 runner）；
 * - purchasedPerks/endings 的 id 不在 RefKind 引用面内，经本域 redirects 改写；
 * - 引擎不直接写 Profile：宿主（runtime-ui）经 ProfileStore.mutate 入账（§5.4）。
 */

export const profileAchievementEntrySchema = z.strictObject({
  /** 解锁时刻（epoch 毫秒） */
  unlockedAt: z.number().int().min(0),
  /** 进度型成就的终态进度快照（FR-ACHV-01） */
  progress: z.strictObject({ cur: z.number(), goal: z.number() }).optional(),
});

export type ProfileAchievementEntry = z.infer<typeof profileAchievementEntrySchema>;

export const profileSchema = z.strictObject({
  /** Profile 自身迁移粒度（FR-MIGR-06：与存档迁移同机制、独立执行） */
  schemaVersion: z.number().int().min(1),
  /** 成就解锁记录（键为成就引用） */
  achievements: z.record(refId('achievement'), profileAchievementEntrySchema),
  /** 点数余额（新档 Perk 兑换消费，FR-ACHV-05/06） */
  points: z.number().int().min(0),
  /** 已购增益（新档 bootstrap 的数据源） */
  purchasedPerks: z.array(z.strictObject({ id: gameIdSchema, at: z.number().int().min(0) })),
  /** 结局收集（跨存档，FR-GAL-02） */
  endings: z.array(gameIdSchema),
});

export type Profile = z.infer<typeof profileSchema>;
