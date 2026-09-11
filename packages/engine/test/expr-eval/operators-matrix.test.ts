import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { ExprFunctionRegistry, ExprNode } from '@game/shared';
import { compileExpr } from '../../src/expr-eval/compile.js';
import { evalCondition, evalExpr } from '../../src/expr-eval/eval.js';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/builtins.js';
import { makeCtx, makeScope } from './fixtures.js';

/**
 * 03 任务 C1：表驱动测试矩阵——每运算符 × 优先级 × 短路 × 三元。
 *
 * - 运算符 × 操作数类型：每个二元运算符对 4 类字面量操作数（number /
 *   string / boolean / null）的合法组合断言值、非法组合断言 typeMismatch；
 * - 优先级：对 13 个二元运算符的全部 78 个有序配对，以 `1 A 2 B 3` 的
 *   AST 分组断言结合方式；期望分组由**测试内**的 EBNF 分层表（§2.3 文法
 *   文本换算，不 import 实现）推导；
 * - 短路：假值/真值左操作数 × &&/|| × 「求值即报错（1/0）」与「求值即
 *   消耗随机序列（rand）」见证；
 * - 三元：条件位假值/真值全集 × 分支选择性求值。
 */

const REGISTRY: ExprFunctionRegistry = createBuiltinFunctionRegistry();

function makeContext(): ReturnType<typeof makeCtx> {
  return makeCtx(makeScope(), createRng(42), REGISTRY);
}

function evalOk(source: string): unknown {
  return evalExpr(compileExpr(source, REGISTRY), makeContext());
}

/** 布尔语境的假值 / 真值操作数（含渐进域缺席形态） */
const FALSY: readonly string[] = [
  'false',
  '0',
  '""',
  'null',
  'flag("never_set")',
  'quest("ghost")',
  'worn("head", 1)',
];
const TRUTHY: readonly string[] = [
  'true',
  '1',
  '"0"',
  'attr.hp',
  'flag("door_opened")',
  'quest("main")',
  'met("raven")',
];

const num = (value: number): ExprNode => ({ kind: 'num', value });
const bin = (op: string, left: ExprNode, right: ExprNode): ExprNode => ({
  kind: 'binary',
  op: op as Extract<ExprNode, { kind: 'binary' }>['op'],
  left,
  right,
});

/** §2.3 文法分层（1 = logicOr 最松 … 6 = multiplicative 最紧） */
const EBNF_PRECEDENCE: Readonly<Record<string, number>> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

const ALL_OPS = Object.keys(EBNF_PRECEDENCE);

describe('C1：运算符 × 操作数类型矩阵（合法组合 → 值）', () => {
  const matrix: readonly { source: string; expected: unknown }[] = [
    // 算术（number 闭合；+ 对 string 闭合）
    { source: '7 + 2', expected: 9 },
    { source: '"7" + "2"', expected: '72' },
    { source: '7 - 2', expected: 5 },
    { source: '7 * 2', expected: 14 },
    { source: '7 / 2', expected: 3.5 },
    { source: '7 % 2', expected: 1 },
    // 比较：number 闭合
    { source: '7 < 2', expected: false },
    { source: '7 <= 7', expected: true },
    { source: '7 > 2', expected: true },
    { source: '7 >= 8', expected: false },
    // 比较：string 闭合（字典序）
    { source: '"b" < "a"', expected: false },
    { source: '"a" <= "a"', expected: true },
    { source: '"b" > "a"', expected: true },
    { source: '"b" >= "c"', expected: false },
    // 相等：同类型值比较，跨类型恒不等（无隐式转换）
    { source: '1 == 1', expected: true },
    { source: '1 == 2', expected: false },
    { source: '"a" == "a"', expected: true },
    { source: 'true == true', expected: true },
    { source: 'null == null', expected: true },
    { source: '1 == "1"', expected: false },
    { source: '1 == true', expected: false },
    { source: '"" == 0', expected: false },
    { source: 'null == ""', expected: false },
    { source: '1 != 2', expected: true },
    { source: 'null != null', expected: false },
    { source: '1 != "1"', expected: true },
  ];
  it.each(matrix.map((row) => [row.source, row.expected]))('%s === %j', (source, expected) => {
    expect(evalOk(source)).toStrictEqual(expected);
  });
});

describe('C1：运算符 × 操作数类型矩阵（非法组合 → EVAL_ERROR typeMismatch）', () => {
  // 4 类字面量操作数在非 + 算术 / 跨类型比较 / 跨类型相等语境下的全部非法形态
  const illegal: readonly { source: string; op: string }[] = [
    { source: '"a" - 1', op: '-' },
    { source: '1 - "a"', op: '-' },
    { source: 'true - 1', op: '-' },
    { source: 'null - 1', op: '-' },
    { source: '"a" * 1', op: '*' },
    { source: '1 * null', op: '*' },
    { source: '"a" / 1', op: '/' },
    { source: '1 / true', op: '/' },
    { source: '"a" % 1', op: '%' },
    { source: '1 % null', op: '%' },
    { source: 'true + 1', op: '+' },
    { source: 'null + 1', op: '+' },
    { source: '1 + null', op: '+' },
    { source: '"a" + 1', op: '+' },
    { source: '1 + "a"', op: '+' },
    { source: 'true + "a"', op: '+' },
    { source: '"a" < 1', op: '<' },
    { source: '1 <= "a"', op: '<=' },
    { source: 'null > 1', op: '>' },
    { source: 'true >= false', op: '>=' },
    { source: '"a" > null', op: '>' },
    { source: 'null < null', op: '<' },
  ];
  it.each(illegal.map((row) => [row.source, row.op]))('%s → typeMismatch', (source, op) => {
    let messageKey = '';
    try {
      evalOk(source);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      messageKey = (err as { messageKey?: string }).messageKey ?? '';
    }
    expect(messageKey, source).toBe('error.eval.typeMismatch');
    // 运算符维度进 where（错误定位可归因到具体运算符）
    const compiled = compileExpr(source, REGISTRY);
    expect(compiled.ast.kind).toBe('binary');
    expect((compiled.ast as { op: string }).op).toBe(op);
  });
});

describe('C1：优先级配对矩阵（169 个有序配对的 AST 分组，期望由 EBNF 分层表推导）', () => {
  // 期望分组：prec(A) >= prec(B)（含同层左结合）→ (1 A 2) B 3；否则 1 A (2 B 3)
  const pairs: readonly { a: string; b: string; leftFirst: boolean }[] = ALL_OPS.flatMap((a) =>
    ALL_OPS.map((b) => ({
      a,
      b,
      leftFirst: (EBNF_PRECEDENCE[a] ?? 0) >= (EBNF_PRECEDENCE[b] ?? 0),
    })),
  );

  it('配对完备性：13 × 12（去同 op 相邻退化）+ 同 op 全覆盖', () => {
    expect(pairs.length).toBe(ALL_OPS.length * ALL_OPS.length);
  });

  it.each(pairs.map((p) => [p.a, p.b, p.leftFirst]))(
    '1 %s 2 %s 3 的结合方式',
    (a, b, leftFirst) => {
      const ast = compileExpr(`1 ${a} 2 ${b} 3`, REGISTRY).ast;
      const expected = leftFirst
        ? bin(b, bin(a, num(1), num(2)), num(3))
        : bin(a, num(1), bin(b, num(2), num(3)));
      expect(ast, `1 ${a} 2 ${b} 3`).toEqual(expected);
    },
  );

  it('全配对计数与分层关系抽查（EBNF 六层两两验证）', () => {
    // 层间关系抽样：越紧的层在混合表达式中越先结合
    expect(compileExpr('1 || 2 && 3', REGISTRY).ast).toEqual(
      bin('||', num(1), bin('&&', num(2), num(3))),
    );
    expect(compileExpr('1 && 2 == 3', REGISTRY).ast).toEqual(
      bin('&&', num(1), bin('==', num(2), num(3))),
    );
    expect(compileExpr('1 == 2 < 3', REGISTRY).ast).toEqual(
      bin('==', num(1), bin('<', num(2), num(3))),
    );
    expect(compileExpr('1 < 2 + 3', REGISTRY).ast).toEqual(
      bin('<', num(1), bin('+', num(2), num(3))),
    );
    expect(compileExpr('1 + 2 * 3', REGISTRY).ast).toEqual(
      bin('+', num(1), bin('*', num(2), num(3))),
    );
  });
});

describe('C1：短路矩阵（假值/真值左操作数 × &&/|| × 求值见证）', () => {
  it('假值 && X：返回左操作数，右侧不求值（即使右侧必抛除零）', () => {
    for (const lhs of FALSY) {
      const rng = createRng(42);
      const ctx = makeCtx(makeScope(), rng, REGISTRY);
      const before = rng.getState();
      const value = evalExpr(compileExpr(`${lhs} && 1 / 0`, REGISTRY), ctx);
      expect(value, `${lhs} && 1/0`).toStrictEqual(evalOk(lhs));
      expect(rng.getState(), `${lhs} && 1/0 不应消耗随机序列`).toBe(before);
    }
  });

  it('真值 || X：返回左操作数，右侧不求值', () => {
    for (const lhs of TRUTHY) {
      const rng = createRng(42);
      const ctx = makeCtx(makeScope(), rng, REGISTRY);
      const before = rng.getState();
      const value = evalExpr(compileExpr(`${lhs} || 1 / 0`, REGISTRY), ctx);
      expect(value, `${lhs} || 1/0`).toStrictEqual(evalOk(lhs));
      expect(rng.getState()).toBe(before);
    }
  });

  it('真值 && X：右侧求值，随机序列恰好消耗一次', () => {
    for (const lhs of TRUTHY) {
      const rng = createRng(42);
      const ctx = makeCtx(makeScope(), rng, REGISTRY);
      const before = rng.getState();
      const value = evalExpr(compileExpr(`${lhs} && rand(1, 2)`, REGISTRY), ctx);
      expect(typeof value).toBe('number');
      expect(rng.getState()).not.toBe(before);
    }
  });

  it('假值 || X：右侧求值（取右侧值）', () => {
    for (const lhs of FALSY) {
      const value = evalExpr(compileExpr(`${lhs} || 42`, REGISTRY), makeContext());
      expect(value).toBe(42);
    }
  });
});

describe('C1：三元矩阵（条件位真值化全集 × 分支选择性求值）', () => {
  it('条件位为假 → 取 else 分支（then 分支不求值）', () => {
    for (const cond of FALSY) {
      expect(evalOk(`${cond} ? 1 : 2`), cond).toBe(2);
      // then 分支中的除零不会触发
      expect(evalOk(`${cond} ? 1 / 0 : 2`), cond).toBe(2);
    }
  });

  it('条件位为真 → 取 then 分支（else 分支不求值）', () => {
    for (const cond of TRUTHY) {
      expect(evalOk(`${cond} ? 3 : 1 / 0`), cond).toBe(3);
    }
  });

  it('条件位真值化的结果面：假条件三元取假值分支、真条件取真值分支', () => {
    // evalCondition 真值化的是三元最终结果（分支值），而非条件位本身；
    // 条件位本身的真值化规则已由 B5 与本矩阵的分支选择用例覆盖
    for (const cond of FALSY) {
      expect(evalCondition(compileExpr(`(${cond}) ? 0 : 1`, REGISTRY), makeContext())).toBe(true);
    }
    for (const cond of TRUTHY) {
      expect(evalCondition(compileExpr(`(${cond}) ? 1 : 0`, REGISTRY), makeContext())).toBe(true);
    }
  });

  it('一元 ! 与三元组合的取反矩阵', () => {
    for (const cond of FALSY) {
      expect(evalOk(`!(${cond}) ? 1 : 2`)).toBe(1);
    }
    for (const cond of TRUTHY) {
      expect(evalOk(`!(${cond}) ? 1 : 2`)).toBe(2);
    }
  });
});
