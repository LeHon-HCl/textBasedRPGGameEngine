/**
 * NPC 与阵营子系统出口（设计 §4.6；12 号模块）。
 * 公开面经 engine/src/index.ts 统一 re-export（R3 唯一出口约定）。
 */
export { resolveNpcLocation, resolveNpcLocations, sameNpcLocationCache } from './schedule.js';
export type { NpcScheduleQuery } from './schedule.js';
export { applyFavorChange } from './favor.js';
export type { FavorChange, NpcRelationSlice } from './favor.js';
export { applyReputationChange } from './reputation.js';
export type { ReputationChange } from './reputation.js';
export { clamp, thresholdFor } from './thresholds.js';
export type { ThresholdEntry } from './thresholds.js';
export { createNpcScheduleProvider } from './step.js';
export { createNpcScheduleDeriver } from './deriver.js';
export type { NpcScheduleDeriverOptions } from './deriver.js';
