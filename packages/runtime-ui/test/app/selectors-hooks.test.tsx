import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  createUiStore,
  selectMobileTab,
  selectOpenPanel,
  selectPanels,
  selectPhase,
  selectRuntime,
  selectSceneId,
  selectScreen,
  selectSession,
  selectStatHighlight,
  useUiActions,
  useUiStore,
  UiStoreProvider,
} from '../../src/index.js';
import { EMPTY_SESSION } from '../../src/app/types.js';

/**
 * 25 任务 1 补充：selector 与 hooks 的完整覆盖面。
 *
 * 每个 selector 都是组件的订阅入口（漏测即漏掉一条渲染路径），故逐一断言；
 * hooks 的装配错误路径（缺 Provider）同样显性断言——静默回退全局单例会让
 * 「注入式 store」的可测性承诺失效。
 */

describe('selector 全覆盖（§6.2 细粒度订阅入口）', () => {
  it('每个 selector 投影对应切片且引用稳定', () => {
    const store = createUiStore();
    const state = store.getState();
    expect(selectScreen(state)).toBe('title');
    expect(selectRuntime(state)).toBeNull();
    expect(selectSession(state)).toBe(EMPTY_SESSION);
    expect(selectPhase(state)).toBe('entering');
    expect(selectSceneId(state)).toBe('');
    expect(selectOpenPanel(state)).toBeNull();
    expect(selectMobileTab(state)).toBe('status');
    expect(selectPanels(state)).toBe(state.panels);
    expect(selectStatHighlight('hp')(state)).toBeUndefined();
  });

  it('selectStatHighlight 为按属性的窄订阅（其余属性变化不影响该 selector 值）', () => {
    const store = createUiStore();
    store.getState().noteStatChange({ attr: 'hp', from: 1, to: 2, delta: 1, at: 10 });
    store.getState().noteStatChange({ attr: 'mp', from: 1, to: 2, delta: 1, at: 11 });
    expect(selectStatHighlight('hp')(store.getState())?.delta).toBe(1);
    expect(selectStatHighlight('mp')(store.getState())?.delta).toBe(1);
    expect(selectStatHighlight('none')(store.getState())).toBeUndefined();
  });

  it('selectPhase / selectSceneId 随会话替换更新', () => {
    const store = createUiStore();
    store.getState().setSession({
      phase: 'await_choice',
      sceneId: 'market_street',
      segments: [],
      choices: [],
    });
    expect(selectPhase(store.getState())).toBe('await_choice');
    expect(selectSceneId(store.getState())).toBe('market_street');
  });
});

describe('hooks 边界（§1.3 原则 2 显式注入）', () => {
  it('缺少 Provider 时 useUiStore 抛错（不静默回退全局单例）', () => {
    expect(() => renderHook(() => useUiStore())).toThrow(/UiStoreProvider/);
  });

  it('useUiStore 返回注入的实例（同一 store 供多组件共享）', () => {
    const store = createUiStore();
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <UiStoreProvider store={store}>{children}</UiStoreProvider>
    );
    const { result } = renderHook(() => useUiStore(), { wrapper });
    expect(result.current).toBe(store);
  });

  it('useUiActions 暴露动作面（可写入口）', () => {
    const store = createUiStore();
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <UiStoreProvider store={store}>{children}</UiStoreProvider>
    );
    const { result } = renderHook(() => useUiActions(), { wrapper });
    expect(typeof result.current.pushNotification).toBe('function');
    expect(typeof result.current.setScreen).toBe('function');
  });
});
