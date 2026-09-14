import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import {
  EMPTY_SESSION,
  initialUiState,
  type UiActions,
  type UiState,
  type UiStoreApi,
} from './types.js';

/**
 * UiStore 工厂（设计 §6.2「Zustand 状态容器」，25 任务 1）。
 *
 * 用 vanilla `createStore` 而非 React `create`：store 是纯状态容器，React 绑定
 * 在 `useUiStore` 里做一层薄包装——组件测试可直接构造实例注入，不依赖全局单例
 * （设计 §1.3 原则 2「显式注入」的 UI 侧对应物）。
 *
 * 不变式：
 * - 每个实例独立（`createUiStore()` 返回全新快照），互不共享状态；
 * - 未变更切片的引用保持稳定（`setState` 只替换变化的键），selector 细粒度
 *   订阅据此跳过无关重渲染（NFR-01）；
 * - 同一 slice 的读写不做深拷贝——上层的 SessionView 等由宿主在投影时新建。
 */

/** 通知 id 分配器：进程内单调递增，保证 React key 稳定（跨实例唯一即可） */
let notificationIdSeq = 1;

/** 重置 id 分配器（仅测试使用；避免用例间 id 断言受执行顺序影响） */
export function resetNotificationIds(seed = 1): void {
  notificationIdSeq = seed;
}

/**
 * 创建 UiStore 实例（Zustand vanilla）。
 *
 * @returns store API：`getState()` 同时暴露状态与动作（动作即变更入口）；
 *   `subscribe(listener)` 为整树订阅（组件侧应配合 selector 使用）。
 */
export function createUiStore(): UiStoreApi {
  const store = createStore<UiState & UiActions>()((set, get) => ({
    ...initialUiState(),

    setScreen: (screen) => {
      set({ screen });
    },
    setRuntime: (runtime) => {
      set({ runtime });
    },
    setSession: (session) => {
      // 值未变时保持原引用：宿主每帧投影新对象，此处挡住无差异的替换，
      // 让订阅 session 的组件免于无效重渲染（NFR-01）
      if (get().session === session) return;
      set({ session });
    },
    openPanel: (panel) => {
      set((state) => ({ panels: { ...state.panels, open: panel } }));
    },
    setMobileTab: (tab) => {
      set((state) => ({ panels: { ...state.panels, mobileTab: tab } }));
    },
    pushNotification: (item) => {
      set((state) => ({
        notifications: [
          ...state.notifications,
          {
            id: notificationIdSeq++,
            kind: item.kind,
            textKey: item.textKey,
            ...(item.vars !== undefined ? { vars: item.vars } : {}),
            count: 1,
            at: item.at ?? Date.now(),
          },
        ],
      }));
    },
    dismissNotification: (id) => {
      set((state) => ({
        notifications: state.notifications.filter((entry) => entry.id !== id),
      }));
    },
    clearNotifications: () => {
      set({ notifications: [] });
    },
    noteStatChange: (change) => {
      set((state) => ({
        // 同属性连续变化覆盖为最新一条（高亮表达「最近一次增减」，不排队）
        statHighlights: {
          ...state.statHighlights,
          [change.attr]: {
            from: change.from,
            to: change.to,
            delta: change.delta,
            at: change.at ?? Date.now(),
          },
        },
      }));
    },
    clearStatHighlights: (attrs) => {
      if (attrs === undefined) {
        if (Object.keys(get().statHighlights).length === 0) return;
        set({ statHighlights: {} });
        return;
      }
      const current = get().statHighlights;
      const next: Record<string, (typeof current)[string]> = {};
      for (const [key, value] of Object.entries(current)) {
        if (!attrs.includes(key)) next[key] = value;
      }
      set({ statHighlights: next });
    },
    bumpQuestRevision: () => {
      set((state) => ({ questRevision: state.questRevision + 1 }));
    },
    reset: () => {
      set(initialUiState());
    },
  }));
  return store as StoreApi<UiState & UiActions>;
}

/** 便于测试断言的会话缺省再导出（组件与测试共用同一常量） */
export { EMPTY_SESSION };
