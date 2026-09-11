import { describe, expect, it } from 'vitest';
import { EngineError, createRng } from '@game/shared';
import type { EffectContext, ExecContext, ExecSource } from '../../src/runtime/exec-context.js';
import { makeCtx, makeRuntime, stubExecutor } from './fixtures.js';

/**
 * ExecContext（source/where/rng）贯穿与调试字段验证（04 任务 B3，设计 §3.1 /
 * §3.3、FR-DEBG）。
 *
 * - source 六来源贯穿：EffectContext 定位与 EFFECT_FAILED where 双面验证；
 * - where（scene/event/battle）逐字段贯穿 + instruction 逐指令编号；
 * - rng 单一序列贯穿：指令内消耗推进共享 Rng（DD-09 同种子可回放）；
 * - debug 来源事务以补丁留痕（FR-DEBG-02 变量监视器的修改审计底座）。
 */

const ALL_SOURCES: readonly ExecSource[] = ['choice', 'event', 'hook', 'battle', 'script', 'debug'];

describe('04-B3 source 全集贯穿', () => {
  it('六种来源均通过契约校验（空事务不抛 INTERNAL）', () => {
    const rt = makeRuntime();
    for (const source of ALL_SOURCES) {
      expect(() => rt.exec([], makeCtx({ source }))).not.toThrow();
    }
  });

  it('指令失败时 where.source 如实反映事务来源', () => {
    for (const source of ALL_SOURCES) {
      const rt = makeRuntime({ executor: stubExecutor({ failOn: 'flag' }) });
      try {
        rt.exec([{ flag: { name: 'x' } }], makeCtx({ source }));
        expect.unreachable('应当抛出 EFFECT_FAILED');
      } catch (err) {
        expect((err as EngineError).where.source).toBe(source);
      }
    }
  });

  it('非法来源拒绝执行（INTERNAL，调试面不会静默落库）', () => {
    const rt = makeRuntime();
    expect(() =>
      rt.exec([], { source: 'teleport' as ExecSource, where: {}, rng: createRng(1) }),
    ).toThrowError(/INTERNAL/);
  });
});

describe('04-B3 where 调试字段贯穿', () => {
  it('scene/event/battle 字段逐个进入 EffectContext.where 与 EFFECT_FAILED where', () => {
    const cases: {
      where: ExecContext['where'];
      key: 'scene' | 'event' | 'battle';
      value: string;
    }[] = [
      { where: { scene: 'scene_dock' }, key: 'scene', value: 'scene_dock' },
      { where: { event: 'event_ambush' }, key: 'event', value: 'event_ambush' },
      { where: { battle: 'battle_rat' }, key: 'battle', value: 'battle_rat' },
    ];
    for (const { where, key, value } of cases) {
      const record: EffectContext[] = [];
      const rt = makeRuntime({ executor: stubExecutor({ record }) });
      rt.exec([{ flag: { name: 'marker' } }], makeCtx({ where }));
      expect(record[0]?.where[key]).toBe(value);
      const failing = makeRuntime({ executor: stubExecutor({ failOn: 'flag' }) });
      try {
        failing.exec([{ flag: { name: 'x' } }], makeCtx({ where }));
        expect.unreachable();
      } catch (err) {
        expect((err as EngineError).where[key]).toBe(value);
      }
    }
  });

  it('多字段并存时全部保留（EFFECT_FAILED 定位信息不互相覆盖）', () => {
    const rt = makeRuntime({ executor: stubExecutor({ failOn: 'flag' }) });
    try {
      rt.exec(
        [{ flag: { name: 'x' } }],
        makeCtx({ where: { scene: 'scene_a', event: 'event_b', battle: 'battle_c' } }),
      );
      expect.unreachable();
    } catch (err) {
      const where = (err as EngineError).where;
      expect(where.scene).toBe('scene_a');
      expect(where.event).toBe('event_b');
      expect(where.battle).toBe('battle_c');
      expect(where.source).toBe('choice');
    }
  });

  it('instruction 序号逐指令递增（0 起），多指令批全程可定位', () => {
    const record: EffectContext[] = [];
    const rt = makeRuntime({ executor: stubExecutor({ record }) });
    rt.exec(
      [
        { flag: { name: 'a' } },
        { flag: { name: 'b' } },
        { flag: { name: 'c' } },
        { flag: { name: 'd' } },
      ],
      makeCtx(),
    );
    expect(record.map((ctx) => ctx.where.instruction)).toEqual([0, 1, 2, 3]);
    expect(record.every((ctx) => ctx.where.scene === 'scene_tavern')).toBe(true);
  });
});

describe('04-B3 rng 单一序列贯穿（DD-09）', () => {
  it('EffectContext.rng 与 ExecContext.rng 为同一实例（跨指令共享序列）', () => {
    const record: EffectContext[] = [];
    const rt = makeRuntime({ executor: stubExecutor({ record }) });
    const rng = createRng(7);
    rt.exec([{ flag: { name: 'a' } }, { flag: { name: 'b' } }], makeCtx({ rng }));
    expect(record[0]?.rng).toBe(rng);
    expect(record[1]?.rng).toBe(rng);
  });

  it('指令内消耗随机推进运行时共享序列（可回放性的前提）', () => {
    const rt = makeRuntime();
    const rng = rt.rng;
    const before = rng.getState();
    rt.exec([{ call: { fn: 'test.eval_rand' } }], makeCtx({ rng }));
    expect(rt.state.world.flags['rand_seen']).toBeTypeOf('string');
    expect(rng.getState()).not.toBe(before);
  });

  it('同种子 + 同操作序列 → 同终态（回放一致性）', () => {
    const runOnce = (): unknown => {
      const rt = makeRuntime({ rng: createRng(2024) });
      const rng = createRng(2024);
      rt.exec([{ call: { fn: 'test.eval_rand' } }], makeCtx({ rng }));
      return rt.state.world.flags['rand_seen'];
    };
    expect(runOnce()).toBe(runOnce());
  });
});

describe('04-B3 debug 事务留痕（FR-DEBG-02 变量监视器审计底座）', () => {
  it('debug 来源修改经 exec 包装：补丁完整记录变更路径与前后值', () => {
    const rt = makeRuntime();
    const outcome = rt.exec(
      [{ set: { key: 'attr.hp', value: 999 } }],
      makeCtx({ source: 'debug' }),
    );
    expect(rt.state.player.attrs.hp).toBe(999);
    const patch = outcome.patches[0];
    expect(patch?.path).toEqual(['player', 'attrs', 'hp']);
    expect(patch?.op).toBe('replace');
  });

  it('debug 事务同样触发派生重算与事件派发（不绕过任何管线）', () => {
    const rt = makeRuntime({
      bootstrap: {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' },
        attrs: { hp: 30, con: 2 },
        derivedFormulas: { max_hp: '10 + attr.con * 3' },
      },
    });
    const statEvents: string[] = [];
    rt.on('stat_changed', (event) => statEvents.push(event.attr));
    const outcome = rt.exec([{ set: { key: 'attr.hp', value: 1 } }], makeCtx({ source: 'debug' }));
    expect(outcome.patches.length).toBeGreaterThan(0);
    expect(statEvents).toEqual(['hp']);
  });
});

describe('04-B3 ExecContext 契约边界', () => {
  it('where 缺省（无定位键）不阻塞执行：定位字段按需可选', () => {
    const rt = makeRuntime();
    const outcome = rt.exec([{ flag: { name: 'no_where' } }], {
      source: 'hook',
      where: {},
      rng: createRng(1),
    });
    expect(rt.state.world.flags['no_where']).toBe(true);
    expect(outcome.patches[0]?.path).toEqual(['world', 'flags', 'no_where']);
  });

  it('ctx 原对象不被 exec 改写（调用方可复用）', () => {
    const rt = makeRuntime();
    const ctx: ExecContext = {
      source: 'choice',
      where: { scene: 'scene_tavern' },
      rng: createRng(1),
    };
    const snapshot = { ...ctx.where };
    rt.exec([{ flag: { name: 'reusable' } }], ctx);
    expect(ctx.where).toEqual(snapshot);
    expect(ctx.source).toBe('choice');
    rt.exec([{ flag: { name: 'reusable_2' } }], ctx);
    expect(rt.state.world.flags['reusable_2']).toBe(true);
  });
});
