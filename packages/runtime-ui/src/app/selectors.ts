import type { GameId } from '@game/shared';
import type {
  MobileTab,
  PanelId,
  Screen,
  SessionView,
  StatHighlight,
  ToastItem,
  UiState,
} from './types.js';

/**
 * UiStore selector 集（设计 §6.2「组件用 selector 细粒度订阅」，NFR-01）。
 *
 * 约定：selector 为**纯投影**——不派生新对象/数组（除已存在的切片），
 * 因此同一切片未变更时返回值引用稳定，Zustand 的 `Object.is` 比较即可跳过
 * 重渲染。需要聚合多切片的场景在此以独立 selector 集中表达，避免组件内
 * 内联 selector 造成重复派生（同型选择器只有一份）。
 */

/** 当前屏幕（§6.2 screen） */
export function selectScreen(state: UiState): Screen {
  return state.screen;
}

/** 当前运行时（null = 未开局） */
export function selectRuntime(state: UiState): UiState['runtime'] {
  return state.runtime;
}

/** 会话投影（§6.2 session） */
export function selectSession(state: UiState): SessionView {
  return state.session;
}

/** 通知队列（§6.2 notifications；FR-UI-07） */
export function selectNotifications(state: UiState): readonly ToastItem[] {
  return state.notifications;
}

/** 当前打开的面板（null = 无） */
export function selectOpenPanel(state: UiState): PanelId | null {
  return state.panels.open;
}

/** 移动端 Tab（FR-UI-09） */
export function selectMobileTab(state: UiState): MobileTab {
  return state.panels.mobileTab;
}

/** 面板切片整体（需要同时读 open + mobileTab 时用，保持单次订阅） */
export function selectPanels(state: UiState): UiState['panels'] {
  return state.panels;
}

/** 数值高亮表（FR-STAT-04） */
export function selectStatHighlights(state: UiState): Readonly<Record<string, StatHighlight>> {
  return state.statHighlights;
}

/** 单个属性的高亮（无则 undefined；组件按属性订阅） */
export function selectStatHighlight(attr: string): (state: UiState) => StatHighlight | undefined {
  return (state) => state.statHighlights[attr];
}

/** 任务面板重算信号（单调递增） */
export function selectQuestRevision(state: UiState): number {
  return state.questRevision;
}

/** 当前场景 id（会话切片的窄投影，供 ClockBadge 等窄订阅） */
export function selectSceneId(state: UiState): GameId {
  return state.session.sceneId;
}

/** 当前会话相位（推进按钮的显隐判据） */
export function selectPhase(state: UiState): SessionView['phase'] {
  return state.session.phase;
}
