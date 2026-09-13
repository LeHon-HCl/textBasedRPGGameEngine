/**
 * 时间子系统（设计 §4.3，09 号模块）：可配置日历 + 固定次序推进管线。
 * 公开面经 engine/src/index.ts 统一 re-export（R3 唯一出口约定）。
 */
export { advanceClock, dayOfMonth, weekdayIndex } from './clock.js';
export type { ClockAdvanceResult } from './clock.js';
export { TimePipeline } from './pipeline.js';
export type { TimePipelineOptions, TimeStepContext, TimeStepProvider } from './pipeline.js';
