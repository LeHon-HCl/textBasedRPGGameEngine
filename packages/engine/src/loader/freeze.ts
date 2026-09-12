import { EngineError } from '@game/shared';
import { mergeDiagnostics } from './diagnostics.js';
import type { CompiledArtifacts, Diagnostic, GameDefinition, ValidatedPackage } from './types.js';
import type { ScriptStepResult } from './scripts.js';

/**
 * 管线步骤 7 freeze（设计 §3.4「GameDefinition 全部字段 Object.freeze，
 * 运行期不可变」）。
 *
 * - deepFreeze 递归冻结普通对象 / 数组 / Map / Set 的内容（含键与值）；
 *   类实例（EffectRegistry）仅冻结实例本身——其私有字段经注册表冻结语义
 *   （register 报 SCRIPT_CONTRACT）保证不再变化；
 * - Map 实例冻结后 set/delete 仍可调用是 JS 语义限制，本步骤保证的是
 *   「内容数据不可变 + 顶层对象冻结」；GameRuntime 侧状态自有 immer 深冻结；
 * - diagnostics 仅保留 warning 级（error 已在管线步骤边界阻断）。
 */

/** 递归深冻结（对象 / 数组 / Map / Set 内容；类实例仅冻结实例本身） */
export function deepFreeze<T>(value: T, seen: Set<object>): T {
  if (value === null || typeof value !== 'object') return value;
  const obj = value as unknown as object;
  if (seen.has(obj)) return value;
  seen.add(obj);
  Object.freeze(obj);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
    return value;
  }
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      deepFreeze(key, seen);
      deepFreeze(entry, seen);
    }
    return value;
  }
  if (value instanceof Set) {
    for (const entry of value) deepFreeze(entry, seen);
    return value;
  }
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return value;
}

/** 组装并冻结 GameDefinition（管线步骤 6 产物 + validate/compile 产物） */
export function buildGameDefinition(deps: {
  validated: ValidatedPackage;
  artifacts: CompiledArtifacts;
  scriptResult: ScriptStepResult;
  warnings: readonly Diagnostic[];
}): GameDefinition {
  const { validated, artifacts, scriptResult, warnings } = deps;
  const domains = validated.domains;
  const manifest = domains.manifest;
  if (manifest === undefined) {
    throw new EngineError({
      code: 'INTERNAL',
      where: { detail: 'manifest 缺失（管线应在 validate 步骤阻断）' },
      messageKey: 'error.loader.internal',
    });
  }
  const definition: GameDefinition = {
    manifest,
    scenes: domains.scenes,
    areas: domains.areas,
    events: domains.events,
    poolIndex: artifacts.poolIndex,
    exprCache: artifacts.exprCache,
    functionRegistry: scriptResult.functionRegistry,
    effectRegistry: scriptResult.effectRegistry,
    mediaCatalog: artifacts.mediaCatalog,
    locales: Object.fromEntries(validated.locales),
    redirects: { ...manifest.redirects },
    diagnostics: mergeDiagnostics(warnings).filter((d) => d.severity === 'warning'),
  };
  return deepFreeze(definition, new Set<object>());
}
