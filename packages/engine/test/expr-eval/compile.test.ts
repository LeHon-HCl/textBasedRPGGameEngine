import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import type { CompiledExpr, ExprFunctionDef, ExprFunctionRegistry, VarRef } from '@game/shared';
import { compileExpr } from '../../src/expr-eval/compile.js';

/**
 * 03 任务 A2 / A3：compileExpr 的 refs 抽取与编译期静态校验。
 *
 * refs 断言要点（设计 §2.3 / §3.2 / §4.4）：
 * - VarRef.root = 路径首段，VarRef.path = 完整点路径（含 root）；
 * - 路径嵌套在函数实参、一元/二元操作数、三元分支内同样收集（先序遍历）；
 * - 按首次出现顺序去重（§4.4 脏标记索引键的唯一性）；
 * - 字面量与函数名本身不产生 refs；source / ast 随编译产物回传。
 *
 * 静态校验断言要点（DD-01 编译期四类，全部 EXPR_COMPILE + where.expr）：
 * - 未知 root（白名单外）与路径形态不符（已知 root 的段数/字段错）；
 * - 未知函数；参数个数不符；pure=false 出现在 requirePure 语境。
 */

/** A3 校验用最小注册表：覆盖三档 arity 形态与 pure 两种取值 */
function def(name: string, arity: [number, number], pure: boolean): [string, ExprFunctionDef] {
  return [name, { name, arity, pure, fn: () => null }];
}

const TEST_REGISTRY: ExprFunctionRegistry = new Map([
  def('rand', [2, 2], false),
  def('chance', [1, 1], false),
  def('worn', [1, 2], true),
  def('loop', [0, 0], true),
  def('min', [2, 2], true),
  def('flag', [1, 1], true),
]);

function compile(source: string, registry: ExprFunctionRegistry = TEST_REGISTRY): CompiledExpr {
  return compileExpr(source, registry);
}

function compileExpectError(source: string, options?: { requirePure?: boolean }): EngineError {
  let captured: unknown;
  try {
    compileExpr(source, TEST_REGISTRY, options);
  } catch (err) {
    captured = err;
  }
  expect(captured, `expected EXPR_COMPILE for: ${source}`).toBeInstanceOf(EngineError);
  const err = captured as EngineError;
  expect(err.code).toBe('EXPR_COMPILE');
  expect(err.where['expr']).toBe(source);
  return err;
}

function refsOf(...paths: string[]): VarRef[] {
  return paths.map((path) => ({ root: path.split('.')[0] as string, path }));
}

describe('compileExpr：refs 抽取（VarRef root/path 语义）', () => {
  it('单一路径：root 为首段，path 为完整点路径', () => {
    expect(compile('attr.hp').refs).toEqual(refsOf('attr.hp'));
    expect(compile('npc.raven.flags.mood').refs).toEqual(refsOf('npc.raven.flags.mood'));
  });

  it('单段路径（root 即完整路径）', () => {
    expect(compile('loop').refs).toEqual(refsOf('loop'));
  });

  it('函数实参内的路径同样收集（先序顺序）', () => {
    expect(compile('min(attr.min, attr.max)').refs).toEqual(refsOf('attr.min', 'attr.max'));
    expect(compile('flag(item.key.count)').refs).toEqual(refsOf('item.key.count'));
  });

  it('一元 / 二元操作数与三元分支内的路径同样收集', () => {
    const compiled = compile('!flag.gate && (attr.hp < 10 ? skill.x.exp : item.kit.count)');
    expect(compiled.refs).toEqual(refsOf('flag.gate', 'attr.hp', 'skill.x.exp', 'item.kit.count'));
  });

  it('三元三分支各自收集', () => {
    expect(compile('flag.a ? attr.b : flag.c').refs).toEqual(refsOf('flag.a', 'attr.b', 'flag.c'));
  });

  it('按首次出现顺序去重', () => {
    expect(compile('attr.hp + attr.hp * 2').refs).toEqual(refsOf('attr.hp'));
    expect(compile('skill.b.value + attr.a + skill.b.value').refs).toEqual(
      refsOf('skill.b.value', 'attr.a'),
    );
  });

  it('字面量与函数名不产生 refs', () => {
    expect(compile('1 + 2').refs).toEqual([]);
    expect(compile('"text"').refs).toEqual([]);
    expect(compile('null').refs).toEqual([]);
    expect(compile('min(1, 2)').refs).toEqual([]);
    expect(compile('loop()').refs).toEqual([]);
  });

  it('编译产物回传 source 与 ast', () => {
    const compiled = compile('attr.hp + 1');
    expect(compiled.source).toBe('attr.hp + 1');
    expect(compiled.ast.kind).toBe('binary');
  });
});

describe('compileExpr：静态校验——未知 root（编译期第 1 类）', () => {
  it.each([
    ['foo.bar', 'foo'],
    ['foo', 'foo'],
    ['this', 'this'],
    ['undefined.x', 'undefined'],
  ])('白名单外 root：%s', (source, root) => {
    const err = compileExpectError(source);
    expect(err.messageKey).toBe('error.expr.unknownRoot');
    expect(err.where['root']).toBe(root);
  });

  it('错误文案列出白名单全集', () => {
    const err = compileExpectError('foo.bar');
    expect(err.where['detail']).toContain('attr');
    expect(err.where['detail']).toContain('wallet');
  });
});

describe('compileExpr：静态校验——路径形态不符（已知 root，编译期第 1 类延伸）', () => {
  it.each([
    ['attr', 'attr 缺少属性名'],
    ['attr.hp.x', 'attr 为标量域'],
    ['item.gold', 'item 计数语法糖缺 count'],
    ['item.gold.total', 'item 第二段必须为 count'],
    ['time', 'time 缺字段'],
    ['time.year', 'time 字段白名单'],
    ['time.day.x', 'time 为叶节点'],
    ['meta', 'meta 缺字段'],
    ['meta.foo', 'meta 仅支持 points/perk'],
    ['meta.perk', 'meta.perk 缺 id'],
    ['meta.points.x', 'meta.points 为叶节点'],
    ['skill.s.bogus', 'skill 子字段白名单'],
    ['npc.raven', 'npc 缺字段'],
    ['npc.raven.flags', 'npc.flags 缺 flag 名'],
    ['npc.raven.favor.x', 'favor 为叶节点'],
    ['quest.q.bogus', 'quest 子字段白名单'],
    ['outfit.torso', 'outfit 缺 layer'],
    ['outfit.torso.cloth.x', 'outfit 为叶节点'],
    ['flag.a.b', 'flag 为叶节点'],
    ['body.head.x', 'body 为叶节点'],
    ['faction.mages.x', 'faction 为叶节点'],
    ['wallet.gold.x', 'wallet 为叶节点'],
    ['loop.x', 'loop 为标量域'],
  ])('形态不符：%s', (source) => {
    const err = compileExpectError(source);
    expect(err.messageKey).toBe('error.expr.badPath');
    expect(err.where['path']).toBe(source);
    expect(err.where['root']).toBe(source.split('.')[0]);
  });

  it('合法路径形态全部通过（覆盖白名单每域）', () => {
    const ok = [
      'attr.hp',
      'skill.stealth',
      'skill.stealth.value',
      'skill.stealth.exp',
      'flag.door_opened',
      'item.gold.count',
      'outfit.torso.cloth',
      'body.race',
      'npc.raven.favor',
      'npc.raven.stage',
      'npc.raven.met',
      'npc.raven.mood',
      'npc.raven.flags.mood',
      'faction.mages',
      'time.day',
      'time.weekday',
      'time.slot',
      'loop',
      'meta.points',
      'meta.perk.iron_will',
      'quest.main',
      'quest.main.state',
      'quest.main.stage',
      'wallet.gold',
    ];
    for (const source of ok) {
      expect(() => compile(source), source).not.toThrow();
    }
  });
});

describe('compileExpr：静态校验——未知函数（编译期第 2 类）', () => {
  it('注册表外的函数名报 EXPR_COMPILE', () => {
    const err = compileExpectError('nope(1)');
    expect(err.messageKey).toBe('error.expr.unknownFunction');
    expect(err.where['fn']).toBe('nope');
  });

  it('未知函数嵌套在实参中同样报错', () => {
    const err = compileExpectError('min(1, nope(2))');
    expect(err.messageKey).toBe('error.expr.unknownFunction');
    expect(err.where['fn']).toBe('nope');
  });
});

describe('compileExpr：静态校验——参数个数不符（编译期第 3 类）', () => {
  it.each([
    ['rand(1)', 'rand', '2', '1'],
    ['rand(1, 2, 3)', 'rand', '2', '3'],
    ['worn(a, b, c)', 'worn', '1..2', '3'],
    ['loop(1)', 'loop', '0', '1'],
    ['min(1)', 'min', '2', '1'],
  ])('%s', (source, fn, expected, actual) => {
    const err = compileExpectError(source);
    expect(err.messageKey).toBe('error.expr.arityMismatch');
    expect(err.where['fn']).toBe(fn);
    expect(err.where['expected']).toBe(expected);
    expect(err.where['actual']).toBe(actual);
  });

  it('可变 arity 边界值（worn 的 1 与 2 参）均合法', () => {
    expect(() => compile('worn(body.race)')).not.toThrow();
    expect(() => compile('worn(body.race, 1)')).not.toThrow();
  });
});

describe('compileExpr：静态校验——pure=false 误用（编译期第 4 类）', () => {
  it('requirePure 语境下随机函数报 EXPR_COMPILE', () => {
    const err = compileExpectError('rand(1, 2)', { requirePure: true });
    expect(err.messageKey).toBe('error.expr.impureFunction');
    expect(err.where['fn']).toBe('rand');
  });

  it('requirePure 语境下嵌套位置同样拦截（实参内）', () => {
    const err = compileExpectError('min(1, chance(0.5))', { requirePure: true });
    expect(err.messageKey).toBe('error.expr.impureFunction');
    expect(err.where['fn']).toBe('chance');
  });

  it('非 requirePure 语境允许 pure=false 函数', () => {
    expect(() => compile('rand(1, 2)')).not.toThrow();
    expect(() => compile('min(1, chance(0.5))')).not.toThrow();
  });

  it('requirePure 语境允许 pure=true 函数与纯路径', () => {
    expect(() =>
      compileExpr('min(loop(), attr.hp)', TEST_REGISTRY, { requirePure: true }),
    ).not.toThrow();
  });
});
