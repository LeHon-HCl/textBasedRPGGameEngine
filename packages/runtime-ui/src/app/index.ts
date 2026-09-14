/**
 * app 切片出口（设计 §6.2：应用外壳与状态订阅）。
 *
 * 只导出 UiStore 相关面（类型/工厂/selector/事件桥）；React 绑定
 * （`useUiStore`/`useUiSelector`）在 hooks.ts，组件树在 components/。
 */
export { EMPTY_SESSION, bridgeRuntimeEvents, initialUiState } from './types.js';
export type {
  MobileTab,
  PanelId,
  PanelsSlice,
  Screen,
  SessionChoiceView,
  SessionMediaView,
  SessionSegmentView,
  SessionView,
  StatHighlight,
  ToastItem,
  ToastKind,
  UiActions,
  UiState,
  UiStoreApi,
} from './types.js';
export { createUiStore, resetNotificationIds } from './store.js';
export {
  selectMobileTab,
  selectNotifications,
  selectOpenPanel,
  selectPanels,
  selectPhase,
  selectQuestRevision,
  selectRuntime,
  selectSceneId,
  selectScreen,
  selectSession,
  selectStatHighlight,
  selectStatHighlights,
} from './selectors.js';
export { UiStoreContext } from './context.js';
export { UiStoreProvider, useUiActions, useUiSelector, useUiStore } from './hooks.js';
export type { UiStoreProviderProps } from './hooks.js';
export {
  AppShell,
  MobileTabBar,
  NARROW_BREAKPOINT_PX,
  TOUCH_TARGET_PX,
  useIsNarrow,
} from './AppShell.js';
export type { AppShellProps } from './AppShell.js';
export { formatSaveSummary, saveDisplayName, TitleScreen, TITLE_ACTIONS } from './TitleScreen.js';
export type { TitleAction, TitleScreenLabels, TitleScreenProps } from './TitleScreen.js';
export type { SaveSlotSummary, SaveVersions } from '../persistence/types.js';
