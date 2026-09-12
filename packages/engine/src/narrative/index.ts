/**
 * narrative 子系统出口（场景会话状态机与渲染契约，设计 §4.2；08 号模块）。
 *
 * 经 `@game/engine` 根出口对外发布（§10.4 导出约定）；子系统内部仅此文件
 * 对外暴露实现，横向子系统不得深入本目录路径（DD-06）。
 */
export { SceneRunner } from './scene-runner.js';
export type {
  ChoiceView,
  NarrativeEndReason,
  NarrativeHistoryEntry,
  NarrativeWarning,
  RenderSegment,
  RunnerPhase,
  SceneRunnerDef,
  SceneRunnerOptions,
  SceneRunnerRuntime,
} from './types.js';
