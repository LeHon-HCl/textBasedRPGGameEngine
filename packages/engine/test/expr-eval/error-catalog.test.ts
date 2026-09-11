import { describe, expect, it } from 'vitest';
import { createRng, EngineError, isEngineError } from '@game/shared';
import type { ExprFunctionRegistry } from '@game/shared';
import type { CompileOptions } from '../../src/expr-eval/compile.js';
import { compileExpr } from '../../src/expr-eval/compile.js';
import { evalExpr } from '../../src/expr-eval/eval.js';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/builtins.js';
import { makeCtx, makeScope } from './fixtures.js';

/**
 * 03 任务 C3：错误用例全集——编译期 4 类 + 运行期 3 类（DD-01），
 * 统一目录表逐条断言 ErrCode、messageKey 与 where 定位字段。
 *
 * 编译期（EXPR_COMPILE，阻断，where.expr = 表达式原文）：
 *   1. 未知 root（白名单外）；1b. 已知 root 路径形态不符；
 *   2. 未知函数；3. 参数个数不符；4. pure=false 出现在缓存敏感位置。
 *   （另有语法/空表达式等解析层错误归入同一 ErrCode。）
 * 运行期（EVAL_ERROR，一律抛出、无静默默认值，where.expr = 表达式原文）：
 *   1. 除零 / 模零；2. 类型不匹配（隐式转换禁止）；3. 已知 root 缺 key。
 * 每条目录附带「正例对照」——等价合法表达式必须不抛错，证明错误并非误报。
 */

const REGISTRY: ExprFunctionRegistry = createBuiltinFunctionRegistry();

interface ErrorRow {
  readonly source: string;
  readonly messageKey: string;
  /** where 中必须逐字段相等的定位子集（expr 之外） */
  readonly where: Readonly<Record<string, string>>;
  readonly options?: CompileOptions;
  /** 正例对照：等价合法表达式（不抛错） */
  readonly positive?: string;
}

/** 编译期错误目录（EXPR_COMPILE） */
const COMPILE_ERRORS: readonly ErrorRow[] = [
  // 1. 未知 root
  {
    source: 'foo.bar',
    messageKey: 'error.expr.unknownRoot',
    where: { root: 'foo', path: 'foo.bar' },
    positive: 'attr.bar',
  },
  {
    source: 'foo',
    messageKey: 'error.expr.unknownRoot',
    where: { root: 'foo', path: 'foo' },
    positive: 'loop',
  },
  // 1b. 已知 root 形态不符
  {
    source: 'item.gold',
    messageKey: 'error.expr.badPath',
    where: { root: 'item', path: 'item.gold' },
    positive: 'item.gold.count',
  },
  {
    source: 'time.year',
    messageKey: 'error.expr.badPath',
    where: { root: 'time', path: 'time.year' },
    positive: 'time.day',
  },
  {
    source: 'npc.raven',
    messageKey: 'error.expr.badPath',
    where: { root: 'npc', path: 'npc.raven' },
    positive: 'npc.raven.favor',
  },
  // 2. 未知函数
  {
    source: 'nope(1)',
    messageKey: 'error.expr.unknownFunction',
    where: { fn: 'nope' },
    positive: 'min(1, 2)',
  },
  {
    source: 'min(1, nope(2))',
    messageKey: 'error.expr.unknownFunction',
    where: { fn: 'nope' },
    positive: 'min(1, max(2, 3))',
  },
  // 3. 参数个数不符
  {
    source: 'rand(1)',
    messageKey: 'error.expr.arityMismatch',
    where: { fn: 'rand', expected: '2', actual: '1' },
    positive: 'rand(1, 2)',
  },
  {
    source: 'worn(a, b, c)',
    messageKey: 'error.expr.arityMismatch',
    where: { fn: 'worn', expected: '1..2', actual: '3' },
    positive: 'worn("torso", 1)',
  },
  {
    source: 'loop(1)',
    messageKey: 'error.expr.arityMismatch',
    where: { fn: 'loop', expected: '0', actual: '1' },
    positive: 'loop()',
  },
  // 4. pure=false 在缓存敏感位置（requirePure 语境）
  {
    source: 'rand(1, 2)',
    messageKey: 'error.expr.impureFunction',
    where: { fn: 'rand' },
    options: { requirePure: true },
    positive: 'min(1, 2)',
  },
  {
    source: 'min(1, chance(0.5))',
    messageKey: 'error.expr.impureFunction',
    where: { fn: 'chance' },
    options: { requirePure: true },
    positive: 'min(1, max(0, 1))',
  },
  // 解析层（同属 EXPR_COMPILE）：语法错误与 EBNF 外语法
  {
    source: '1 +',
    messageKey: 'error.expr.syntax',
    where: {},
    positive: '1 + 2',
  },
  {
    source: 'a.b()',
    messageKey: 'error.expr.syntax',
    where: {},
    positive: 'attr.hp + 1',
  },
  {
    source: '[1, 2]',
    messageKey: 'error.expr.unsupportedSyntax',
    where: {},
    positive: '1 + 2',
  },
];

/** 运行期错误目录（EVAL_ERROR） */
const EVAL_ERRORS: readonly ErrorRow[] = [
  // 1. 除零 / 模零
  {
    source: '5 / 0',
    messageKey: 'error.eval.divisionByZero',
    where: { op: '/' },
    positive: '5 / 2',
  },
  {
    source: '5 % 0',
    messageKey: 'error.eval.divisionByZero',
    where: { op: '%' },
    positive: '5 % 2',
  },
  {
    source: 'attr.hp / (loop() - loop())',
    messageKey: 'error.eval.divisionByZero',
    where: { op: '/' },
    positive: 'attr.hp / (loop() - loop() + 1)',
  },
  // 2. 类型不匹配（隐式转换禁止）
  {
    source: '1 + "a"',
    messageKey: 'error.eval.typeMismatch',
    where: { op: '+' },
    positive: '1 + 2',
  },
  {
    source: '"a" * 2',
    messageKey: 'error.eval.typeMismatch',
    where: { op: '*' },
    positive: '"a" + "b"',
  },
  {
    source: '"a" < 1',
    messageKey: 'error.eval.typeMismatch',
    where: { op: '<' },
    positive: '"a" < "b"',
  },
  {
    source: '-"a"',
    messageKey: 'error.eval.typeMismatch',
    where: { op: '-' },
    positive: '-1',
  },
  {
    source: 'flag("never_set") + 1',
    messageKey: 'error.eval.typeMismatch',
    where: { op: '+' },
    positive: 'flag("never_set") == null',
  },
  // 3. 已知 root 缺 key（封闭域）
  {
    source: 'attr.typo_key + 1',
    messageKey: 'error.eval.missingKey',
    where: { path: 'attr.typo_key', key: 'typo_key' },
    positive: 'attr.hp + 1',
  },
  {
    source: 'npc.ghost.favor',
    messageKey: 'error.eval.missingKey',
    where: { path: 'npc.ghost.favor', key: 'ghost' },
    positive: 'npc.raven.favor',
  },
  {
    source: 'quest.ghost.state',
    messageKey: 'error.eval.missingKey',
    where: { path: 'quest.ghost.state', key: 'ghost' },
    positive: 'quest.main.state',
  },
  {
    source: 'wallet.typo_currency',
    messageKey: 'error.eval.missingKey',
    where: { path: 'wallet.typo_currency', key: 'typo_currency' },
    positive: 'wallet.gold',
  },
];

function makeContext(): ReturnType<typeof makeCtx> {
  return makeCtx(makeScope(), createRng(42), REGISTRY);
}
describe('C3：编译期错误全集（EXPR_COMPILE，4 类 + 解析层）', () => {
  it.each(COMPILE_ERRORS.map((row) => [row.source, row] as const))('%s', (source, row) => {
    let captured: unknown;
    try {
      compileExpr(source, REGISTRY, row.options);
    } catch (err) {
      captured = err;
    }
    expect(captured, source).toBeInstanceOf(EngineError);
    expect(isEngineError(captured)).toBe(true);
    const err = captured as EngineError;
    // ErrCode 与 messageKey
    expect(err.code, source).toBe('EXPR_COMPILE');
    expect(err.messageKey, source).toBe(row.messageKey);
    // where：表达式原文 + 各定位字段
    expect(err.where['expr'], source).toBe(source);
    for (const [key, value] of Object.entries(row.where)) {
      expect(err.where[key], `${source} where.${key}`).toBe(value);
    }
    // 正例对照：等价合法表达式不抛错（非 requirePure 行以默认选项复核）
    const positive = row.positive;
    if (positive) {
      expect(() => compileExpr(positive, REGISTRY, row.options), positive).not.toThrow();
    }
  });

  it('requirePure 行不加选项时不报错（缓存敏感与否由调用方位置决定）', () => {
    expect(() => compileExpr('rand(1, 2)', REGISTRY)).not.toThrow();
    expect(() => compileExpr('min(1, chance(0.5))', REGISTRY)).not.toThrow();
  });

  it('空表达式也是编译期错误', () => {
    expect(() => compileExpr('', REGISTRY)).toThrow(EngineError);
  });
});

describe('C3：运行期错误全集（EVAL_ERROR，3 类）', () => {
  it.each(EVAL_ERRORS.map((row) => [row.source, row] as const))('%s', (source, row) => {
    let captured: unknown;
    try {
      const compiled = compileExpr(source, REGISTRY);
      evalExpr(compiled, makeCtx(makeScope(), createRng(42), REGISTRY));
    } catch (err) {
      captured = err;
    }
    expect(captured, source).toBeInstanceOf(EngineError);
    expect(isEngineError(captured)).toBe(true);
    const err = captured as EngineError;
    // ErrCode 与 messageKey
    expect(err.code, source).toBe('EVAL_ERROR');
    expect(err.messageKey, source).toBe(row.messageKey);
    // where：表达式原文 + 各定位字段
    expect(err.where['expr'], source).toBe(source);
    for (const [key, value] of Object.entries(row.where)) {
      expect(err.where[key], `${source} where.${key}`).toBe(value);
    }
    // 正例对照：等价合法表达式不抛错且可求值
    if (row.positive) {
      const compiled = compileExpr(row.positive, REGISTRY);
      expect(() => evalExpr(compiled, makeContext())).not.toThrow();
    }
  });
});
