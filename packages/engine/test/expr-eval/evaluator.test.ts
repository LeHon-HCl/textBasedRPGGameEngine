import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '@game/shared';
import { compileExpr } from '../../src/expr-eval/compile.js';
import { evalExpr } from '../../src/expr-eval/eval.js';
import { def, makeCtx, makeScope } from './fixtures.js';
import type { EvalContext, ExprFunctionRegistry } from '@game/shared';

/**
 * 03 任务 B1：AST 解释器核心——算术 / 比较 / 逻辑（短路）/ 三元 / 一元 /
 * 优先级，以及严格类型化与除零语义（DD-01）。
 *
 * 断言要点：
 * - 逻辑运算符返回**操作数原值**（真值化仅发生在其条件位），短路侧不求值
 *   ——以注入 Rng 的状态为副作用见证（随机序列不被消耗，DD-09）；
 * - 算术 / 比较严格类型化：跨类型操作数 → EVAL_ERROR（无隐式转换）；
 * - `==` 不做跨类型转换（`1 == "1"` 为 false），null/undefined 互相相等；
 * - 除零 / 模零 → EVAL_ERROR（嵌套位置同样抛出）。
 */

/** 带副作用见证的夹具注册表：consume 消耗一次随机序列并返回 true */
const REGISTRY: ExprFunctionRegistry = new Map([
  def('consume', [0, 0], false, (_args, ctx) => {
    ctx.rng.next();
    return true;
  }),
  def('add', [2, 2], true, (args) => (args[0] as number) + (args[1] as number)),
  def('undef', [0, 0], true, () => undefined),
]);

function evalOk(source: string, ctx: EvalContext = makeCtx(makeScope(), createRng(42), REGISTRY)) {
  return evalExpr(compileExpr(source, REGISTRY), ctx);
}

function evalExpectError(
  source: string,
  ctx: EvalContext = makeCtx(makeScope(), createRng(42), REGISTRY),
): EngineError {
  let captured: unknown;
  try {
    evalOk(source, ctx);
  } catch (err) {
    captured = err;
  }
  expect(captured, `expected EVAL_ERROR for: ${source}`).toBeInstanceOf(EngineError);
  const err = captured as EngineError;
  expect(err.code).toBe('EVAL_ERROR');
  expect(err.where['expr']).toBe(source);
  return err;
}

describe('evalExpr：字面量原值返回（不做结果真值化）', () => {
  it.each([
    ['42', 42],
    ['1e3', 1000],
    ['"text"', 'text'],
    ['true', true],
    ['null', null],
  ])('%s', (source, expected) => {
    const value = evalOk(source);
    expect(value).toBe(expected);
  });

  it('evalExpr 返回原值：0 是数字而非 false', () => {
    const value = evalOk('0');
    expect(value).toBe(0);
    expect(typeof value).toBe('number');
  });
});

describe('evalExpr：算术运算（严格 number 类型化）', () => {
  it.each([
    ['1 + 2', 3],
    ['2.5 + 2.5', 5],
    ['10 - 4', 6],
    ['6 * 7', 42],
    ['10 / 4', 2.5],
    ['7 % 3', 1],
    ['-(3 + 4)', -7],
    ['0 / 5', 0],
    ['-2 * -3', 6],
  ])('%s === %s', (source, expected) => {
    expect(evalOk(source)).toBe(expected);
  });

  it('字符串拼接：仅 串+串 有定义', () => {
    expect(evalOk('"a" + "b"')).toBe('ab');
  });

  it.each(['"a" + 1', '1 + "a"', '"a" + null', 'true + 1', 'null + 1', 'null + null'])(
    '隐式转换禁止：%s → EVAL_ERROR',
    (source) => {
      const err = evalExpectError(source);
      expect(err.messageKey).toBe('error.eval.typeMismatch');
      expect(err.where['op']).toBe('+');
    },
  );

  it.each(['"a" - 1', '"a" * 2', '"a" / 2', '"a" % 2', 'true * 2', 'null - 1'])(
    '非 + 算术不接受非 number：%s',
    (source) => {
      expect(evalExpectError(source).messageKey).toBe('error.eval.typeMismatch');
    },
  );
});

describe('evalExpr：除零 / 模零严格报错（无静默默认值）', () => {
  it.each(['5 / 0', '5 % 0', '1 + 5 / 0', '(1 ? 2 : 3) / 0'])('%s → EVAL_ERROR', (source) => {
    const err = evalExpectError(source);
    expect(err.messageKey).toBe('error.eval.divisionByZero');
  });
});

describe('evalExpr：比较运算（number 与 string 各自封闭）', () => {
  it.each([
    ['3 < 5', true],
    ['3 <= 3', true],
    ['5 > 2', true],
    ['2 >= 3', false],
    ['"a" < "b"', true],
    ['"b" <= "a"', false],
    ['"abc" > "abd"', false],
  ])('%s === %s', (source, expected) => {
    expect(evalOk(source)).toBe(expected);
  });

  it.each(['"a" < 1', '1 <= "b"', 'true < false', 'null > 0', '"a" > null'])(
    '跨类型比较：%s → EVAL_ERROR',
    (source) => {
      const err = evalExpectError(source);
      expect(err.messageKey).toBe('error.eval.typeMismatch');
    },
  );
});

describe('evalExpr：相等运算（无隐式转换的 == / !=）', () => {
  it.each([
    ['1 == 1', true],
    ['1 == 2', false],
    ['"a" == "a"', true],
    ['1 == "1"', false],
    ['1 == true', false],
    ['0 == false', false],
    ['"" == 0', false],
    ['null == null', true],
    ['null == 1', false],
    ['undef() == null', true],
    ['undef() == 0', false],
    ['1 != 2', true],
    ['"a" != "b"', true],
    ['undef() != null', false],
  ])('%s === %s', (source, expected) => {
    expect(evalOk(source)).toBe(expected);
  });
});

describe('evalExpr：逻辑运算——短路且返回操作数原值', () => {
  it.each([
    ['false || 5', 5],
    ['0 || 5', 5],
    ['"" || 5', 5],
    ['null || "x"', 'x'],
    ['1 || 5', 1],
    ['true || 5', true],
    ['true && 2', 2],
    ['1 && 2', 2],
    ['0 && 2', 0],
    ['"" && 2', ''],
    ['null && 2', null],
    ['false && 2', false],
  ])('%s === %j', (source, expected) => {
    expect(evalOk(source)).toBe(expected);
  });

  it('短路侧不求值：以随机序列状态为副作用见证', () => {
    const rng = createRng(42);
    const ctx = makeCtx(makeScope(), rng, REGISTRY);
    const before = rng.getState();
    expect(evalOk('false && consume()', ctx)).toBe(false);
    expect(evalOk('true || consume()', ctx)).toBe(true);
    expect(rng.getState()).toBe(before);
  });

  it('非短路侧正常求值：随机序列恰好消耗一次', () => {
    const rng = createRng(42);
    const ctx = makeCtx(makeScope(), rng, REGISTRY);
    const before = rng.getState();
    expect(evalOk('true && consume()', ctx)).toBe(true);
    expect(evalOk('0 || consume()', ctx)).toBe(true);
    expect(rng.getState()).not.toBe(before);
  });
});

describe('evalExpr：一元运算', () => {
  it.each([
    ['!true', false],
    ['!false', true],
    ['!0', true],
    ['!""', true],
    ['!null', true],
    ['!"x"', false],
    ['!undef()', true],
    ['-5', -5],
    ['+5', 5],
    ['- -5', 5],
  ])('%s === %j', (source, expected) => {
    expect(evalOk(source)).toBe(expected);
  });

  it.each(['-"a"', '+"a"', '-null', '+true'])('一元 -/+ 严格 number：%s → EVAL_ERROR', (source) => {
    const err = evalExpectError(source);
    expect(err.messageKey).toBe('error.eval.typeMismatch');
  });
});

describe('evalExpr：三元条件（条件位真值化，仅求值被选中分支）', () => {
  it.each([
    ['true ? 1 : 2', 1],
    ['false ? 1 : 2', 2],
    ['0 ? 1 : 2', 2],
    ['"" ? 1 : 2', 2],
    ['null ? 1 : 2', 2],
    ['"x" ? 1 : 2', 1],
    ['undef() ? 1 : 2', 2],
    ['false ? 1 : false ? 2 : 3', 3],
    ['false ? 1 : true ? 2 : 3', 2],
  ])('%s === %j', (source, expected) => {
    expect(evalOk(source)).toBe(expected);
  });

  it('未选中分支不求值', () => {
    const rng = createRng(42);
    const ctx = makeCtx(makeScope(), rng, REGISTRY);
    const before = rng.getState();
    expect(evalOk('true ? 1 : consume()', ctx)).toBe(1);
    expect(evalOk('false ? consume() : 2', ctx)).toBe(2);
    expect(rng.getState()).toBe(before);
  });
});

describe('evalExpr：优先级在值语义下的表现', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['10 - 2 - 3', 5],
    ['2 * 3 % 4', 2],
    ['1 + 2 == 3', true],
    ['1 < 2 == true', true],
    ['true && false || true', true],
    ['!true == false', true],
    ['1 || 0 && 0', 1],
  ])('%s === %j', (source, expected) => {
    expect(evalOk(source)).toBe(expected);
  });
});

describe('evalExpr：路径解析基础流（白名单映射，详见 B2 逐域矩阵）', () => {
  it.each([
    // 封闭域：命中即返回值
    ['attr.hp', 30],
    ['skill.stealth', { value: 3, exp: 40 }],
    ['skill.stealth.value', 3],
    ['skill.stealth.exp', 40],
    ['body.race', 'human'],
    ['faction.thieves', -3],
    ['time.day', 5],
    ['time.weekday', 'sat'],
    ['time.slot', 'morning'],
    ['loop', 2],
    ['meta.points', 15],
    ['npc.raven.favor', 7],
    ['npc.raven.met', true],
    ['npc.raven.stage', 'warm'],
    ['npc.raven.flags.mood', 'calm'],
    ['npc.raven.mood', 'calm'], // 自定义 flag 简写
    ['quest.main', { state: 'active', stage: 's1', objectives: {}, startedDay: 1 }],
    ['quest.main.state', 'active'],
    ['quest.main.stage', 's1'],
    ['wallet.gems', 2],
    // 渐进域：缺席返回定义的缺席值
    ['flag.door_opened', true],
    ['flag.never_set', undefined], // 未设置 flag → undefined
    ['item.potion.count', 3],
    ['item.never_owned.count', 0], // 未持有物品 → 0
    ['outfit.torso.cloth', 'robe'],
    ['outfit.head.any', null], // 空层 → null
    ['meta.perk.iron_will', true],
    ['meta.perk.not_purchased', false], // 未购买 perk → false
    ['npc.sela.stage', undefined], // 未达阶段 → undefined（schema 可选）
  ])('%s', (source, expected) => {
    expect(evalOk(source)).toStrictEqual(expected);
  });

  it('封闭域缺 key → EVAL_ERROR missingKey（无静默默认值）', () => {
    const err = evalExpectError('attr.typo_key');
    expect(err.messageKey).toBe('error.eval.missingKey');
    expect(err.where['path']).toBe('attr.typo_key');
    expect(err.where['key']).toBe('typo_key');
  });
});

describe('evalExpr：函数调用（注册表查找 + 实参先序求值）', () => {
  it('调用夹具函数并取得返回值', () => {
    expect(evalOk('add(2, 3)')).toBe(5);
    expect(evalOk('add(1 + 1, 2 * 2)')).toBe(6);
    expect(evalOk('add(add(1, 1), 2)')).toBe(4);
  });

  it('实参按先序求值（随机序列消耗顺序确定）', () => {
    const rng = createRng(42);
    const ctx = makeCtx(makeScope(), rng, REGISTRY);
    const first = rng.getState();
    evalOk('add(consume(), consume())', ctx);
    const second = rng.getState();
    expect(second).not.toBe(first);
  });

  it('求值期注册表缺失函数 → INTERNAL（编译期已校验，属调用方契约违规）', () => {
    const compiled = compileExpr('add(1, 1)', REGISTRY);
    const ctx = makeCtx(makeScope(), createRng(42), new Map());
    let captured: unknown;
    try {
      evalExpr(compiled, ctx);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(EngineError);
    expect((captured as EngineError).code).toBe('INTERNAL');
    expect((captured as EngineError).where['fn']).toBe('add');
  });
});
