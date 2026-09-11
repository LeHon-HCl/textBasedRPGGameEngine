import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '@game/shared';
import type { EvalContext, ExprFunctionRegistry } from '@game/shared';
import { compileExpr } from '../../src/expr-eval/compile.js';
import { evalExpr } from '../../src/expr-eval/eval.js';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/builtins.js';
import { def, makeCtx, makeScope } from './fixtures.js';

/**
 * 03 任务 B4：严格错误语义（DD-01）——除零 / 类型不匹配 / 嵌套隐式转换禁止，
 * EVAL_ERROR 一律携带表达式原文定位（where.expr）。
 *
 * B1 已钉死运算符层的除零与类型不匹配；本文件补齐：
 * - 函数层错误的表达式原文归因（求值器对 fn 抛出 EngineError 补注
 *   where.expr + where.fn；非 EngineError 防御性收敛为 EVAL_ERROR）；
 * - 隐式转换禁止在「渐进域缺席值 / 查询函数返回值进入算术」场景的
 *   端到端表现（真值化不蔓延到算术语境）；
 * - null/undefined 相等语义作为「未设置」判定的惯用形式（不报错）。
 */

const REGISTRY: ExprFunctionRegistry = createBuiltinFunctionRegistry();

/** 抛出非 EngineError 的夹具函数（模拟实现缺陷，验证防御性收敛） */
const REGISTRY_WITH_BROKEN_FN: ExprFunctionRegistry = new Map([
  ...REGISTRY,
  def('broken', [0, 0], true, () => {
    throw new Error('implementation bug');
  }),
]);

function makeContext(registry: ExprFunctionRegistry = REGISTRY): EvalContext {
  return makeCtx(makeScope(), createRng(42), registry);
}

function evalExpectError(source: string, registry?: ExprFunctionRegistry): EngineError {
  let captured: unknown;
  try {
    evalExpr(compileExpr(source, registry ?? REGISTRY), makeContext(registry ?? REGISTRY));
  } catch (err) {
    captured = err;
  }
  expect(captured, `expected EVAL_ERROR for: ${source}`).toBeInstanceOf(EngineError);
  return captured as EngineError;
}

describe('B4：函数层错误的表达式原文归因', () => {
  it('封闭域查询缺 key：where 携带 expr / fn / key', () => {
    const err = evalExpectError('rep("typo_faction") == 0');
    expect(err.code).toBe('EVAL_ERROR');
    expect(err.messageKey).toBe('error.eval.missingKey');
    expect(err.where['expr']).toBe('rep("typo_faction") == 0');
    expect(err.where['fn']).toBe('rep');
    expect(err.where['key']).toBe('typo_faction');
  });

  it('参数类型不符：where 携带 expr / fn / arg', () => {
    const err = evalExpectError('rand("a", 2) + 1');
    expect(err.messageKey).toBe('error.eval.invalidArgument');
    expect(err.where['expr']).toBe('rand("a", 2) + 1');
    expect(err.where['fn']).toBe('rand');
    expect(err.where['arg']).toBe('1');
  });

  it('随机边界违规：where 携带 expr / fn', () => {
    expect(evalExpectError('rand(5, 1)').where['fn']).toBe('rand');
    expect(evalExpectError('chance(1.5) ? 1 : 0').where['fn']).toBe('chance');
    expect(evalExpectError('randInt(1.5, 3)').messageKey).toBe('error.eval.invalidArgument');
  });

  it('嵌套位置的错误同样归因到完整表达式原文', () => {
    const err = evalExpectError('min(1, body("typo_part"))');
    expect(err.where['expr']).toBe('min(1, body("typo_part"))');
    expect(err.where['fn']).toBe('body');
    expect(err.where['key']).toBe('typo_part');
  });

  it('非 EngineError 的函数缺陷收敛为 EVAL_ERROR（cause 保留原始错误）', () => {
    const err = evalExpectError('broken() + 1', REGISTRY_WITH_BROKEN_FN);
    expect(err.code).toBe('EVAL_ERROR');
    expect(err.messageKey).toBe('error.eval.functionFailed');
    expect(err.where['expr']).toBe('broken() + 1');
    expect(err.where['fn']).toBe('broken');
    expect(err.cause).toBeInstanceOf(Error);
  });
});

describe('B4：除零在任何嵌套位置都抛出（无静默默认值）', () => {
  it.each([
    'rand(1 / 0, 2)', // 函数实参内的除零，先于函数体求值抛出
    'clamp(1, 0, 5 / 0)',
    'flag("chapter") / (loop() - loop())', // 运行时算出的零除数
  ])('%s', (source) => {
    const err = evalExpectError(source);
    expect(err.messageKey).toBe('error.eval.divisionByZero');
    expect(err.where['expr']).toBe(source);
  });
});

describe('B4：嵌套隐式转换禁止（真值化不蔓延到算术语境）', () => {
  it('渐进域缺席值进入算术 → EVAL_ERROR（而非 0/1 化）', () => {
    expect(evalExpectError('flag("never_set") + 1').messageKey).toBe('error.eval.typeMismatch');
    expect(evalExpectError('flag("never_set") * 2').messageKey).toBe('error.eval.typeMismatch');
    expect(evalExpectError('quest("ghost") + ""').messageKey).toBe('error.eval.typeMismatch');
  });

  it('查询函数的 boolean 返回值进入算术 → EVAL_ERROR', () => {
    expect(evalExpectError('met("raven") + 1').messageKey).toBe('error.eval.typeMismatch');
    expect(evalExpectError('has("potion") * 3').messageKey).toBe('error.eval.typeMismatch');
  });

  it('string 返回值进入非 + 算术 → EVAL_ERROR；串+串拼接合法', () => {
    expect(evalExpectError('body("race") * 2').messageKey).toBe('error.eval.typeMismatch');
    expect(evalExpectError('-body("race")').messageKey).toBe('error.eval.typeMismatch');
    expect(
      evalExpr(
        compileExpr('body("race") + "/" + body("build")', REGISTRY),
        makeContext(),
      ) as string,
    ).toBe('human/slim');
  });

  it('「未设置」判定的惯用形式不报错：nullish 与 null 相等', () => {
    expect(evalExpr(compileExpr('flag("never_set") == null', REGISTRY), makeContext())).toBe(true);
    expect(evalExpr(compileExpr('quest("ghost") != null', REGISTRY), makeContext())).toBe(false);
    expect(evalExpr(compileExpr('worn("head", 1) == null', REGISTRY), makeContext())).toBe(true);
  });
});
