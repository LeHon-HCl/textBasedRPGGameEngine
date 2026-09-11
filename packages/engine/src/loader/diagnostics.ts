import { EngineError } from '@game/shared';
import type { Diagnostic } from './types.js';

/**
 * 诊断汇总工具（设计 §3.4「error 阻断 / warning 入 definition」，DD-12）。
 *
 * 各管线步骤产出 {@link Diagnostic}；管线在步骤边界检查 error 级诊断——
 * 存在即取首个抛出 EngineError（fail-fast，where 携带精确定位），warning
 * 累积进入 GameDefinition.diagnostics。排序保证诊断输出确定性，供测试与
 * 编辑器校验中心（复用同一规则集，DD-12）稳定复现。
 */

/** 诊断排序（确定性）：file → messageKey → where 全量序列化比较 */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  const fileA = a.where['file'] ?? '';
  const fileB = b.where['file'] ?? '';
  if (fileA !== fileB) return fileA < fileB ? -1 : 1;
  const keyA = a.where['messageKey'] ?? '';
  const keyB = b.where['messageKey'] ?? '';
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  return JSON.stringify(a.where) < JSON.stringify(b.where) ? -1 : 1;
}

/** 取首个 error 级诊断（无则 undefined） */
export function firstError(diagnostics: readonly Diagnostic[]): Diagnostic | undefined {
  return diagnostics.find((d) => d.severity === 'error');
}

/**
 * 诊断 → EngineError（§2.2 三元组重建）：code/where 来自诊断本身，
 * messageKey 由诊断 where.messageKey 承载（构造时写入）。
 */
export function diagnosticToError(diagnostic: Diagnostic): EngineError {
  const { messageKey, ...where } = diagnostic.where;
  return new EngineError({
    code: diagnostic.code,
    where: { ...where },
    messageKey: messageKey ?? 'error.loader.internal',
  });
}

/** error 级诊断存在则抛出首个（管线步骤边界的统一阻断点） */
export function throwIfErrors(diagnostics: readonly Diagnostic[]): void {
  const error = firstError(diagnostics);
  if (error !== undefined) {
    throw diagnosticToError(error);
  }
}

/** 合并各步骤诊断并排序（warning 汇总进入 definition 前） */
export function mergeDiagnostics(...groups: readonly (readonly Diagnostic[])[]): Diagnostic[] {
  return groups.flat().sort(compareDiagnostics);
}
