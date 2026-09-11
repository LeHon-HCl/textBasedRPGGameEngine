import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import { BASE_VERSIONS, makeCtx, makeBuiltinRuntime } from './fixtures.js';

/** 以 bootstrap 注入初始钱包（money 用例） */
function makeMoneyRuntime() {
  return makeBuiltinRuntime({
    bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 30, con: 2 }, wallet: { gold: 10 } },
  });
}

/** 断言 EFFECT_FAILED 且 cause.where 携带指令归因（op） */
function expectEffectFailed(run: () => unknown, op: string): EngineError {
  try {
    run();
    throw new Error('应抛出 EFFECT_FAILED');
  } catch (err) {
    const engineErr = err as EngineError;
    expect(engineErr.code).toBe('EFFECT_FAILED');
    const cause = engineErr.cause as EngineError;
    expect(cause.where.op).toBe(op);
    return cause;
  }
}

/** 沿 cause 链读取 where 字段（指令归因层或求值器层） */
function whereInChain(err: EngineError, key: string): string | undefined {
  let current: Error | undefined = err;
  for (let depth = 0; depth < 6 && current !== undefined; depth += 1) {
    if (current instanceof EngineError) {
      const value = current.where[key];
      if (value !== undefined) return value;
    }
    current = current.cause instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

describe('05-B1 set：变量/属性写入（表达式值）', () => {
  it('数值字面量写属性，stat_changed 事件由补丁派生', () => {
    const { rt } = makeBuiltinRuntime();
    const outcome = rt.exec([{ set: { key: 'attr.hp', value: 12 } }], makeCtx());
    expect(rt.state.player.attrs.hp).toBe(12);
    expect(outcome.events).toEqual([
      { type: 'stat_changed', attr: 'hp', from: 30, to: 12, delta: -18 },
    ]);
  });

  it('表达式值：attr.hp 与 con 联合运算后写入', () => {
    const { rt } = makeBuiltinRuntime();
    rt.exec([{ set: { key: 'attr.hp', value: 'attr.hp - attr.con * 3' } }], makeCtx());
    expect(rt.state.player.attrs.hp).toBe(24);
  });

  it('flag 域：字符串字面量经宽松语义落为字面值；表达式求值后写入数值', () => {
    const { rt } = makeBuiltinRuntime();
    rt.exec(
      [
        { set: { key: 'flag.mood', value: 'tall' } },
        { set: { key: 'flag.hp_seen', value: 'attr.hp' } },
        { set: { key: 'flag.str_lit', value: '"lit"' } },
      ],
      makeCtx(),
    );
    expect(rt.state.world.flags['mood']).toBe('tall');
    expect(rt.state.world.flags['hp_seen']).toBe(30);
    expect(rt.state.world.flags['str_lit']).toBe('lit');
  });

  it('counter 域写入数值（FR-GAL-04 计数器）', () => {
    const { rt } = makeBuiltinRuntime();
    rt.exec([{ set: { key: 'counter.chests', value: 3 } }], makeCtx());
    expect(rt.state.world.counters['chests']).toBe(3);
  });

  it('未知域 / 空名称 key：EFFECT_FAILED', () => {
    const { rt } = makeBuiltinRuntime();
    expectEffectFailed(
      () => rt.exec([{ set: { key: 'world.rent_due', value: 5 } }], makeCtx()),
      'set',
    );
    expectEffectFailed(() => rt.exec([{ set: { key: 'attr.', value: 5 } }], makeCtx()), 'set');
    expectEffectFailed(() => rt.exec([{ set: { key: 'justname', value: 5 } }], makeCtx()), 'set');
    expect(rt.state.player.attrs.hp).toBe(30);
  });

  it('数值域写入非数值（宽松字面量回退后）:EFFECT_FAILED，状态不变', () => {
    const { rt } = makeBuiltinRuntime();
    const cause = expectEffectFailed(
      () => rt.exec([{ set: { key: 'attr.hp', value: 'strong' } }], makeCtx()),
      'set',
    );
    expect(cause.where.sourceExpr).toBe('strong');
    expect(rt.state.player.attrs.hp).toBe(30);
  });

  it('表达式运行期错误不回退字面量（严格语义），EFFECT_FAILED 附 sourceExpr', () => {
    const { rt } = makeBuiltinRuntime();
    try {
      rt.exec([{ set: { key: 'flag.x', value: 'attr.missing + 1' } }], makeCtx());
      expect.unreachable('求值期错误不应回退字面量');
    } catch (err) {
      const engineErr = err as EngineError;
      expect(engineErr.code).toBe('EFFECT_FAILED');
      // sourceExpr 由运行时从 cause 链提升到外层 where（§3.3 失败定位）
      expect(engineErr.where.sourceExpr).toBe('attr.missing + 1');
      expect(engineErr.where.instruction).toBe('0');
      // cause 为指令归因失败（op），原 EVAL_ERROR 挂在其 cause
      expect(whereInChain(engineErr, 'op')).toBe('set');
    }
    expect(rt.state.world.flags['x']).toBeUndefined();
  });
});

describe('05-B1 add：数值累加（封闭域严格 / 渐进域 0 起算）', () => {
  it('attr 累加：表达式金额、前序指令变更可见', () => {
    const { rt } = makeBuiltinRuntime();
    rt.exec(
      [{ set: { key: 'attr.hp', value: 10 } }, { add: { key: 'attr.hp', amount: 'attr.con + 1' } }],
      makeCtx(),
    );
    expect(rt.state.player.attrs.hp).toBe(13);
  });

  it('counter / flag 渐进域：缺席按 0 起算', () => {
    const { rt } = makeBuiltinRuntime();
    rt.exec(
      [
        { add: { key: 'counter.visits', amount: 2 } },
        { add: { key: 'counter.visits', amount: 3 } },
        { add: { key: 'flag.score', amount: -1.5 } },
      ],
      makeCtx(),
    );
    expect(rt.state.world.counters['visits']).toBe(5);
    expect(rt.state.world.flags['score']).toBe(-1.5);
  });

  it('attr 封闭域缺 key：EFFECT_FAILED；flag 非数值累加：EFFECT_FAILED', () => {
    const { rt } = makeBuiltinRuntime();
    expectEffectFailed(() => rt.exec([{ add: { key: 'attr.mana', amount: 1 } }], makeCtx()), 'add');
    rt.exec([{ set: { key: 'flag.mood', value: 'tall' } }], makeCtx());
    expectEffectFailed(() => rt.exec([{ add: { key: 'flag.mood', amount: 1 } }], makeCtx()), 'add');
  });

  it('表达式求值出非有限数值：EFFECT_FAILED 附 sourceExpr（schema 层拒绝字面量 Infinity）', () => {
    const { rt } = makeBuiltinRuntime();
    const cause = expectEffectFailed(
      () => rt.exec([{ add: { key: 'attr.hp', amount: '1e308 * 10' } }], makeCtx()),
      'add',
    );
    expect(cause.where.sourceExpr).toBe('1e308 * 10');
    expect(rt.state.player.attrs.hp).toBe(30);
  });
});

describe('05-B1 flag：置位（缺省 true）', () => {
  it('缺省置 true，显式 value 覆盖，可重复置位', () => {
    const { rt } = makeBuiltinRuntime();
    rt.exec(
      [
        { flag: { name: 'door_opened' } },
        { flag: { name: 'door_opened', value: false } },
        { flag: { name: 'lit', value: false } },
      ],
      makeCtx(),
    );
    expect(rt.state.world.flags['door_opened']).toBe(false);
    expect(rt.state.world.flags['lit']).toBe(false);
  });

  it('flag 域 touch 声明为 world.flags（实际补丁写域一致）', () => {
    const { rt } = makeBuiltinRuntime();
    const outcome = rt.exec([{ flag: { name: 'x' } }], makeCtx());
    expect(outcome.patches.map((p) => p.path)).toEqual([['world', 'flags', 'x']]);
  });
});

describe('05-B1 money：多货币增减与负值校验（FR-ECON-01）', () => {
  it('多货币批量增减；新货币自 0 起算；表达式金额', () => {
    const { rt } = makeMoneyRuntime();
    rt.exec(
      [{ money: { gold: '5 * 2', silver: 30 } }, { money: { gold: -3 } }, { money: { gems: 1 } }],
      makeCtx(),
    );
    expect(rt.state.player.wallet).toEqual({ gold: 17, silver: 30, gems: 1 });
  });

  it('余额恰好归零允许，低于 0 报 EFFECT_FAILED 且整批回滚', () => {
    const { rt } = makeMoneyRuntime();
    rt.exec([{ money: { gold: -10 } }], makeCtx());
    expect(rt.state.player.wallet['gold']).toBe(0);
    expectEffectFailed(() => rt.exec([{ money: { gold: -1 } }], makeCtx()), 'money');
    expect(rt.state.player.wallet['gold']).toBe(0);
  });

  it('批内后续指令失败时前面货币变更一并回滚（事务原子性）', () => {
    const { rt } = makeMoneyRuntime();
    expectEffectFailed(
      () =>
        rt.exec(
          [{ money: { gold: 5 } }, { money: { silver: 2 } }, { money: { gold: -100 } }],
          makeCtx(),
        ),
      'money',
    );
    expect(rt.state.player.wallet).toEqual({ gold: 10 });
  });

  it('表达式金额求值错误：EFFECT_FAILED 附 sourceExpr 与货币定位（param = currency）', () => {
    const { rt } = makeMoneyRuntime();
    const cause = expectEffectFailed(
      () => rt.exec([{ money: { gold: 'attr.nothing' } }], makeCtx()),
      'money',
    );
    expect(cause.where.sourceExpr).toBe('attr.nothing');
    expect(cause.where.param).toBe('gold');
    expect(cause.message).toContain('attr.nothing');
  });
});
