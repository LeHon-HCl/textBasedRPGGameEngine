import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '@game/shared';
import type { ExprFunctionRegistry } from '@game/shared';
import { compileExpr } from '../../src/expr-eval/compile.js';
import { evalExpr } from '../../src/expr-eval/eval.js';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/builtins.js';
import { makeCtx, makeScope } from './fixtures.js';

/**
 * 03 任务 B3：内置 20 函数注册表（设计 §2.3 冻结清单，DD-01）。
 *
 * - 注册表契约：恰好 20 个函数，逐个断言 name / arity / pure 与 §2.3 表格
 *   一致（随机 3 + 物品/服装 3 + 状态查询 5 + 进度查询 6 + 数值 3）；
 *   pure=false 仅随机类（缓存敏感位置由 A3 的 requirePure 拦截）；
 * - 闭合性：每个内置函数按其合法 arity 均能通过编译校验；
 * - 行为烟测：查询类读取夹具作用域的映射正确性（逐函数完备用例见 C2）。
 */

const REGISTRY: ExprFunctionRegistry = createBuiltinFunctionRegistry();

/** §2.3 内置函数表的数据侧镜像（与设计表格逐行对应） */
const SPEC: readonly { name: string; arity: [number, number]; pure: boolean }[] = [
  { name: 'rand', arity: [2, 2], pure: false },
  { name: 'randInt', arity: [2, 2], pure: false },
  { name: 'chance', arity: [1, 1], pure: false },
  { name: 'has', arity: [1, 1], pure: true },
  { name: 'count', arity: [1, 1], pure: true },
  { name: 'worn', arity: [1, 2], pure: true },
  { name: 'flag', arity: [1, 1], pure: true },
  { name: 'favor', arity: [1, 1], pure: true },
  { name: 'rep', arity: [1, 1], pure: true },
  { name: 'met', arity: [1, 1], pure: true },
  { name: 'body', arity: [1, 1], pure: true },
  { name: 'quest', arity: [1, 1], pure: true },
  { name: 'loop', arity: [0, 0], pure: true },
  { name: 'day', arity: [0, 0], pure: true },
  { name: 'weekday', arity: [0, 0], pure: true },
  { name: 'slot', arity: [0, 0], pure: true },
  { name: 'points', arity: [0, 0], pure: true },
  { name: 'clamp', arity: [3, 3], pure: true },
  { name: 'min', arity: [2, 2], pure: true },
  { name: 'max', arity: [2, 2], pure: true },
];

/** 每个内置函数的一条合法调用（用于闭合性编译校验） */
const VALID_CALLS: readonly string[] = [
  'rand(1, 2)',
  'randInt(1, 6)',
  'chance(0.5)',
  'has("potion")',
  'count("potion")',
  'worn("torso", 1)',
  'flag("door_opened")',
  'favor("raven")',
  'rep("mages")',
  'met("raven")',
  'body("race")',
  'quest("main")',
  'loop()',
  'day()',
  'weekday()',
  'slot()',
  'points()',
  'clamp(5, 0, 3)',
  'min(1, 2)',
  'max(1, 2)',
];

describe('B3：注册表契约（§2.3 表格逐行）', () => {
  it('恰好 20 个函数，无多余/缺失', () => {
    expect([...REGISTRY.keys()].sort()).toEqual(SPEC.map((f) => f.name).sort());
    expect(REGISTRY.size).toBe(20);
  });

  it.each(SPEC.map((f) => [f.name, f.arity, f.pure]))(
    '%s 的 arity 与 pure 标记',
    (name, arity, pure) => {
      const def = REGISTRY.get(name as string);
      expect(def).toBeDefined();
      expect(def?.arity).toEqual(arity);
      expect(def?.pure).toBe(pure);
      expect(def?.fn).toBeTypeOf('function');
      expect(def?.name).toBe(name);
    },
  );

  it('pure=false 仅随机 3 函数（缓存敏感位置拦截的数据基础）', () => {
    const impure = SPEC.filter((f) => !f.pure)
      .map((f) => f.name)
      .sort();
    expect(impure).toEqual(['chance', 'rand', 'randInt']);
  });

  it('闭合性：每个内置函数的合法调用均通过编译校验', () => {
    for (const source of VALID_CALLS) {
      expect(() => compileExpr(source, REGISTRY), source).not.toThrow();
    }
  });

  it('注册表为稳定的只读视图（重复调用返回同一实例）', () => {
    expect(createBuiltinFunctionRegistry()).toBe(REGISTRY);
    expect(REGISTRY.get('rand')).toBe(REGISTRY.get('rand'));
  });
});

describe('B3：行为烟测（查询类读取作用域；逐函数完备用例见 C2）', () => {
  function evalOk(source: string, seed = 42): unknown {
    return evalExpr(compileExpr(source, REGISTRY), makeCtx(makeScope(), createRng(seed), REGISTRY));
  }

  function evalExpectError(source: string): EngineError {
    let captured: unknown;
    try {
      evalOk(source);
    } catch (err) {
      captured = err;
    }
    expect(captured, `expected EVAL_ERROR for: ${source}`).toBeInstanceOf(EngineError);
    return captured as EngineError;
  }

  it('物品/服装查询读取 bagCounts 与 outfit', () => {
    expect(evalOk('has("potion")')).toBe(true);
    expect(evalOk('has("never_item")')).toBe(false);
    expect(evalOk('count("potion")')).toBe(3);
    expect(evalOk('worn("torso", 1)')).toBe('leather_armor');
    // 省略 layer → 最高数值层
    expect(evalOk('worn("torso")')).toBe('cloak');
  });

  it('状态/进度查询读取对应切片', () => {
    expect(evalOk('flag("chapter")')).toBe(2);
    expect(evalOk('favor("raven")')).toBe(7);
    expect(evalOk('rep("thieves")')).toBe(-3);
    expect(evalOk('met("sela")')).toBe(false);
    expect(evalOk('body("race")')).toBe('human');
    expect(evalOk('quest("main")')).toBe('active');
    expect(evalOk('quest("ghost")')).toBeUndefined();
    expect(evalOk('loop()')).toBe(2);
    expect(evalOk('day()')).toBe(5);
    expect(evalOk('weekday()')).toBe('sat');
    expect(evalOk('slot()')).toBe('morning');
    expect(evalOk('points()')).toBe(15);
  });

  it('数值函数边界', () => {
    expect(evalOk('clamp(5, 0, 3)')).toBe(3);
    expect(evalOk('clamp(-1, 0, 3)')).toBe(0);
    expect(evalOk('min(3, 1)')).toBe(1);
    expect(evalOk('max(3, 1)')).toBe(3);
  });

  it('封闭域查询函数缺 key 严格报错', () => {
    const err = evalExpectError('rep("typo_faction")');
    expect(err.code).toBe('EVAL_ERROR');
    expect(err.messageKey).toBe('error.eval.missingKey');
    expect(err.where['fn']).toBe('rep');
    expect(err.where['key']).toBe('typo_faction');
  });
});
