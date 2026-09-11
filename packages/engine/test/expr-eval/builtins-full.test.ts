import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '@game/shared';
import type { EvalContext, ExprFunctionRegistry, ExprScope } from '@game/shared';
import { compileExpr } from '../../src/expr-eval/compile.js';
import { evalExpr } from '../../src/expr-eval/eval.js';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/builtins.js';
import { makeCtx, makeScope } from './fixtures.js';

/**
 * 03 任务 C2：内置 20 函数逐个用例（设计 §2.3 清单，DD-01）。
 *
 * - 随机 3 函数用固定种子 Rng 断言**精确序列**：mulberry32(42) 的前几个
 *   抽取值（0.6011037519201636 / 0.44829055899754167 / …）已由 shared 的
 *   rng.test 钉死，本文件据此推出每个随机函数的确切返回值；
 * - 随机函数的消耗计数：每次调用恰好消耗一次抽取（与主序列状态对账）；
 * - 查询/数值函数逐个断言正常值、边界与错误（messageKey + where）。
 */

const REGISTRY: ExprFunctionRegistry = createBuiltinFunctionRegistry();

/** mulberry32(42) 前 5 次抽取值（与 shared rng.test 钉死的参考序列一致） */
const DRAWS = [0.6011037519201636, 0.44829055899754167, 0.8524657934904099] as const;

function ctxWith(scope: ExprScope = makeScope(), rng = createRng(42)): EvalContext {
  return makeCtx(scope, rng, REGISTRY);
}

function evalOk(source: string, ctx: EvalContext = ctxWith()): unknown {
  return evalExpr(compileExpr(source, REGISTRY), ctx);
}

function evalExpectError(source: string, ctx: EvalContext = ctxWith()): EngineError {
  let captured: unknown;
  try {
    evalOk(source, ctx);
  } catch (err) {
    captured = err;
  }
  expect(captured, `expected EVAL_ERROR for: ${source}`).toBeInstanceOf(EngineError);
  return captured as EngineError;
}

describe('C2：随机函数（固定种子精确序列，DD-09 可回放）', () => {
  it('rand(min,max)：min + 第 n 次抽取 × (max-min)，浮点逐位确定', () => {
    const rng = createRng(42);
    const ctx = ctxWith(makeScope(), rng);
    expect(evalOk('rand(2, 5)', ctx)).toBe(2 + DRAWS[0] * 3);
    expect(evalOk('rand(0, 1)', ctx)).toBe(DRAWS[1]);
    // min == max 恒返回该值
    expect(evalOk('rand(10, 10)', ctx)).toBe(10);
  });

  it('randInt(min,max)：闭区间整数，序列确定', () => {
    const rng = createRng(42);
    const ctx = ctxWith(makeScope(), rng);
    // 1 + floor(0.6011037519201636 × 6) = 4；1 + floor(0.44829055899754167 × 6) = 3
    expect(evalOk('randInt(1, 6)', ctx)).toBe(4);
    expect(evalOk('randInt(1, 6)', ctx)).toBe(3);
    expect(evalOk('randInt(-2, 2)', ctx)).toBe(-2 + Math.floor(DRAWS[2] * 5));
    expect(evalOk('randInt(3, 3)', ctx)).toBe(3);
  });

  it('chance(p)：p=0 恒 false、p=1 恒 true、边界内按抽取值比较', () => {
    const rng = createRng(42);
    const ctx = ctxWith(makeScope(), rng);
    // 顺序消耗抽取：draw1=0.6011、draw2=0.4483、draw3=0.8525、draw4=0.6697
    expect(evalOk('chance(0)', ctx)).toBe(false);
    expect(evalOk('chance(1)', ctx)).toBe(true);
    // 抽取 0.8525 ≥ 0.7
    expect(evalOk('chance(0.7)', ctx)).toBe(false);
    // 抽取 0.6697 ≥ 0.4
    expect(evalOk('chance(0.4)', ctx)).toBe(false);
  });

  it('每次随机调用恰好消耗一次抽取（与主序列状态对账）', () => {
    const driven = createRng(42);
    const reference = createRng(42);
    const ctx = ctxWith(makeScope(), driven);
    evalOk('randInt(1, 6)', ctx);
    reference.next();
    evalOk('rand(0, 1)', ctx);
    reference.next();
    evalOk('chance(0.5)', ctx);
    reference.next();
    expect(driven.getState()).toBe(reference.getState());
  });

  it('随机结果在声明区间内（性质断言，补充精确序列）', () => {
    for (let i = 0; i < 50; i++) {
      const value = evalOk('rand(-3, 7)', ctxWith(makeScope(), createRng(1000 + i))) as number;
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThan(7);
      const int = evalOk('randInt(1, 6)', ctxWith(makeScope(), createRng(2000 + i))) as number;
      expect(Number.isInteger(int)).toBe(true);
      expect(int).toBeGreaterThanOrEqual(1);
      expect(int).toBeLessThanOrEqual(6);
    }
  });

  it('随机函数参数与边界错误（invalidArgument / invalidRange / invalidProbability）', () => {
    expect(evalExpectError('rand("a", 2)').messageKey).toBe('error.eval.invalidArgument');
    expect(evalExpectError('rand(1, null)').messageKey).toBe('error.eval.invalidArgument');
    expect(evalExpectError('rand(5, 1)').messageKey).toBe('error.eval.invalidRange');
    expect(evalExpectError('randInt(1.5, 3)').messageKey).toBe('error.eval.invalidArgument');
    expect(evalExpectError('randInt(3, 1)').messageKey).toBe('error.eval.invalidRange');
    expect(evalExpectError('chance(-0.1)').messageKey).toBe('error.eval.invalidProbability');
    expect(evalExpectError('chance(1.5)').messageKey).toBe('error.eval.invalidProbability');
    expect(evalExpectError('chance("0.5")').messageKey).toBe('error.eval.invalidArgument');
  });
});

describe('C2：物品/服装查询（has / count / worn）', () => {
  it('has：计数 > 0 判定，未持有 → false', () => {
    expect(evalOk('has("potion")')).toBe(true);
    // 计数为 0
    expect(evalOk('has("herb")')).toBe(false);
    // 从未入包
    expect(evalOk('has("never_item")')).toBe(false);
  });

  it('count：计数读取，未持有 → 0', () => {
    expect(evalOk('count("potion")')).toBe(3);
    expect(evalOk('count("never_item")')).toBe(0);
  });

  it('worn(part, layer)：数值层与命名层键，空层 → null', () => {
    expect(evalOk('worn("torso", 1)')).toBe('leather_armor');
    expect(evalOk('worn("torso", 2)')).toBe('cloak');
    // 数值层未穿戴
    expect(evalOk('worn("torso", 3)')).toBeNull();
    expect(evalOk('worn("torso", "cloth")')).toBe('robe');
    // 空 part
    expect(evalOk('worn("head", 1)')).toBeNull();
    // 不存在 part（渐进域）
    expect(evalOk('worn("ghost_part", 1)')).toBeNull();
  });

  it('worn(part)：省略 layer → 最高数值层；仅命名层 → null', () => {
    expect(evalOk('worn("torso")')).toBe('cloak');
    const namedOnly = makeScope({
      player: {
        ...makeScope().player,
        outfit: { belt: { cloth: 'rope' }, mixed: { '2': 'b', '1': 'a', '3': 'c' } },
      },
    });
    // 无数值层
    expect(evalOk('worn("belt")', ctxWith(namedOnly))).toBeNull();
    // 最高数值层 '3'
    expect(evalOk('worn("mixed")', ctxWith(namedOnly))).toBe('c');
  });

  it('参数类型错误', () => {
    expect(evalExpectError('has(1)').where['fn']).toBe('has');
    expect(evalExpectError('count(null)').messageKey).toBe('error.eval.invalidArgument');
    expect(evalExpectError('worn(1)').messageKey).toBe('error.eval.invalidArgument');
    expect(evalExpectError('worn("torso", true)').messageKey).toBe('error.eval.invalidArgument');
  });
});

describe('C2：状态查询（flag / favor / rep / met / body）', () => {
  it('flag：boolean | number | string 值域，未设置 → undefined', () => {
    expect(evalOk('flag("door_opened")')).toBe(true);
    expect(evalOk('flag("chapter")')).toBe(2);
    expect(evalOk('flag("title")')).toBe('novice');
    expect(evalOk('flag("never_set")')).toBeUndefined();
    expect(evalExpectError('flag(1)').messageKey).toBe('error.eval.invalidArgument');
  });

  it('favor：已知 NPC 读取好感，未登场 NPC → 0', () => {
    expect(evalOk('favor("raven")')).toBe(7);
    expect(evalOk('favor("sela")')).toBe(0);
    // 未登场视为 0（渐进域）
    expect(evalOk('favor("ghost")')).toBe(0);
    expect(evalExpectError('favor(7)').messageKey).toBe('error.eval.invalidArgument');
  });

  it('rep：封闭域严格，未知阵营 → missingKey', () => {
    expect(evalOk('rep("mages")')).toBe(12);
    expect(evalOk('rep("thieves")')).toBe(-3);
    const err = evalExpectError('rep("typo_faction")');
    expect(err.messageKey).toBe('error.eval.missingKey');
    expect(err.where['fn']).toBe('rep');
  });

  it('met：已遇/未遇/未登场 → boolean', () => {
    expect(evalOk('met("raven")')).toBe(true);
    expect(evalOk('met("sela")')).toBe(false);
    expect(evalOk('met("ghost")')).toBe(false);
  });

  it('body：封闭域严格，未知部位 → missingKey', () => {
    expect(evalOk('body("race")')).toBe('human');
    expect(evalOk('body("build")')).toBe('slim');
    const err = evalExpectError('body("typo_part")');
    expect(err.messageKey).toBe('error.eval.missingKey');
    expect(err.where['key']).toBe('typo_part');
  });
});

describe('C2：进度查询（quest / loop / day / weekday / slot / points）', () => {
  it('quest：开始的任务返回 state 字符串，未开始 → undefined', () => {
    expect(evalOk('quest("main")')).toBe('active');
    expect(evalOk('quest("side_fishing")')).toBe('done');
    expect(evalOk('quest("ghost")')).toBeUndefined();
  });

  it('零参进度函数读取作用域对应切片', () => {
    expect(evalOk('loop()')).toBe(2);
    expect(evalOk('day()')).toBe(5);
    expect(evalOk('weekday()')).toBe('sat');
    expect(evalOk('slot()')).toBe('morning');
    expect(evalOk('points()')).toBe(15);
  });

  it('随作用域投影变化（视图数据源正确性）', () => {
    const scope = makeScope({
      loop: 7,
      world: { flags: {}, time: { day: 41, weekday: 'mon', slot: 'night' } },
      meta: { points: 0, purchasedPerks: [] },
    });
    expect(evalOk('loop()', ctxWith(scope))).toBe(7);
    expect(evalOk('day()', ctxWith(scope))).toBe(41);
    expect(evalOk('weekday()', ctxWith(scope))).toBe('mon');
    expect(evalOk('slot()', ctxWith(scope))).toBe('night');
    // 0 是合法积分数
    expect(evalOk('points()', ctxWith(scope))).toBe(0);
  });
});

describe('C2：数值函数（clamp / min / max）', () => {
  it('clamp：区间收敛与恒等', () => {
    expect(evalOk('clamp(5, 0, 3)')).toBe(3);
    expect(evalOk('clamp(-1, 0, 3)')).toBe(0);
    expect(evalOk('clamp(2, 0, 3)')).toBe(2);
    // min == max
    expect(evalOk('clamp(2, 2, 2)')).toBe(2);
    expect(evalOk('clamp(0.5, 0, 1)')).toBe(0.5);
  });

  it('clamp 区间违规 → invalidRange', () => {
    const err = evalExpectError('clamp(1, 3, 0)');
    expect(err.messageKey).toBe('error.eval.invalidRange');
    expect(err.where['fn']).toBe('clamp');
  });

  it('min / max：含负数与相等边界', () => {
    expect(evalOk('min(3, 1)')).toBe(1);
    expect(evalOk('min(-1, -2)')).toBe(-2);
    expect(evalOk('min(2, 2)')).toBe(2);
    expect(evalOk('max(3, 1)')).toBe(3);
    expect(evalOk('max(-1, -2)')).toBe(-1);
    expect(evalOk('max(2, 2)')).toBe(2);
  });

  it('参数个数由编译期拦截；类型不符运行期报 invalidArgument', () => {
    expect(() => compileExpr('min(1)', REGISTRY)).toThrow();
    expect(evalExpectError('min(1, "a")').messageKey).toBe('error.eval.invalidArgument');
    expect(evalExpectError('max("a", "b")').messageKey).toBe('error.eval.invalidArgument');
  });
});

describe('C2：函数在条件语境的端到端组合', () => {
  it('随机函数进入顶层条件（chance 恒真形态）', () => {
    const ctx = ctxWith();
    expect(evalExpr(compileExpr('chance(1) ? "hit" : "miss"', REGISTRY), ctx)).toBe('hit');
  });

  it('查询函数组合为复合条件', () => {
    expect(
      evalOk('has("key") && met("raven") && rep("mages") >= 10 && body("race") == "human"'),
    ).toBe(true);
    expect(evalOk('quest("main") == "active" && day() >= 5 && slot() == "morning"')).toBe(true);
    expect(evalOk('count("potion") > 0 && worn("torso", 1) == "leather_armor"')).toBe(true);
  });
});
