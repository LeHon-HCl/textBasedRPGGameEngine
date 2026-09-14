/**
 * state 子系统出口（GameState 状态树与初始化/投影/派生，设计 §3.1；04 号模块）。
 *
 * 经 `@game/engine` 根出口对外发布（§10.4 导出约定）；子系统内部仅此文件
 * 对外暴露实现，横向子系统不得深入本目录路径（DD-06）。
 */
export type {
  BagEntry,
  CheckpointMeta,
  GameState,
  Outfit,
  PlayerSettings,
  ReadStats,
  SkillValue,
} from './game-state.js';
export { DEFAULT_PLAYER_SETTINGS, ENGINE_VERSION, newGameState } from './new-game.js';
export type { NewGameBootstrap, NewGameNpcInit, NewGameVersions } from './new-game.js';
export { DERIVED_TRIGGER_DOMAINS, recomputeDerived } from './derived.js';
export type { DerivedEvalOptions, DerivedTriggerDomain } from './derived.js';
export { DEFAULT_META_VIEW, buildExprScope, defaultTimeView } from './expr-scope.js';
export type { EngineExprScope, ExprScopeViews, MetaView, TimeViewProvider } from './expr-scope.js';
export { restoreState, serializeState } from './serialize.js';
export {
  buildStatePrefixIndex,
  exprRefToStatePrefixes,
  touchedMatchesPrefix,
} from './ref-paths.js';
