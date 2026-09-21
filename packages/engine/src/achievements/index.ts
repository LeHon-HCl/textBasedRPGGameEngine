/**
 * 成就与元进度子系统（设计 §5.4，18 号）。
 *
 * - `types.ts`：P0 冻结契约（AchievementUnlocked / ProfileStore / PerkPurchaseOutcome）；
 * - `evaluator.ts`：评估器（增量 + 全量 + progress/图鉴投影）；
 * - `profile.ts`：ProfileStore 内存实现 + 两步协议 + resetPoints + 成就入账；
 * - `perks.ts`：Perk 效果应用与购买流程（含失败序补偿）。
 */
export type {
  AchievementEvaluation,
  AchievementGalleryEntry,
  AchievementProgress,
  AchievementUnlocked,
  PerkPurchaseOutcome,
  Profile,
  ProfileStore,
} from './types.js';
export { AchievementEvaluator } from './evaluator.js';
export type { AchievementEvaluatorOptions } from './evaluator.js';
export {
  assertProfileValid,
  chargePerk,
  compensatePerk,
  createEmptyProfile,
  createMemoryProfileStore,
  recordAchievements,
  resetPoints,
  validatePerkPurchase,
} from './profile.js';
export type { MemoryProfileStoreOptions } from './profile.js';
export { applyPerkEffects, bootstrapPerks, purchasePerk } from './perks.js';
