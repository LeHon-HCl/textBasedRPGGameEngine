/**
 * NPC 与阵营子系统出口（设计 §4.6；12 号模块）。
 * 公开面经 engine/src/index.ts 统一 re-export（R3 唯一出口约定）。
 */
export { resolveNpcLocation } from './schedule.js';
export type { NpcScheduleQuery } from './schedule.js';
