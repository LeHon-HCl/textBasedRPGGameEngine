/**
 * narrative 切片出口（设计 §6.1 组件树叙事区 / §6.3 阅读体验 QoL）。
 *
 * 组件：NarrativeView / OptionList —— 全部 props 受控、可 Testing Library 测。
 * 编排：createChoiceCheckpoint / withChoiceCheckpoint —— 选择前打点（FR-READ-03）。
 */
export { NarrativeView, OptionList } from './NarrativeView.js';
export type { NarrativeViewProps } from './NarrativeView.js';
export {
  choiceCheckpointLabel,
  createChoiceCheckpoint,
  withChoiceCheckpoint,
} from './checkpoint.js';
export type { CheckpointRuntime, ChoiceExecutionResult, ChoiceTarget } from './checkpoint.js';
export { DEFAULT_NARRATIVE_LABELS, describeEnding } from './types.js';
export type {
  NarrativeLabels,
  NarrativeSegmentEndReason,
  NarrativeSegmentView,
  OptionView,
} from './types.js';
