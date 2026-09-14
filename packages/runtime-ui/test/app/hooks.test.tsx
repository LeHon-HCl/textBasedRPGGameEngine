import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import {
  createUiStore,
  selectNotifications,
  selectScreen,
  UiStoreProvider,
  useUiSelector,
} from '../../src/app/index.js';
import type { UiStoreApi } from '../../src/app/index.js';

/**
 * 25 任务 1：selector 细粒度订阅（设计 §6.2 / NFR-01）。
 *
 * 断言口径为**重渲染次数**：无关切片变更不得惊动只订阅某一 selector 的组件。
 * 这是「细粒度订阅模式」的可执行定义，而不是对 useSyncExternalStore 的实现断言。
 */

/** 渲染计数器：每次函数组件执行 +1（重渲染的可观测证据） */
const renders = { screen: 0, notifications: 0 };

function ScreenProbe(): React.ReactNode {
  const screen = useUiSelector(selectScreen);
  renders.screen += 1;
  return <span data-testid="screen">{screen}</span>;
}

function NotificationProbe(): React.ReactNode {
  const notifications = useUiSelector(selectNotifications);
  renders.notifications += 1;
  return <span data-testid="notification-count">{notifications.length}</span>;
}

function Host({ store }: { store: UiStoreApi }): React.ReactNode {
  return (
    <UiStoreProvider store={store}>
      <ScreenProbe />
      <NotificationProbe />
    </UiStoreProvider>
  );
}

describe('useUiSelector 细粒度订阅', () => {
  it('只有 selector 投影值变化的组件重渲染（无关切片变更不惊动）', () => {
    renders.screen = 0;
    renders.notifications = 0;
    const store = createUiStore();
    render(<Host store={store} />);
    expect(renders.screen).toBe(1);
    expect(renders.notifications).toBe(1);

    // 通知切片变更 → 仅通知组件重渲染
    act(() => {
      store.getState().pushNotification({ kind: 'system', textKey: 'ui.system.ping' });
    });
    expect(screen.getByTestId('notification-count').textContent).toBe('1');
    expect(renders.notifications).toBe(2);
    expect(renders.screen).toBe(1);

    // 屏幕切片变更 → 仅屏幕组件重渲染
    act(() => {
      store.getState().setScreen('game');
    });
    expect(screen.getByTestId('screen').textContent).toBe('game');
    expect(renders.screen).toBe(2);
    expect(renders.notifications).toBe(2);
  });

  it('状态值未变时不触发重渲染（同引用判定）', () => {
    renders.screen = 0;
    const store = createUiStore();
    render(<Host store={store} />);
    act(() => {
      store.getState().setScreen('title');
    });
    expect(renders.screen).toBe(1);
  });
});
