import { describe, expect, it, vi } from 'vitest';
import { bridgeRuntimeEvents, createUiStore, resetNotificationIds } from '../../src/app/index.js';
import { expireToasts, TOAST_DEFAULT_TTL_MS } from '../../src/notifications/index.js';
import { exec, makeRuntime } from '../fixtures.js';

/**
 * 25 任务 11：通知系统与 store 的集成（设计 §6.2 store / §6.4 通知系统）。
 *
 * 分工：**合并策略与过期清理是纯函数**（notifications/toast.ts，单独用例覆盖
 * 边界）；store 的 `pushNotification` 是队列的唯一写入口，在写入时应用合并——
 * 本文件断言宿主实际拿到的队列形态（FR-UI-07 防刷屏的可观测结果）。
 */

describe('store 入队即合并（FR-UI-07）', () => {
  it('窗口内同类同键连续入队 → 折叠为一条且 count 递增', () => {
    resetNotificationIds(1);
    const store = createUiStore();
    store.getState().pushNotification({ kind: 'item', textKey: 'ui.got_item', at: 1000 });
    store.getState().pushNotification({ kind: 'item', textKey: 'ui.got_item', at: 1100 });
    store.getState().pushNotification({ kind: 'item', textKey: 'ui.got_item', at: 1200 });
    const queue = store.getState().notifications;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ kind: 'item', textKey: 'ui.got_item', count: 3, at: 1200 });
  });

  it('超窗再入队 → 重新起条（不吞信息）', () => {
    resetNotificationIds(1);
    const store = createUiStore();
    store.getState().pushNotification({ kind: 'item', textKey: 'ui.got_item', at: 1000 });
    store.getState().pushNotification({ kind: 'item', textKey: 'ui.got_item', at: 2000 });
    expect(store.getState().notifications).toHaveLength(2);
  });

  it('不同类别各自成条（成就与物品不互并）', () => {
    resetNotificationIds(1);
    const store = createUiStore();
    store.getState().pushNotification({ kind: 'achievement', textKey: 'achv.a', at: 1000 });
    store.getState().pushNotification({ kind: 'item', textKey: 'achv.a', at: 1100 });
    expect(store.getState().notifications.map((entry) => entry.kind)).toEqual([
      'achievement',
      'item',
    ]);
  });

  it('不同文本键各自成条（同 kind 不互并）', () => {
    resetNotificationIds(1);
    const store = createUiStore();
    store.getState().pushNotification({ kind: 'notify', textKey: 'ui.a', at: 1000 });
    store.getState().pushNotification({ kind: 'notify', textKey: 'ui.b', at: 1100 });
    expect(store.getState().notifications).toHaveLength(2);
  });

  it('合并后 id 保持首条（React key 稳定，DOM 节点复用）', () => {
    resetNotificationIds(10);
    const store = createUiStore();
    store.getState().pushNotification({ kind: 'notify', textKey: 'ui.a', at: 1000 });
    const firstId = store.getState().notifications[0]?.id;
    store.getState().pushNotification({ kind: 'notify', textKey: 'ui.a', at: 1100 });
    expect(store.getState().notifications[0]?.id).toBe(firstId);
  });
});

describe('事件桥 → 队列 → 合并（端到端组合）', () => {
  it('两次 notify 事件在窗口内折叠为一条 count=2', () => {
    resetNotificationIds(1);
    const runtime = makeRuntime();
    const store = createUiStore();
    const unsubscribe = bridgeRuntimeEvents(runtime, store, () => 1000);

    exec(runtime, [{ notify: { textKey: 'ui.ping' } }]);
    exec(runtime, [{ notify: { textKey: 'ui.ping' } }]);

    const queue = store.getState().notifications;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ kind: 'notify', textKey: 'ui.ping', count: 2 });
    unsubscribe();
  });
});

describe('过期清理（宿主定时器的驱动面）', () => {
  it('TTL 外的条目移除、TTL 内保留', () => {
    const items = [
      { id: 1, kind: 'notify' as const, textKey: 'ui.a', count: 1, at: 1000 },
      { id: 2, kind: 'notify' as const, textKey: 'ui.b', count: 1, at: 4000 },
    ];
    // now=5000：第一条已 4000ms（== TTL，闭区间保留），推进到 5001 才过期
    expect(expireToasts(items, 5000, TOAST_DEFAULT_TTL_MS).map((item) => item.id)).toEqual([1, 2]);
    expect(expireToasts(items, 5001, TOAST_DEFAULT_TTL_MS).map((item) => item.id)).toEqual([2]);
  });

  it('无条目过期时返回原引用（宿主 tick 不触发无效重渲染）', () => {
    const items = [{ id: 1, kind: 'notify' as const, textKey: 'ui.a', count: 1, at: 4900 }];
    expect(expireToasts(items, 5000)).toBe(items);
  });
});

describe('noteStatChange 不占通知（§6.4「属性变化高亮走 StatusPanel 内部，不占 Toast」）', () => {
  it('数值变化只进 statHighlights，不进 notifications', () => {
    const store = createUiStore();
    store.getState().noteStatChange({ attr: 'hp', from: 5, to: 3, delta: -2, at: 1000 });
    expect(store.getState().statHighlights['hp']?.delta).toBe(-2);
    expect(store.getState().notifications).toEqual([]);
  });

  it('dismiss/clear 只影响通知切片', () => {
    resetNotificationIds(1);
    const store = createUiStore();
    store.getState().pushNotification({ kind: 'system', textKey: 'ui.a' });
    const id = store.getState().notifications[0]?.id as number;
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.getState().dismissNotification(id);
    expect(store.getState().notifications).toEqual([]);
    expect(store.getState().statHighlights).toEqual({});
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});
