import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import {
  diagnosticToError,
  firstError,
  mergeDiagnostics,
  throwIfErrors,
} from '../../src/loader/diagnostics.js';
import { loadFixturePackage } from './fs-source.js';
import type { Diagnostic } from '../../src/loader/types.js';

/**
 * 诊断汇总与负例夹具端到端用例（06 任务 C1，设计 §3.4「步骤 4/5 产出的
 * 错误汇总为 Diagnostic[]，error 阻断、warning 进入 definition」，DD-12）。
 *
 * 断言口径：
 * - error 级负例（fixtures/negatives）经完整七步管线在步骤边界阻断，
 *   抛出的 EngineError 命中各自预期 ErrCode 且 where 精确定位目标缺陷
 *   （各包除目标缺陷外保持合法，见 fixtures/negatives/README.md）；
 * - warning 级负例加载成功，definition.diagnostics 恰含一条目标告警
 *   （文本键缺失 kind=text / 媒体缺失 kind=media）；
 * - 诊断工具（mergeDiagnostics / firstError / throwIfErrors /
 *   diagnosticToError）的排序、阻断与三元组重建语义单测。
 */

/** 加载 fixtures/negatives/<name> 并捕获抛出的 EngineError（预期阻断） */
async function captureNegativeError(name: string): Promise<EngineError> {
  try {
    await loadFixturePackage(`negatives/${name}`);
  } catch (error) {
    if (error instanceof EngineError) return error;
    throw error;
  }
  throw new Error(`负例 ${name} 应当阻断加载，但加载成功了`);
}

describe('负例夹具端到端：error 级逐个命中预期 ErrCode（06 任务 C1）', () => {
  it('bad-expr → EXPR_COMPILE 阻断（where.expr 携带表达式原文）', async () => {
    const error = await captureNegativeError('bad-expr');
    expect(error.code).toBe('EXPR_COMPILE');
    expect(error.where['expr']).toBe('flag(sealed_gate) && (attr.insight > 5');
    expect(error.where['from']).toContain('scenes[shrine]');
    expect(error.where['phase']).toBe('compile');
  });

  it('dangling-ref → DANGLING_REF 阻断（kind=scene，goto 目标定位）', async () => {
    const error = await captureNegativeError('dangling-ref');
    expect(error.code).toBe('DANGLING_REF');
    expect(error.where['kind']).toBe('scene');
    expect(error.where['ref']).toBe('nowhere_hall');
    expect(error.where['from']).toContain('scenes[locked_door]');
    expect(error.where['phase']).toBe('crossRef');
  });

  it('dup-id → DUP_ID 阻断（kind=scene，跨文件来源定位）', async () => {
    const error = await captureNegativeError('dup-id');
    expect(error.code).toBe('DUP_ID');
    expect(error.where['kind']).toBe('scene');
    expect(error.where['id']).toBe('checkpoint');
    expect(error.where['files']).toContain('east_gate/checkpoint.yaml');
    expect(error.where['files']).toContain('west_gate/checkpoint.yaml');
    expect(error.where['phase']).toBe('validate');
  });
});

describe('负例夹具端到端：warning 级进入 definition.diagnostics（06 任务 C1）', () => {
  it('dangling-text-key → 加载成功，恰含一条 warning DANGLING_REF（kind=text）', async () => {
    const definition = await loadFixturePackage('negatives/dangling-text-key');
    expect(definition.diagnostics).toHaveLength(1);
    const diagnostic = definition.diagnostics[0] as Diagnostic;
    expect(diagnostic.severity).toBe('warning');
    expect(diagnostic.code).toBe('DANGLING_REF');
    expect(diagnostic.where['kind']).toBe('text');
    expect(diagnostic.where['ref']).toBe('scenes.shrine.missing');
    expect(diagnostic.where['from']).toContain('scenes[shrine]');
  });

  it('dangling-media → 加载成功，恰含一条 warning DANGLING_REF（kind=media）', async () => {
    const definition = await loadFixturePackage('negatives/dangling-media');
    expect(definition.diagnostics).toHaveLength(1);
    const diagnostic = definition.diagnostics[0] as Diagnostic;
    expect(diagnostic.severity).toBe('warning');
    expect(diagnostic.code).toBe('DANGLING_REF');
    expect(diagnostic.where['kind']).toBe('media');
    expect(diagnostic.where['ref']).toBe('missing_chapel_bg');
    expect(diagnostic.where['from']).toContain('scenes[chapel]');
  });
});

describe('诊断汇总工具（DD-12：规则单源，编辑器校验中心复用）', () => {
  const warningA: Diagnostic = {
    severity: 'warning',
    code: 'DANGLING_REF',
    where: { file: 'a.yaml', ref: 'x', messageKey: 'error.loader.danglingRef' },
  };
  const warningB: Diagnostic = {
    severity: 'warning',
    code: 'SCHEMA_INVALID',
    where: { file: 'b.yaml', messageKey: 'error.loader.localePackMissing' },
  };
  const errorC: Diagnostic = {
    severity: 'error',
    code: 'DUP_ID',
    where: { file: 'c.yaml', id: 'dup', messageKey: 'error.loader.dupId' },
  };

  it('mergeDiagnostics：合并多组并按 file → messageKey 确定性排序', () => {
    const merged = mergeDiagnostics([errorC, warningB], [warningA]);
    expect(merged.map((d) => d.where['file'])).toEqual(['a.yaml', 'b.yaml', 'c.yaml']);
  });

  it('firstError：取首个 error 级诊断；纯 warning 返回 undefined', () => {
    expect(firstError([warningA, errorC, warningB])).toBe(errorC);
    expect(firstError([warningA, warningB])).toBeUndefined();
  });

  it('throwIfErrors：存在 error 级诊断时重建 EngineError 抛出（三元组还原）', () => {
    expect(() => throwIfErrors([warningA, errorC])).toThrow(EngineError);
    let captured: unknown = null;
    try {
      throwIfErrors([warningA, errorC]);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(EngineError);
    if (!(captured instanceof EngineError)) return;
    expect(captured.code).toBe('DUP_ID');
    expect(captured.where['id']).toBe('dup');
    expect(captured.where['file']).toBe('c.yaml');
    // messageKey 由诊断 where 承载，重建后不残留在 where 中（§2.2 三元组）
    expect(captured.where['messageKey']).toBeUndefined();
    expect(captured.messageKey).toBe('error.loader.dupId');
  });

  it('throwIfErrors：纯 warning 不阻断（warning 进入 definition 的前提）', () => {
    expect(() => throwIfErrors([warningA, warningB])).not.toThrow();
  });

  it('diagnosticToError：messageKey 缺省回退 error.loader.internal', () => {
    const error = diagnosticToError({
      severity: 'error',
      code: 'INTERNAL',
      where: { detail: 'invariant broken' },
    });
    expect(error.code).toBe('INTERNAL');
    expect(error.messageKey).toBe('error.loader.internal');
  });
});
