import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { GameState } from '../../src/state/game-state.js';
import { makeCtx, makeRuntime } from './fixtures.js';

/**
 * checkpoint / rollback 快照栈用例（04 任务 C1，设计 §3.1 快照策略、
 * FR-READ-03、DD-09「回滚一致」）。
 *
 * - checkpoint：structuredClone 全量快照 + RNG 状态入栈，栈深可配；
 * - rollback：恢复 GameState 与 RNG；已送达事件不撤销（Profile 解耦边界）；
 * - state.checkpoints 元数据与活栈镜像（不入档，调试/UI 呈现面）。
 */

/** 推进状态并返回运行时（便于多回滚点场景构造） */
function advance(rt: ReturnType<typeof makeRuntime>, hp: number): void {
  rt.exec([{ set: { key: 'attr.hp', value: hp } }], makeCtx());
}

function labelsOf(state: GameState): string[] {
  return state.checkpoints.map((meta) => meta.label);
}

describe('04-C1 checkpoint/rollback：基本回退', () => {
  it('rollback(1) 恢复到最近回滚点状态，restoredLabel 为该点标签', () => {
    const rt = makeRuntime();
    rt.checkpoint('before_first');
    advance(rt, 20);
    rt.checkpoint('before_second');
    advance(rt, 10);
    const result = rt.rollback();
    expect(result).toEqual({ ok: true, restoredLabel: 'before_second' });
    expect(rt.state.player.attrs.hp).toBe(20);
  });

  it('连续回退逐点回溯；栈空后 ok=false 且状态不变', () => {
    const rt = makeRuntime();
    rt.checkpoint('cp0');
    advance(rt, 25);
    rt.checkpoint('cp1');
    advance(rt, 15);
    expect(rt.rollback(1)).toEqual({ ok: true, restoredLabel: 'cp1' });
    expect(rt.state.player.attrs.hp).toBe(25);
    expect(rt.rollback(1)).toEqual({ ok: true, restoredLabel: 'cp0' });
    expect(rt.state.player.attrs.hp).toBe(30);
    const exhausted = rt.rollback(1);
    expect(exhausted.ok).toBe(false);
    expect(exhausted.restoredLabel).toBeUndefined();
    expect(rt.state.player.attrs.hp).toBe(30);
  });

  it('rollback(steps) 多步一次回退；超出栈深按栈深截断', () => {
    const rt = makeRuntime();
    rt.checkpoint('cp0');
    advance(rt, 28);
    rt.checkpoint('cp1');
    advance(rt, 26);
    rt.checkpoint('cp2');
    advance(rt, 24);
    const result = rt.rollback(3);
    expect(result.ok).toBe(true);
    expect(result.restoredLabel).toBe('cp0');
    expect(rt.state.player.attrs.hp).toBe(30);
  });

  it('steps < 1 或非整数 → ok=false（无副作用）', () => {
    const rt = makeRuntime();
    rt.checkpoint('cp0');
    const before = rt.state;
    expect(rt.rollback(0).ok).toBe(false);
    expect(rt.rollback(-2).ok).toBe(false);
    expect(rt.rollback(1.5).ok).toBe(false);
    expect(rt.state).toBe(before);
  });
});

describe('04-C1 回滚后状态一致性', () => {
  it('恢复的状态与打点时全量一致（含 flags/bag/outfit 等全域）', () => {
    const rt = makeRuntime();
    rt.checkpoint('cp0');
    rt.exec(
      [
        { flag: { name: 'door_opened', value: true } },
        { money: { gold: 50 } },
        { equip: { item: 'greatsword' } },
        { set_body: { part: 'build', value: 'sturdy' } },
      ],
      makeCtx(),
    );
    rt.rollback(1);
    expect(rt.state.player.attrs.hp).toBe(30);
    expect(rt.state.world.flags).toEqual({});
    expect(rt.state.player.wallet).toEqual({});
    expect(rt.state.player.equip).toEqual({});
    expect(rt.state.player.body).toEqual({});
  });

  it('恢复后的状态为冻结副本：改写打点快照不串扰后续回退', () => {
    const rt = makeRuntime();
    rt.checkpoint('cp0');
    rt.exec([{ set: { key: 'attr.hp', value: 5 } }], makeCtx());
    rt.rollback(1);
    expect(() => {
      (rt.state as GameState).player.attrs.hp = 1;
    }).toThrow();
    // 再打点、再变更、再回退——快照彼此独立
    rt.checkpoint('cp1');
    rt.exec([{ set: { key: 'attr.hp', value: 7 } }], makeCtx());
    rt.rollback(1);
    expect(rt.state.player.attrs.hp).toBe(30);
  });

  it('回滚后可继续事务与再打点（元数据与活栈保持镜像）', () => {
    const rt = makeRuntime();
    rt.checkpoint('cp0');
    advance(rt, 20);
    rt.checkpoint('cp1');
    advance(rt, 10);
    rt.rollback(1);
    expect(labelsOf(rt.state)).toEqual(['cp0']);
    rt.checkpoint('cp1b');
    advance(rt, 12);
    expect(labelsOf(rt.state)).toEqual(['cp0', 'cp1b']);
    rt.rollback(1);
    expect(rt.state.player.attrs.hp).toBe(20);
    expect(labelsOf(rt.state)).toEqual(['cp0']);
  });

  it('回滚恢复 RNG 状态：重放结果与原第二抽一致（DD-09 回滚一致，非重掷）', () => {
    const runScenario = (): { first: unknown; second: unknown; afterRollback: unknown } => {
      const rt = makeRuntime({ rng: createRng(99) });
      rt.exec([{ call: { fn: 'test.eval_rand' } }], makeCtx({ rng: rt.rng }));
      const first = rt.state.world.flags['rand_seen'];
      rt.checkpoint('before_replay');
      rt.exec([{ call: { fn: 'test.eval_rand' } }], makeCtx({ rng: rt.rng }));
      const second = rt.state.world.flags['rand_seen'];
      rt.rollback(1);
      rt.exec([{ call: { fn: 'test.eval_rand' } }], makeCtx({ rng: rt.rng }));
      return { first, second, afterRollback: rt.state.world.flags['rand_seen'] };
    };
    const scenario = runScenario();
    expect(scenario.first).not.toBe(scenario.second); // 前提：种子 99 下序列确实推进
    expect(scenario.afterRollback).toBe(scenario.second); // 回滚恢复 RNG：重放 = 原第二抽
    const replayed = runScenario();
    expect(replayed.first).toBe(scenario.first);
    expect(replayed.afterRollback).toBe(scenario.afterRollback); // 同种子跨实例可复现
  });
});

describe('04-C1 回滚与已发出事件解耦（FR-READ-03）', () => {
  it('rollback 不撤销已送达事件（成就/Profile 写入独立持久化）', () => {
    const rt = makeRuntime();
    const received: string[] = [];
    rt.on('notify', (event) => received.push(event.textKey));
    rt.on('stat_changed', (event) => received.push(`stat:${event.attr}`));
    rt.exec([{ notify: { textKey: 'ui.before' } }], makeCtx());
    rt.checkpoint('cp0');
    rt.exec([{ set: { key: 'attr.hp', value: 5 } }], makeCtx());
    expect(received).toEqual(['ui.before', 'stat:hp']);
    rt.rollback(1);
    expect(received).toEqual(['ui.before', 'stat:hp']);
    expect(rt.state.player.attrs.hp).toBe(30);
  });
});

describe('04-C1 栈深限制（默认 5，可配置）', () => {
  it('默认栈深 5：第 7 个打点后仅剩最近 5 个可达点', () => {
    const rt = makeRuntime();
    for (const [index, label] of ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'].entries()) {
      advance(rt, index + 1);
      rt.checkpoint(label);
    }
    expect(labelsOf(rt.state)).toEqual(['c2', 'c3', 'c4', 'c5', 'c6']);
    const result = rt.rollback(5);
    expect(result).toEqual({ ok: true, restoredLabel: 'c2' });
    expect(rt.state.player.attrs.hp).toBe(3); // c2 打点时 hp 已推进到 3
    expect(rt.rollback(1).ok).toBe(false);
  });

  it('可配置栈深：checkpointLimit=2 时只保留最近 2 点', () => {
    const rt = makeRuntime({ checkpointLimit: 2 });
    for (const [index, label] of ['d0', 'd1', 'd2', 'd3'].entries()) {
      advance(rt, index + 1);
      rt.checkpoint(label);
    }
    expect(labelsOf(rt.state)).toEqual(['d2', 'd3']);
    const result = rt.rollback(2);
    expect(result).toEqual({ ok: true, restoredLabel: 'd2' });
  });

  it('非法 checkpointLimit（0/负数/非整数）构造即报 INTERNAL', () => {
    expect(() => makeRuntime({ checkpointLimit: 0 })).toThrowError(/INTERNAL/);
    expect(() => makeRuntime({ checkpointLimit: -1 })).toThrowError(/INTERNAL/);
    expect(() => makeRuntime({ checkpointLimit: 2.5 })).toThrowError(/INTERNAL/);
  });
});
