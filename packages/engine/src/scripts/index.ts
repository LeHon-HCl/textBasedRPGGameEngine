/**
 * 作者脚本宿主子系统（设计 §5.9，23 号；M2 末 API 冻结面）。
 *
 * - `types.ts`：契约（ScriptSetupApi / ScriptModule / ScriptHost / HookName）；
 * - `host.ts`：ScriptHost 实现（transaction 门面 + HookRegistry）。
 *
 * 能力面（OQ-11 复核，2026-09-25）：最小面——仅引擎事务 + 纯计算；
 * 网络/文件系统/定时器不开放，未来需求走宿主注入。
 */
export { createScriptHost, findFlowInstruction, HookRegistry, hookRegistrarFor } from './host.js';
export type { HookDiagnostic } from './host.js';
export {
  collectHookEffects,
  createScriptTimeHooks,
  fireBattleRoundEnd,
  fireLoadComplete,
  fireLoopTransition,
} from './hooks.js';
export type { HookTriggerDeps } from './hooks.js';
export { auditTouchDomains, isKnownDomain, KNOWN_STATE_DOMAINS } from './touch-audit.js';
export type { TouchDomainViolation } from './touch-audit.js';
export type {
  HookContext,
  HookHandler,
  HookName,
  ScriptHost,
  ScriptHostDeps,
  ScriptModule,
  ScriptSetupApi,
  ScriptTransactionResult,
} from './types.js';
