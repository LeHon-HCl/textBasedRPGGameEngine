import { describe, expect, it } from 'vitest';
import type { CompiledExpr, VarRef } from '@game/shared';
import { compileExpr } from '../../src/expr-eval/compile.js';

/**
 * 03 任务 A2：compileExpr 的 refs 抽取。
 *
 * 断言要点（设计 §2.3 / §3.2 / §4.4）：
 * - VarRef.root = 路径首段，VarRef.path = 完整点路径（含 root）；
 * - 路径嵌套在函数实参、一元/二元操作数、三元分支内同样收集（先序遍历）；
 * - 按首次出现顺序去重（§4.4 脏标记索引键的唯一性）；
 * - 字面量与函数名本身不产生 refs；source / ast 随编译产物回传。
 *
 * 注：本文件不经过静态校验（03 任务 A3 的职责），路径可使用任意标识符形态。
 */

function compile(source: string): CompiledExpr {
  return compileExpr(source);
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
    expect(compile('rand(attr.min, attr.max)').refs).toEqual(refsOf('attr.min', 'attr.max'));
    expect(compile('has(item.key.count)').refs).toEqual(refsOf('item.key.count'));
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
    expect(compile('rand(1, 2)').refs).toEqual([]);
    expect(compile('loop()').refs).toEqual([]);
  });

  it('编译产物回传 source 与 ast', () => {
    const compiled = compile('attr.hp + 1');
    expect(compiled.source).toBe('attr.hp + 1');
    expect(compiled.ast.kind).toBe('binary');
  });
});
