import { describe, expect, it } from 'vitest';
import {
  createUiStore,
  EMPTY_SESSION,
  selectMobileTab,
  selectNotifications,
  selectOpenPanel,
  selectScreen,
  selectSession,
  selectStatHighlights,
  type UiStoreApi,
} from '../../src/app/index.js';
import { selectQuestRevision } from '../../src/app/selectors.js';

/**
 * 25 任务 1：UiStore —— 应用外壳状态容器（设计 §6.2）。
 *
 * 断言口径为**行为**：动作后的状态快照、selector 的投影结果、
 * 以及 store 的订阅通知（细粒度订阅的数据底座）。
 */

describe('UiStore 初始状态（设计 §6.2）', () => {
  it('缺省处于 title 屏、无运行时、空会话、无通知、双栏面板关闭', () => {
    const store = createUiStore();
    const state = store.getState();
    expect(state.screen).toBe('title');
    expect(state.runtime).toBeNull();
    expect(state.session).toEqual(EMPTY_SESSION);
    expect(state.notifications).toEqual([]);
    expect(state.panels).toEqual({ open: null, mobileTab: 'status' });
    expect(state.statHighlights).toEqual({});
  });

  it('每个 store 实例相互隔离（可测性的实例化契约）', () => {
    const a = createUiStore();
    const b = createUiStore();
    a.getState().setScreen('game');
    expect(a.getState().screen).toBe('game');
    expect(b.getState().screen).toBe('title');
  });
});

describe('UiStore 动作', () => {
  it('setScreen 切换屏幕；reset 回到初始快照', () => {
    const store = createUiStore();
    store.getState().setScreen('game');
    store.getState().openPanel('status');
    store.getState().reset();
    const state = store.getState();
    expect(state.screen).toBe('title');
    expect(state.panels.open).toBeNull();
    expect(state.session).toEqual(EMPTY_SESSION);
  });

  it('setSession 整体替换会话投影；未变更时保持同一对象引用（细粒度订阅前提）', () => {
    const store = createUiStore();
    const session = {
      phase: 'await_advance' as const,
      sceneId: 'arrival',
      segments: [{ kind: 'text' as const, key: 'scenes.arrival.open' }],
      choices: [],
    };
    store.getState().setSession(session);
    expect(selectSession(store.getState())).toBe(session);
    store.getState().setScreen('panels');
    expect(selectSession(store.getState())).toBe(session);
  });

  it('openPanel/closePanel 与 setMobileTab 只动 panels 切片', () => {
    const store = createUiStore();
    const before = selectSession(store.getState());
    store.getState().openPanel('map');
    expect(selectOpenPanel(store.getState())).toBe('map');
    store.getState().setMobileTab('quest');
    expect(selectMobileTab(store.getState())).toBe('quest');
    store.getState().openPanel(null);
    expect(selectOpenPanel(store.getState())).toBeNull();
    expect(selectSession(store.getState())).toBe(before);
  });

  it('pushNotification 追加通知并分配单调 id；dismiss/clear 收敛列表', () => {
    const store = createUiStore();
    store.getState().pushNotification({ kind: 'notify', textKey: 'ui.notify.item' });
    store.getState().pushNotification({ kind: 'achievement', textKey: 'achv.first_rumor' });
    const list = selectNotifications(store.getState());
    expect(list).toHaveLength(2);
    expect(list[0]?.kind).toBe('notify');
    expect(list[1]?.kind).toBe('achievement');
    expect(list[0]?.id).not.toBe(list[1]?.id);
    expect(list[0]?.count).toBe(1);

    store.getState().dismissNotification(list[0]?.id as number);
    expect(selectNotifications(store.getState())).toHaveLength(1);

    store.getState().clearNotifications();
    expect(selectNotifications(store.getState())).toEqual([]);
  });

  it('noteStatChange 记录增量高亮；clearStatHighlights 支持按属性收敛', () => {
    const store = createUiStore();
    store.getState().noteStatChange({ attr: 'hp', from: 10, to: 7, delta: -3, at: 1000 });
    store.getState().noteStatChange({ attr: 'insight', from: 0, to: 2, delta: 2, at: 1001 });
    const highlights = selectStatHighlights(store.getState());
    expect(highlights['hp']).toEqual({ from: 10, to: 7, delta: -3, at: 1000 });
    expect(highlights['insight']?.delta).toBe(2);

    store.getState().clearStatHighlights(['hp']);
    expect(selectStatHighlights(store.getState())['hp']).toBeUndefined();
    expect(selectStatHighlights(store.getState())['insight']).toBeDefined();

    store.getState().clearStatHighlights();
    expect(selectStatHighlights(store.getState())).toEqual({});
  });

  it('bumpQuestRevision 单调递增（任务面板重算触发信号）', () => {
    const store = createUiStore();
    const start = selectQuestRevision(store.getState());
    store.getState().bumpQuestRevision();
    store.getState().bumpQuestRevision();
    expect(selectQuestRevision(store.getState())).toBe(start + 2);
  });
});

describe('UiStore 订阅语义（NFR-01 细粒度订阅的数据底座）', () => {
  it('订阅者在无关切片变更时收到通知，但 state 引用按切片稳定', () => {
    const store: UiStoreApi = createUiStore();
    const seen: string[] = [];
    const unsubscribe = store.subscribe((state) => {
      seen.push(state.screen);
    });
    store.getState().setScreen('game');
    store.getState().setMobileTab('map');
    unsubscribe();
    store.getState().setScreen('title');
    expect(seen).toEqual(['game', 'game']);
  });

  it('selector 投影后的值在无关变更下保持引用相等（避免无效重渲染）', () => {
    const store = createUiStore();
    const notificationsBefore = selectNotifications(store.getState());
    store.getState().pushNotification({ kind: 'system', textKey: 'ui.system.save_ok' });
    const notificationsAfter = selectNotifications(store.getState());
    expect(notificationsAfter).not.toBe(notificationsBefore);

    store.getState().setScreen('panels');
    expect(selectNotifications(store.getState())).toBe(notificationsAfter);
    expect(selectScreen(store.getState())).toBe('panels');
  });
});
