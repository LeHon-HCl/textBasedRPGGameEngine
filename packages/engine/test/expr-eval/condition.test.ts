import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '@game/shared';
import { compileExpr } from '../../src/expr-eval/compile.js';
import { evalCondition, evalExpr, truthy } from '../../src/expr-eval/eval.js';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/builtins.js';
import { makeCtx, makeScope } from './fixtures.js';
import type { ExprFunctionRegistry } from '@game/shared';

/**
 * 03 任务 B5：顶层条件真值化规则（DD-01：undefined/null/0/'' 为假，
 * 仅限 if / show_if / require 语境）。
 *
 * - evalCondition 对**最终结果**真值化并恒返回 boolean；
 * - evalExpr 返回原值（0 是数字、未设置是 undefined）——两入口成对，
 *   防止真值化被滥用到算术语境；
 * - 真值化不削弱表达式内部严格性：除零 / 类型不匹配照常抛 EVAL_ERROR。
 */

const REGISTRY: ExprFunctionRegistry = createBuiltinFunctionRegistry();

function condition(source: string): boolean {
  return evalCondition(
    compileExpr(source, REGISTRY),
    makeCtx(makeScope(), createRng(42), REGISTRY),
  );
}

function evalStrict(source: string): unknown {
  return evalExpr(compileExpr(source, REGISTRY), makeCtx(makeScope(), createRng(42), REGISTRY));
}

function conditionExpectError(source: string): EngineError {
  let captured: unknown;
  try {
    condition(source);
  } catch (err) {
    captured = err;
  }
  expect(captured, `expected EVAL_ERROR for: ${source}`).toBeInstanceOf(EngineError);
  return captured as EngineError;
}

describe('B5：evalCondition 真值化规则（DD-01 假值全集）', () => {
  it.each([
    ['flag("never_set")', 'undefined（未设置 flag）'],
    ['quest("ghost")', 'undefined（未开始任务）'],
    ['worn("head", 1)', 'null（空穿戴位）'],
    ['0', '数字零'],
    ['""', '空字符串'],
    ['false', '布尔假'],
    ['"" == "" && false', '逻辑假'],
  ])('%s → false（%s）', (source) => {
    expect(condition(source)).toBe(false);
  });

  it.each([
    ['1', '非零数字'],
    ['-1', '负数'],
    ['"0"', '非空字符串（字面 0）'],
    ['"false"', '非空字符串'],
    ['attr.hp', '正数状态值'],
    ['" "', '空白字符串（非空）'],
    ['flag("chapter")', '真值 flag（数字 2）'],
    ['worn("torso", 1)', '已穿戴（itemId 字符串）'],
  ])('%s → true（%s）', (source) => {
    expect(condition(source)).toBe(true);
  });

  it('恒返回 boolean 类型', () => {
    expect(condition('attr.hp')).toBeTypeOf('boolean');
    expect(condition('flag("never_set")')).toBeTypeOf('boolean');
  });

  it('复合顶层条件（if/show_if/require 的典型形态）', () => {
    expect(condition('flag("door_opened") && item.key.count >= 1')).toBe(true);
    expect(condition('npc.raven.met && rep("mages") >= 20')).toBe(false);
    // 三元条件位同样真值化
    expect(condition('quest("ghost") ? 1 : 0')).toBe(false);
  });
});

describe('B5：与 evalExpr 的入口边界（真值化不被滥用）', () => {
  it('evalExpr 返回原值而非真值化结果', () => {
    expect(evalStrict('flag("never_set")')).toBeUndefined();
    expect(evalStrict('worn("head", 1)')).toBeNull();
    expect(evalStrict('0')).toBe(0);
    expect(typeof evalStrict('0')).toBe('number');
    expect(evalStrict('""')).toBe('');
  });

  it('真值化不削弱内部严格性：除零 / 类型不匹配 / 缺 key 照常抛出', () => {
    expect(conditionExpectError('1 / 0').messageKey).toBe('error.eval.divisionByZero');
    expect(conditionExpectError('"a" + 1').messageKey).toBe('error.eval.typeMismatch');
    expect(conditionExpectError('attr.typo_key > 0').messageKey).toBe('error.eval.missingKey');
    expect(conditionExpectError('rep("typo") >= 0').messageKey).toBe('error.eval.missingKey');
  });
});

describe('B5：truthy 判别函数（含防御分支）', () => {
  it.each([
    [undefined, false],
    [null, false],
    [false, false],
    [0, false],
    ['', false],
    [Number.NaN, false],
    ['0', true],
    [' ', true],
    [-1, true],
    [true, true],
    [{}, true],
  ])('truthy(%s) === %j', (value, expected) => {
    expect(truthy(value)).toBe(expected);
  });
});
