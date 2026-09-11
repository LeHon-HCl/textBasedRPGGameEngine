import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import { parseExpr } from '../../src/expr-eval/parse.js';
import type { ExprNode } from '@game/shared';

/**
 * 03 任务 A1：jsep 定制解析器 + EBNF 逐条文法用例（设计 §2.3）。
 *
 * 覆盖面：
 * - 每个产生式（NUMBER / STRING / true / false / null / path / call / unary /
 *   各层二元 / ternary / 括号分组）至少一条正例，AST 结构逐节点断言；
 * - 优先级与结合性按 EBNF 分层以 AST 形态断言（不是只断言求值结果）；
 * - 「关闭的语法」全集：jsep 原生 identifier/member/call 产物、被裁剪的
 *   运算符、对象/数组/模板字符串/正则/赋值等 EBNF 之外的构造 → EXPR_COMPILE，
 *   且 where.expr 携带表达式原文（DD-01）。
 * 注：parse 层不做变量域白名单校验（那是 compileExpr 的职责），因此本文件
 * 的路径用例可使用任意标识符形态。
 */

/** 逐字段断言 AST 形态（toEqual 深比较，无多余/缺失字段） */
function parseOk(source: string): ExprNode {
  return parseExpr(source);
}

function expectParseError(source: string): EngineError {
  let captured: unknown;
  try {
    parseExpr(source);
  } catch (err) {
    captured = err;
  }
  expect(captured, `expected EXPR_COMPILE for: ${source}`).toBeInstanceOf(EngineError);
  const err = captured as EngineError;
  expect(err.code).toBe('EXPR_COMPILE');
  expect(err.where['expr']).toBe(source);
  expect(err.where['detail']).toBeTypeOf('string');
  return err;
}

const num = (value: number): ExprNode => ({ kind: 'num', value });
const str = (value: string): ExprNode => ({ kind: 'str', value });
const bool = (value: boolean): ExprNode => ({ kind: 'bool', value });
const path = (...segments: string[]): ExprNode => ({ kind: 'path', segments });
const call = (name: string, args: ExprNode[]): ExprNode => ({ kind: 'call', name, args });
const unary = (op: '!' | '-' | '+', operand: ExprNode): ExprNode => ({
  kind: 'unary',
  op,
  operand,
});
const bin = (op: string, left: ExprNode, right: ExprNode): ExprNode => ({
  kind: 'binary',
  op: op as Extract<ExprNode, { kind: 'binary' }>['op'],
  left,
  right,
});
const cond = (test: ExprNode, then: ExprNode, els: ExprNode): ExprNode => ({
  kind: 'cond',
  test,
  then,
  else: els,
});

describe('parseExpr：primary 产生式（§2.3）', () => {
  it.each([
    ['42', num(42)],
    ['0', num(0)],
    ['3.14', num(3.14)],
    ['.5', num(0.5)],
    ['1e3', num(1000)],
    ['2.5e-1', num(0.25)],
  ])('NUMBER %s', (source, expected) => {
    expect(parseOk(source)).toEqual(expected);
  });

  it.each([
    ['"hi"', str('hi')],
    ["'yo'", str('yo')],
    ['"a\\nb"', str('a\nb')],
    ['"a\\\\b"', str('a\\b')],
  ])('STRING %s', (source, expected) => {
    expect(parseOk(source)).toEqual(expected);
  });

  it('true / false / null 字面量', () => {
    expect(parseOk('true')).toEqual(bool(true));
    expect(parseOk('false')).toEqual(bool(false));
    expect(parseOk('null')).toEqual({ kind: 'null' });
  });

  it('path：单段与多段（IDENT { "." IDENT }）', () => {
    expect(parseOk('attr')).toEqual(path('attr'));
    expect(parseOk('attr.hp')).toEqual(path('attr', 'hp'));
    expect(parseOk('npc.raven.flags.mood')).toEqual(path('npc', 'raven', 'flags', 'mood'));
    // '.' 两侧允许空白
    expect(parseOk('a . b')).toEqual(path('a', 'b'));
    // jsep 标识符字符含 '$' 与 '_'
    expect(parseOk('$x._y')).toEqual(path('$x', '_y'));
  });

  it.each([
    ['f()', call('f', [])],
    ['has("sword")', call('has', [str('sword')])],
    ['f(1, attr.hp)', call('f', [num(1), path('attr', 'hp')])],
    ['f(g(1), 2)', call('f', [call('g', [num(1)]), num(2)])],
    ['f((1 + 2))', call('f', [bin('+', num(1), num(2))])],
    // 调用括号前允许空白
    ['flag ("a")', call('flag', [str('a')])],
  ])('call：%s', (source, expected) => {
    expect(parseOk(source)).toEqual(expected);
  });

  it('括号分组改变结构但不产生独立节点', () => {
    expect(parseOk('(1)')).toEqual(num(1));
    expect(parseOk('(  attr.hp  )')).toEqual(path('attr', 'hp'));
  });
});

describe('parseExpr：unary 产生式', () => {
  it.each([
    ['!a', unary('!', path('a'))],
    ['-1', unary('-', num(1))],
    ['+x', unary('+', path('x'))],
    ['!!a', unary('!', unary('!', path('a')))],
    ['- -x', unary('-', unary('-', path('x')))],
    ['-(-1)', unary('-', unary('-', num(1)))],
  ])('%s', (source, expected) => {
    expect(parseOk(source)).toEqual(expected);
  });
});

describe('parseExpr：13 个二元运算符逐个可解析（§2.3 binary 节点）', () => {
  it.each([
    ['1 + 2', '+'],
    ['1 - 2', '-'],
    ['1 * 2', '*'],
    ['1 / 2', '/'],
    ['1 % 2', '%'],
    ['1 == 2', '=='],
    ['1 != 2', '!='],
    ['1 < 2', '<'],
    ['1 <= 2', '<='],
    ['1 > 2', '>'],
    ['1 >= 2', '>='],
    ['1 && 2', '&&'],
    ['1 || 2', '||'],
  ])('%s', (source, op) => {
    expect(parseOk(source)).toEqual(bin(op, num(1), num(2)));
  });
});

describe('parseExpr：优先级与结合性（EBNF 分层的 AST 形态断言）', () => {
  it.each([
    // multiplicative 高于 additive
    ['1 + 2 * 3', bin('+', num(1), bin('*', num(2), num(3)))],
    ['10 - 4 / 2', bin('-', num(10), bin('/', num(4), num(2)))],
    // additive / multiplicative 均左结合
    ['1 - 2 - 3', bin('-', bin('-', num(1), num(2)), num(3))],
    ['2 * 3 % 4', bin('%', bin('*', num(2), num(3)), num(4))],
    // comparison 高于 equality
    ['a == b < c', bin('==', path('a'), bin('<', path('b'), path('c')))],
    ['a < b + c', bin('<', path('a'), bin('+', path('b'), path('c')))],
    // equality 高于 logicAnd，logicAnd 高于 logicOr
    ['a && b == c', bin('&&', path('a'), bin('==', path('b'), path('c')))],
    ['a || b && c', bin('||', path('a'), bin('&&', path('b'), path('c')))],
    ['a || b || c', bin('||', bin('||', path('a'), path('b')), path('c'))],
    // unary 高于 multiplicative
    ['-a * b', bin('*', unary('-', path('a')), path('b'))],
    ['!a == b', bin('==', unary('!', path('a')), path('b'))],
    // 括号覆盖默认优先级
    ['(1 + 2) * 3', bin('*', bin('+', num(1), num(2)), num(3))],
    ['a - (b - c)', bin('-', path('a'), bin('-', path('b'), path('c')))],
    ['!(a && b)', unary('!', bin('&&', path('a'), path('b')))],
    // 一元嵌套链
    ['!-+x', unary('!', unary('-', unary('+', path('x'))))],
  ])('%s', (source, expected) => {
    expect(parseOk(source)).toEqual(expected);
  });
});

describe('parseExpr：ternary 产生式（最低优先级、右结合、分支为完整 expr）', () => {
  it('基础形态', () => {
    expect(parseOk('a ? b : c')).toEqual(cond(path('a'), path('b'), path('c')));
  });

  it('else 分支右结合：a ? b : c ? d : e', () => {
    expect(parseOk('a ? b : c ? d : e')).toEqual(
      cond(path('a'), path('b'), cond(path('c'), path('d'), path('e'))),
    );
  });

  it('then 分支可嵌套完整 expr：a ? b ? c : d : e', () => {
    expect(parseOk('a ? b ? c : d : e')).toEqual(
      cond(path('a'), cond(path('b'), path('c'), path('d')), path('e')),
    );
  });

  it('ternary 优先级低于 logicOr', () => {
    expect(parseOk('a || b ? c : d')).toEqual(
      cond(bin('||', path('a'), path('b')), path('c'), path('d')),
    );
    expect(parseOk('a ? b : c || d')).toEqual(
      cond(path('a'), path('b'), bin('||', path('c'), path('d'))),
    );
  });

  it('ternary 可作为函数实参与算术操作数', () => {
    expect(parseOk('f(a ? 1 : 2)')).toEqual(call('f', [cond(path('a'), num(1), num(2))]));
    expect(parseOk('1 + (a ? 1 : 2)')).toEqual(bin('+', num(1), cond(path('a'), num(1), num(2))));
  });
});

describe('parseExpr：关闭的语法（jsep 原生 identifier/member/call 与被裁剪运算符）', () => {
  it.each([
    'a.b()', // 对路径调用（call 仅允许裸标识符）
    '(f)()', // 非标识符调用目标
    '"s".length', // 字符串成员
    '(1 + 2).x', // 分组成员
    'a[0]', // 计算成员
    '[1, 2]', // 数组字面量
    '[]',
    '{a: 1}', // 对象字面量
    'a = 1', // 赋值
    'a === b', // 严格相等（EBNF 外）
    'a !== b',
    'a | b', // 位运算（EBNF 外）
    'a ^ b',
    'a & b',
    'a << b',
    'a >> b',
    'a >>> b',
    'a ** b', // 指数（EBNF 外）
    'a ?? b', // 空值合并（EBNF 外）
    '~a', // 按位非（EBNF 外）
    'a, b', // 逗号复合
    'a; b', // 分号复合
    '(a, b)', // 序列表达式
    '`tpl ${x}`', // 模板字符串
    '`tpl`',
    '/re/', // 正则字面量
    'a?.b', // 可选链（EBNF 外）
    'a ?. b',
    'new F()', // new 表达式
    'a ? b', // 缺少 ':'
    'a ? b :', // 缺少 else 分支
    '()', // 空括号
    'a.', // 悬空点号
    'a..b',
    '', // 空表达式
    '   ',
    '123abc', // 数字后接标识符
    'f(1,)', // 悬空逗号
    'f(,1)',
    '1 +', // 悬空运算符
    '&& a',
    'attr.5', // 段必须是标识符
  ])('语法拒绝：%s', (source) => {
    expectParseError(source);
  });

  it('语法错误携带定位细节（detail 含 jsep 出错位置）', () => {
    const err = expectParseError('1 +');
    expect(err.where['detail']).toContain('character');
  });
});

describe('parseExpr：与 compileExpr 的职责边界', () => {
  it('parse 层不做变量域白名单校验（未知 root 在编译层拒绝）', () => {
    expect(parseOk('zzz.yyy')).toEqual(path('zzz', 'yyy'));
    expect(parseOk('this')).toEqual(path('this'));
  });
});
