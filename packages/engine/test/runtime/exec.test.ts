import { describe, expect, it } from 'vitest';
import { EngineError, createRng } from '@game/shared';
import type { EffectData, Rng } from '@game/shared';
import { newGameState } from '../../src/state/new-game.js';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import type {
  EffectContext,
  EffectExecutor,
  ExecContext,
  ExecOutcome,
} from '../../src/runtime/exec-context.js';
import type { JumpTarget } from '../../src/runtime/exec-context.js';
import {
  BASE_VERSIONS,
  MAX_HP_ATTR_DEFS,
  compile,
  makeCtx,
  makeRuntime,
  stubExecutor,
} from './fixtures.js';

describe('04-B1 GameRuntime.exec：成功事务与 ExecOutcome 装配', () => {
  it('指令依次执行，产出 immer 补丁；提交新状态而原状态对象不变', () => {
    const rt = makeRuntime();
    const before = rt.state;
    const outcome = rt.exec(
      [{ set: { key: 'attr.hp', value: 5 } }, { flag: { name: 'door_opened', value: true } }],
      makeCtx(),
    );
    expect(rt.state).not.toBe(before);
    expect(rt.state.player.attrs.hp).toBe(5);
    expect(rt.state.world.flags.door_opened).toBe(true);
    expect(before.player.attrs.hp).toBe(30);
    expect(outcome.patches.map((p) => p.path)).toEqual([
      ['player', 'attrs', 'hp'],
      ['world', 'flags', 'door_opened'],
    ]);
    expect(outcome.jumps).toEqual([]);
    expect(outcome.events).toEqual([
      { type: 'stat_changed', attr: 'hp', from: 30, to: 5, delta: -25 },
    ]);
  });

  it('空效果批：状态原对象不变、产出为空', () => {
    const rt = makeRuntime();
    const before = rt.state;
    const outcome = rt.exec([], makeCtx());
    expect(rt.state).toBe(before);
    expect(outcome).toEqual({ jumps: [], events: [], patches: [] });
  });

  it('跳转类指令只产 jumps 不改状态（§3.3 状态层/流程层分界）', () => {
    const rt = makeRuntime();
    const before = rt.state;
    const outcome = rt.exec([{ goto: 'scene_cellar' }], makeCtx());
    expect(outcome.jumps).toEqual<JumpTarget[]>([{ type: 'scene', scene: 'scene_cellar' }]);
    expect(outcome.patches).toEqual([]);
    expect(rt.state).toBe(before);
  });

  it('ending 跳转同样只产 jumps', () => {
    const rt = makeRuntime();
    const outcome = rt.exec([{ ending: 'ending_alone' }], makeCtx({ source: 'event' }));
    expect(outcome.jumps).toEqual<JumpTarget[]>([{ type: 'ending', ending: 'ending_alone' }]);
  });

  it('emit 事件收集进 ExecOutcome（事务提交后返回给调用方）', () => {
    const rt = makeRuntime();
    const outcome = rt.exec(
      [{ notify: { textKey: 'ui.hello', vars: { who: 'raven' } } }],
      makeCtx(),
    );
    expect(outcome.events).toEqual([
      { type: 'notify', textKey: 'ui.hello', vars: { who: 'raven' } },
    ]);
  });
});

describe('04-B1 GameRuntime.exec：失败原子性与 EFFECT_FAILED 定位', () => {
  it('指令失败抛 EFFECT_FAILED，where 携带 source/scene/instruction（0 起）', () => {
    const rt = makeRuntime({ executor: stubExecutor({ failOn: 'call' }) });
    try {
      rt.exec([{ set: { key: 'attr.hp', value: 5 } }, { call: { fn: 'test.boom' } }], makeCtx());
      expect.unreachable('exec 应当抛出 EFFECT_FAILED');
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      const engineErr = err as EngineError;
      expect(engineErr.code).toBe('EFFECT_FAILED');
      expect(engineErr.where.instruction).toBe('1');
      expect(engineErr.where.source).toBe('choice');
      expect(engineErr.where.scene).toBe('scene_tavern');
      expect(engineErr.messageKey).toBe('error.runtime.effectFailed');
      expect((engineErr.cause as Error).message).toBe('stub failure: call');
    }
  });

  it('失败原子性：状态保持原对象（反向应用已应用补丁），后续事务可继续', () => {
    const rt = makeRuntime({ executor: stubExecutor({ failOn: 'call' }) });
    const before = rt.state;
    expect(() =>
      rt.exec([{ set: { key: 'attr.hp', value: 5 } }, { call: { fn: 'test.boom' } }], makeCtx()),
    ).toThrowError(/EFFECT_FAILED/);
    expect(rt.state).toBe(before);
    expect(rt.state.player.attrs.hp).toBe(30);
    const outcome = rt.exec([{ set: { key: 'attr.hp', value: 7 } }], makeCtx());
    expect(rt.state.player.attrs.hp).toBe(7);
    expect(outcome.patches).toHaveLength(1);
  });

  it('第一条指令即失败：EFFECT_FAILED.instruction = 0，状态零改动', () => {
    const rt = makeRuntime({ executor: stubExecutor({ failOn: 'flag' }) });
    const before = rt.state;
    try {
      rt.exec([{ flag: { name: 'x' } }], makeCtx());
      expect.unreachable();
    } catch (err) {
      expect((err as EngineError).where.instruction).toBe('0');
    }
    expect(rt.state).toBe(before);
  });

  it('未注入执行器：任何指令执行即 EFFECT_FAILED', () => {
    const state = newGameState({ versions: BASE_VERSIONS }, createRng(1));
    const rt = new GameRuntime({ state, rng: createRng(1) });
    try {
      rt.exec([{ flag: { name: 'x' } }], makeCtx());
      expect.unreachable();
    } catch (err) {
      expect((err as EngineError).code).toBe('EFFECT_FAILED');
      expect((err as EngineError).where.instruction).toBe('0');
    }
  });

  it('ExecContext 契约违规（非法 source / 缺 rng）→ INTERNAL', () => {
    const rt = makeRuntime();
    expect(() =>
      rt.exec([], {
        source: 'hypothetical' as ExecContext['source'],
        where: {},
        rng: createRng(1),
      }),
    ).toThrowError(/INTERNAL/);
    expect(() =>
      rt.exec([], { source: 'choice', where: {}, rng: undefined as unknown as Rng }),
    ).toThrowError(/INTERNAL/);
  });
});

describe('04-B1 ExecContext 贯穿与 draft 生命周期', () => {
  it('EffectContext.where 逐指令携带 instruction 序号并继承调用方定位', () => {
    const record: EffectContext[] = [];
    const rt = makeRuntime({ executor: stubExecutor({ record }) });
    rt.exec([{ flag: { name: 'a' } }, { flag: { name: 'b' } }], makeCtx());
    expect(record.length).toBe(2);
    expect(record[0]?.where).toEqual({ scene: 'scene_tavern', instruction: 0 });
    expect(record[1]?.where).toEqual({ scene: 'scene_tavern', instruction: 1 });
    expect(record[0]?.rng).toBe(record[1]?.rng);
  });

  it('draft 仅本事务生命周期有效：提交后越界变更抛错（immer 冻结）', () => {
    const record: EffectContext[] = [];
    const rt = makeRuntime({ executor: stubExecutor({ record }) });
    rt.exec([{ flag: { name: 'a' } }], makeCtx());
    const stashedDraft = record[0]?.draft;
    expect(stashedDraft).toBeDefined();
    expect(() => {
      (stashedDraft as NonNullable<typeof stashedDraft>).world.flags['late'] = true;
    }).toThrow();
    expect(rt.state.world.flags).toEqual({ a: true });
  });

  it('指令内 evalExpr 可见前序指令与 draft 实时视图（同事务一致性）', () => {
    const rt = makeRuntime();
    rt.exec([{ set: { key: 'attr.hp', value: 5 } }, { call: { fn: 'test.eval_hp' } }], makeCtx());
    expect(rt.state.world.flags['hp_seen']).toBe('6');
    expect(rt.eval(compile('attr.hp'))).toBe(5);
  });

  it('child：子效果在同一 draft 生效，子批 events 并入父事务、patches 不重复计数', () => {
    const childOutcomes: ExecOutcome[] = [];
    const rt = makeRuntime({ executor: stubExecutor({ childOutcomes }) });
    const outcome = rt.exec([{ call: { fn: 'test.child' } }], makeCtx());
    expect(rt.state.world.flags['child_flag']).toBe(true);
    expect(outcome.events).toEqual([{ type: 'notify', textKey: 'ui.child' }]);
    expect(childOutcomes[0]?.events).toEqual([{ type: 'notify', textKey: 'ui.child' }]);
    expect(childOutcomes[0]?.patches).toEqual([]);
  });

  it('child 失败：整批事务回滚，父指令定位 EFFECT_FAILED，cause 保留子定位', () => {
    const rt = makeRuntime();
    const before = rt.state;
    try {
      rt.exec([{ call: { fn: 'test.child_boom' } }], makeCtx());
      expect.unreachable('child 失败应使整批事务失败');
    } catch (err) {
      const engineErr = err as EngineError;
      expect(engineErr.code).toBe('EFFECT_FAILED');
      expect(engineErr.where.instruction).toBe('0');
      const cause = engineErr.cause as EngineError;
      expect(cause.code).toBe('EFFECT_FAILED');
      expect(cause.where.instruction).toBe('0');
      expect(cause.where.scene).toBe('scene_child');
    }
    expect(rt.state).toBe(before);
  });
});

describe('04-B1 派生属性触碰域重算（事务内一致性）', () => {
  function makeDerivedRuntime(executor?: EffectExecutor): GameRuntime {
    return makeRuntime({
      bootstrap: {
        versions: BASE_VERSIONS,
        attrs: { hp: 30, con: 2 },
        derivedFormulas: { max_hp: '10 + attr.con * 3' },
      },
      attrDefs: MAX_HP_ATTR_DEFS,
      executor,
    });
  }

  it('attr 域触碰：指令成功后重算，重算补丁并入事务补丁集', () => {
    const rt = makeDerivedRuntime();
    const outcome = rt.exec([{ set: { key: 'attr.con', value: 5 } }], makeCtx());
    expect(rt.state.player.derived.max_hp).toBe(25);
    expect(outcome.patches.map((p) => p.path)).toContainEqual(['player', 'derived', 'max_hp']);
  });

  it('同事务后续指令的 evalExpr 读到重算后的派生值', () => {
    const rt = makeDerivedRuntime();
    rt.exec(
      [{ set: { key: 'attr.con', value: 5 } }, { call: { fn: 'test.eval_max_hp' } }],
      makeCtx(),
    );
    expect(rt.state.world.flags['max_hp_seen']).toBe('25');
  });

  it('非触碰域（wallet）不重算：derived 保持原值', () => {
    const rt = makeDerivedRuntime();
    const outcome = rt.exec([{ money: { gold: 5 } }], makeCtx());
    expect(rt.state.player.derived.max_hp).toBe(16);
    expect(outcome.patches.map((p) => p.path)).not.toContainEqual(['player', 'derived', 'max_hp']);
  });

  it('equip / body / statuses 域触碰同样触发重算', () => {
    for (const instruction of [
      { equip: { item: 'greatsword' } },
      { set_body: { part: 'build', value: 'sturdy' } },
      { call: { fn: 'test.push_status' } },
    ] as EffectData[]) {
      const rt = makeDerivedRuntime();
      const outcome = rt.exec([instruction], makeCtx());
      expect(rt.state.player.derived.max_hp).toBe(16);
      expect(outcome.patches.length).toBeGreaterThan(0);
    }
  });

  it('失败事务不触发重算外泄：状态与 derived 均保持事务前', () => {
    const rt = makeDerivedRuntime(stubExecutor({ failOn: 'call' }));
    expect(() =>
      rt.exec([{ set: { key: 'attr.con', value: 9 } }, { call: { fn: 'test.boom' } }], makeCtx()),
    ).toThrowError(/EFFECT_FAILED/);
    expect(rt.state.player.attrs.con).toBe(2);
    expect(rt.state.player.derived.max_hp).toBe(16);
  });
});

describe('04-B1 GameRuntime.eval / evalCondition 公开入口', () => {
  it('eval 返回表达式原值（作用域来自当前已提交状态）', () => {
    const rt = makeRuntime();
    expect(rt.eval(compile('attr.hp + attr.con'))).toBe(32);
    expect(rt.eval(compile('time.day'))).toBe(1);
    expect(rt.eval(compile('slot()'))).toBe('0');
  });

  it('evalCondition 顶层真值化（DD-01：undefined/0/空串为假）', () => {
    const rt = makeRuntime();
    expect(rt.evalCondition(compile('attr.hp > 10'))).toBe(true);
    expect(rt.evalCondition(compile('flag("not_set")'))).toBe(false);
    expect(rt.evalCondition(compile('0'))).toBe(false);
  });
});

describe('04-B1 构造契约', () => {
  it('构造时冻结初始状态：绕过事务的写路径立即抛错', () => {
    const state = newGameState({ versions: BASE_VERSIONS, attrs: { hp: 30 } }, createRng(42));
    new GameRuntime({ state, rng: createRng(1) });
    expect(() => {
      state.player.attrs.hp = 1;
    }).toThrow();
  });

  it('timeView / meta 提供器注入覆盖缺省投影（09/18 号接线缝）', () => {
    const state = newGameState({ versions: BASE_VERSIONS }, createRng(42));
    const rt = new GameRuntime({
      state,
      rng: createRng(1),
      timeViewProvider: (clock) => ({
        day: clock.day,
        weekday: 'market',
        slot: `slot_${String(clock.slotIndex)}`,
      }),
      metaProvider: () => ({ points: 15, purchasedPerks: [{ id: 'iron_will', at: 0 }] }),
    });
    expect(rt.eval(compile('weekday()'))).toBe('market');
    expect(rt.eval(compile('points()'))).toBe(15);
  });
});
