import { useContext, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { UiStoreContext } from './context.js';
import type { UiActions, UiState, UiStoreApi } from './types.js';

/**
 * React 绑定层（设计 §6.2「组件用 selector 细粒度订阅」，NFR-01）。
 *
 * 实现走 React 18 的 `useSyncExternalStore`：以 store 的 subscribe 为订阅源、
 * 以 selector 结果为快照——只有 selector 返回值**引用变化**时才触发重渲染
 * （store 未变更切片的引用保持稳定，见 store.ts 不变式），因此
 * 「状态面板变更不惊动叙事区」这类细粒度行为由选择器粒度直接决定。
 *
 * 测试与宿主共用同一注入缝：`UiStoreProvider` 传入实例，组件经
 * `useUiStore`/`useUiSelector` 消费，无需模块级单例（可测性 §1.3 原则 2）。
 */

/** 取当前注入的 store 实例；未包裹 Provider 时抛错（装配缺陷显性化） */
export function useUiStore(): UiStoreApi {
  const store = useContext(UiStoreContext);
  if (store === null) {
    throw new Error('useUiStore 必须在 <UiStoreProvider> 内使用');
  }
  return store;
}

/**
 * 细粒度订阅单个 selector。
 *
 * @param selector 纯投影函数（返回稳定引用；派生新对象会破坏跳过重渲染的前提）
 * @returns selector 投影值；仅当该值引用变化时触发重渲染
 */
export function useUiSelector<T>(selector: (state: UiState & UiActions) => T): T {
  const store = useUiStore();
  // selector 常以内联箭头函数传入（每次渲染新建），若直接作快照函数会导致
  // getSnapshot 每次返回不同引用。此处以 ref 持有最新 selector，订阅源保持稳定
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  return useSyncExternalStore(
    store.subscribe,
    () => selectorRef.current(store.getState()),
    () => selectorRef.current(store.getState()),
  );
}

/** 动作访问器：动作恒稳定，取一次即可（组件内无需依赖 state 变化重取） */
export function useUiActions(): UiActions {
  return useUiStore().getState();
}

/** Provider 属性（测试与宿主同形：显式注入 store 实例） */
export interface UiStoreProviderProps {
  readonly store: UiStoreApi;
  readonly children: ReactNode;
}

/**
 * store 注入 Provider（`context.ts` 定义 Context 本体，避免与 hooks 循环引用）。
 * 嵌套 Provider 时内层生效（测试内可局部替换 store）。
 */
export function UiStoreProvider({ store, children }: UiStoreProviderProps): ReactNode {
  return <UiStoreContext.Provider value={store}>{children}</UiStoreContext.Provider>;
}
