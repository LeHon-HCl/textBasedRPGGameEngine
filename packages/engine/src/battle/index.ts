/**
 * 战斗子系统（设计 §5.2，16 号）。
 *
 * - `types.ts`：公共契约（BattleUnit / PlayerAction / AiPolicy / DamageFn / 日志条目）；
 * - `session.ts`：BattleSession 八相位状态机；
 * - `turn-queue.ts` / `actions.ts`：行动序与行动校验；
 * - `resolution.ts`：结算执行器（DamageFn 缝 + 附加效果缝）；
 * - `damage.ts` / `ai.ts`：伤害公式预设与 AI 双策略；
 * - `status-tick.ts` / `log.ts`：状态 tick 与日志回看投影；
 * - `targeting.ts`：目标选择；
 * - `units.ts` / `outcome.ts`：遭遇实例化与胜负路由数据面；
 * - `wiring.ts`：battle 指令接线层（createBattleController）。
 */
export { BattleSession } from './session.js';
export type { ActionOutcome, BattleSessionOptions, TurnStart } from './session.js';
export { computeTurnOrder } from './turn-queue.js';
export { actionError, validateAction } from './actions.js';
export type { ActionValidationContext } from './actions.js';
export { createEffectExecutor } from './resolution.js';
export type { ActionExecutionContext, ResolutionOptions } from './resolution.js';
export { createDamagePresetResolver, createDefaultDamageFn } from './damage.js';
export type { DamagePresetResolver } from './damage.js';
export { createAiResolver } from './ai.js';
export type { AiResolveFn, AiResolverOptions } from './ai.js';
export { tickStatuses } from './status-tick.js';
export { projectBattleLog } from './log.js';
export type { BattleLogView } from './log.js';
export { selectTarget } from './targeting.js';
export type { TargetCandidate, TargetingContext, TargetingOptions } from './targeting.js';
export { instantiateEncounter, playerUnitFromState } from './units.js';
export { buildOutcomeEffects } from './outcome.js';
export type { OutcomeBranches } from './outcome.js';
export { createBattleController } from './wiring.js';
export type { BattleController, BattleOutcome, BattleWiringInput } from './wiring.js';
export type {
  AiActionSpec,
  AiPolicy,
  BattleInit,
  BattleLogEntry,
  BattlePhase,
  BattleResult,
  BattleUnit,
  DamageFn,
  DamageInput,
  DamageResult,
  PlayerAction,
  SkillRef,
} from './types.js';
