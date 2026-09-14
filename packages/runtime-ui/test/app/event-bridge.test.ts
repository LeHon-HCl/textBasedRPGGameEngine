import { describe, expect, it } from 'vitest';
import { bridgeRuntimeEvents, createUiStore } from '../../src/app/index.js';
import { emitEvent, exec, makeRuntime } from '../fixtures.js';

/**
 * 25 任务 1：GameRuntime 事件订阅桥（设计 §6.2「GameRuntime.on(EngineEvent) →
 * store 更新」）。
 *
 * 断言口径为**事件 → UI 状态**的映射行为：引擎发什么事件、store 立即可见什么
 * 投影；退订后不再更新（避免换档泄漏）。
 */

describe('事件桥：stat_changed → 数值高亮（FR-STAT-04）', () => {
  it('事务提交后自动进入 statHighlights，携带 from/to/delta', () => {
    const runtime = makeRuntime({ attrs: { hp: 10 } });
    const store = createUiStore();
    const unsubscribe = bridgeRuntimeEvents(runtime, store, () => 1000);

    exec(runtime, [{ add: { key: 'attr.hp', amount: -3 } }]);

    const highlight = store.getState().statHighlights['hp'];
    expect(highlight).toEqual({ from: 10, to: 7, delta: -3, at: 1000 });
    unsubscribe();
  });

  it('退订后事件不再进入 store（换档不串扰）', () => {
    const runtime = makeRuntime({ attrs: { hp: 10 } });
    const store = createUiStore();
    const unsubscribe = bridgeRuntimeEvents(runtime, store);
    unsubscribe();

    exec(runtime, [{ add: { key: 'attr.hp', amount: 5 } }]);
    expect(store.getState().statHighlights['hp']).toBeUndefined();
  });
});

describe('事件桥：notify → Toast 队列（FR-UI-07）', () => {
  it('notify 事件进入 notifications，文本键与插值变量透传', () => {
    const runtime = makeRuntime();
    const store = createUiStore();
    const unsubscribe = bridgeRuntimeEvents(runtime, store, () => 2000);

    exec(runtime, [{ notify: { textKey: 'ui.notify.got_item', vars: { item: 'warm_bun' } } }]);

    const list = store.getState().notifications;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: 'notify',
      textKey: 'ui.notify.got_item',
      vars: { item: 'warm_bun' },
      at: 2000,
      count: 1,
    });
    unsubscribe();
  });
});

describe('事件桥：quest_state_changed / quest_stage → 任务面板重算信号', () => {
  it('任务事件只递增 revision，不污染其他切片', () => {
    const runtime = makeRuntime();
    const store = createUiStore();
    const unsubscribe = bridgeRuntimeEvents(runtime, store);
    const notificationsBefore = store.getState().notifications;

    exec(runtime, [
      emitEvent({
        type: 'quest_state_changed',
        quest: 'wall_rubbing',
        from: 'available',
        to: 'active',
      }),
    ]);
    exec(runtime, [
      emitEvent({
        type: 'quest_stage',
        quest: 'wall_rubbing',
        from: 'stage_1',
        to: 'stage_2',
        objectiveKey: 'quests.wall_rubbing.stage2',
      }),
    ]);

    expect(store.getState().questRevision).toBe(2);
    expect(store.getState().notifications).toBe(notificationsBefore);
    unsubscribe();
  });
});
