/**
 * @game/runtime-ui 公开 API 唯一出口（导出约定，设计 §10.4）。
 *
 * 约定（与 engine 同规）：
 * - 包外只允许从包名 `@game/runtime-ui` 导入，禁止深入包内文件路径；
 * - 各切片（app / text / panels / notifications / persistence / onboarding）
 *   的公开类型与组件先在自身目录中定义，再经此处统一 re-export；
 * - runtime-ui 是**浏览器包**：允许 React 与 DOM（设计 §1.2 R2 只约束 engine），
 *   但不得为 UI 方便改动 engine 的内部语义——引擎能力一律经其公开 API 消费。
 */

// ---- app（§6.2 应用外壳与状态订阅：UiStore / 事件桥 / selector 细粒度订阅） ----
export {
  bridgeRuntimeEvents,
  createUiStore,
  EMPTY_SESSION,
  initialUiState,
  resetNotificationIds,
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
  UiStoreContext,
  UiStoreProvider,
  useUiActions,
  useUiSelector,
  useUiStore,
} from './app/index.js';
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
  UiStoreProviderProps,
} from './app/index.js';

// ---- app.shell（§6.2 响应式外壳：双栏 / 窄屏 Tab；FR-UI-01/09） --------------
export {
  AppShell,
  MobileTabBar,
  NARROW_BREAKPOINT_PX,
  TOUCH_TARGET_PX,
  useIsNarrow,
} from './app/index.js';
export type { AppShellProps } from './app/index.js';
