/**
 * 任务子系统出口（设计 §4.5；11 号模块）。
 * 公开面经 engine/src/index.ts 统一 re-export（R3 唯一出口约定）。
 */
export {
  assertTransition,
  canTransition,
  QUEST_STATES,
  QUEST_TRANSITIONS,
  transitionVias,
} from './transitions.js';
export type { QuestTransitionRule, QuestTransitionVia } from './transitions.js';
export { QuestMachine } from './quest-machine.js';
export type { QuestMachineOptions } from './quest-machine.js';
export { createQuestConditionEvaluator, createQuestDeriver } from './deriver.js';
export type { QuestConditionEvaluator, QuestDeriverOptions } from './deriver.js';
export { createQuestDeadlineProvider } from './deadline.js';
export type {
  ObjectiveProgress,
  QuestContext,
  QuestLogEntry,
  QuestLogGroup,
  QuestLogProjectionOptions,
  QuestLogView,
  QuestStateEnum,
} from './types.js';
