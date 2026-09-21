/**
 * 周目子系统（设计 §5.5，19 号）。
 *
 * - `types.ts`：P0 冻结契约（LoopSummary / LoopTransitionResult）；
 * - `transition.ts`：applyLoopTransition 纯函数（先整体 reset → 逐类策略 → loop+1）。
 */
export type { LoopSummary, LoopTransitionResult } from './types.js';
export { applyLoopTransition } from './transition.js';
export type { LoopTransitionOptions } from './transition.js';
