import { describe, expect, it, vi } from 'vitest';
import type { EffectData } from '@game/shared';
import type {
  EngineEvent,
  NotifyEvent,
  StatChangedEvent,
} from '../../src/runtime/engine-events.js';
import type { Unsubscribe } from '../../src/runtime/engine-events.js';
import { makeCtx, makeRuntime, stubExecutor } from './fixtures.js';

/**
 * EngineEvent 全集与 on/emit 总线用例（04 任务 B2，设计 §3.1）。
 *
 * - 事件随事务收集，提交后统一送达（失败事务半途事件不外泄）；
 * - stat_changed 由事务补丁派生（FR-STAT-04：from 取事务前值、逐条增量）；
 * - on(type, handler) 按 type 分发、退订生效、监听器异常隔离（§10.2）。
 */

describe('04-B2 on/emit 总线：订阅、分发与退订', () => {
  it('事务提交后按 emit 序送达监听者', () => {
    const rt = makeRuntime();
    const received: EngineEvent[] = [];
    rt.on('notify', (event) => received.push(event));
    rt.exec([{ notify: { textKey: 'ui.first' } }, { notify: { textKey: 'ui.second' } }], makeCtx());
    expect(received.map((event) => (event as NotifyEvent).textKey)).toEqual([
      'ui.first',
      'ui.second',
    ]);
  });

  it('监听者拿到的 state 为事务提交后的值（送达时机在提交后）', () => {
    const rt = makeRuntime();
    let observedHp = -1;
    rt.on('notify', () => {
      observedHp = rt.state.player.attrs.hp ?? -1;
    });
    rt.exec([{ notify: { textKey: 'ui.ping' } }, { set: { key: 'attr.hp', value: 7 } }], makeCtx());
    expect(observedHp).toBe(7);
  });

  it('同一 type 多监听者按加入顺序通知；其他 type 不串扰', () => {
    const rt = makeRuntime();
    const calls: string[] = [];
    rt.on('notify', () => calls.push('notify-a'));
    rt.on('media', () => calls.push('media-b'));
    rt.on('notify', () => calls.push('notify-c'));
    rt.exec([{ notify: { textKey: 'ui.x' } }], makeCtx());
    expect(calls).toEqual(['notify-a', 'notify-c']);
  });

  it('退订句柄生效：退订后不再接收', () => {
    const rt = makeRuntime();
    const received: NotifyEvent[] = [];
    const unsubscribe: Unsubscribe = rt.on('notify', (event) => {
      received.push(event);
    });
    rt.exec([{ notify: { textKey: 'ui.one' } }], makeCtx());
    unsubscribe();
    rt.exec([{ notify: { textKey: 'ui.two' } }], makeCtx());
    expect(received.map((event) => event.textKey)).toEqual(['ui.one']);
  });

  it('失败事务的半途事件不送达（事件面与状态面同批原子）', () => {
    const rt = makeRuntime({ executor: stubExecutor({ failOn: 'call' }) });
    const received: EngineEvent[] = [];
    rt.on('notify', (event) => received.push(event));
    expect(() =>
      rt.exec(
        [{ notify: { textKey: 'ui.rolled_back' } }, { call: { fn: 'test.boom' } }],
        makeCtx(),
      ),
    ).toThrowError(/EFFECT_FAILED/);
    expect(received).toEqual([]);
  });

  it('监听器异常被隔离：不打断事务、不影响其他监听者', () => {
    const rt = makeRuntime();
    const after: string[] = [];
    rt.on('notify', () => {
      throw new Error('listener bug');
    });
    rt.on('notify', () => after.push('second'));
    const outcome = rt.exec([{ notify: { textKey: 'ui.ok' } }], makeCtx());
    expect(after).toEqual(['second']);
    expect(outcome.events).toHaveLength(1);
    expect(rt.state.world.flags).toEqual({});
  });
});

describe('04-B2 stat_changed 补丁派生（FR-STAT-04）', () => {
  it('属性写入逐条派生 stat_changed：from 取事务前值、delta 增量', () => {
    const rt = makeRuntime();
    const received: StatChangedEvent[] = [];
    rt.on('stat_changed', (event) => received.push(event));
    const outcome = rt.exec(
      [{ set: { key: 'attr.hp', value: 25 } }, { set: { key: 'attr.hp', value: 20 } }],
      makeCtx(),
    );
    expect(outcome.events).toEqual<StatChangedEvent[]>([
      { type: 'stat_changed', attr: 'hp', from: 30, to: 25, delta: -5 },
      { type: 'stat_changed', attr: 'hp', from: 25, to: 20, delta: -5 },
    ]);
    expect(received).toHaveLength(2);
  });

  it('事务内新增属性键：from = 0（immer add 语义）', () => {
    const rt = makeRuntime();
    const outcome = rt.exec([{ set: { key: 'attr.luck', value: 3 } }], makeCtx());
    expect(outcome.events).toEqual<StatChangedEvent[]>([
      { type: 'stat_changed', attr: 'luck', from: 0, to: 3, delta: 3 },
    ]);
  });

  it('非 attrs 域的写路径不派生 stat_changed（flag/wallet/statuses 等）', () => {
    const rt = makeRuntime();
    const received: StatChangedEvent[] = [];
    rt.on('stat_changed', (event) => received.push(event));
    const outcome = rt.exec(
      [
        { flag: { name: 'door_opened' } },
        { money: { gold: 10 } },
        { call: { fn: 'test.push_status' } },
      ] as EffectData[],
      makeCtx(),
    );
    expect(received).toEqual([]);
    expect(outcome.events).toEqual([]);
  });

  it('派生属性重算补丁（player/derived）不产生 stat_changed', () => {
    const rt = makeRuntime({
      bootstrap: {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' },
        attrs: { con: 2 },
        derivedFormulas: { max_hp: '10 + attr.con * 3' },
      },
      attrDefs: {
        numeric: {},
        level: {},
        derived: { max_hp: { formula: '10 + attr.con * 3' } },
      },
    });
    const outcome = rt.exec([{ set: { key: 'attr.con', value: 5 } }], makeCtx());
    const statEvents = outcome.events.filter((event) => event.type === 'stat_changed');
    expect(statEvents).toHaveLength(1);
    expect((statEvents[0] as StatChangedEvent).attr).toBe('con');
  });
});

describe('04-B2 EngineEvent 判别联合（类型面守护）', () => {
  it('核心成员可构造且 type 判别完备（notify/unlock/media/check_result/snapshot_warn）', () => {
    const events: EngineEvent[] = [
      { type: 'notify', textKey: 'ui.hello' },
      { type: 'unlock', kind: 'gallery', id: 'scene_memory_1' },
      { type: 'media', intent: { type: 'bgm', assetId: 'bgm_town', loop: true } },
      {
        type: 'check_result',
        rule: 'coc',
        outcome: 'success',
        level: 'hard',
        rolls: [42],
        detail: { threshold: 50 },
      },
      { type: 'snapshot_warn', label: '选择前', sizeBytes: 6_000_000, thresholdBytes: 5_242_880 },
    ];
    const kinds = events.map((event) => event.type);
    expect(kinds).toEqual(['notify', 'unlock', 'media', 'check_result', 'snapshot_warn']);
  });

  it('监听器按判别收窄拿到具体事件负载（Extract 类型行为验证）', () => {
    const rt = makeRuntime();
    const handler = vi.fn((event: NotifyEvent) => {
      expect(event.textKey).toBeTypeOf('string');
    });
    rt.on('notify', handler);
    rt.exec([{ notify: { textKey: 'ui.narrow' } }], makeCtx());
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
