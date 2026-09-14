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

// ---- persistence（§6.7 Dexie 持久化：契约镜像与适配器；任务 10） ---------------
export type { SaveMeta, SaveSlotSummary, SaveVersions } from './persistence/index.js';

// ---- app.title（§6.1 主菜单；FR-UI-06；任务 3） -------------------------------
export { formatSaveSummary, saveDisplayName, TitleScreen, TITLE_ACTIONS } from './app/index.js';
export type { TitleAction, TitleScreenLabels, TitleScreenProps } from './app/index.js';

// ---- text（§6.1 文本渲染管线：sanitize → ReactNode → 打字机；任务 4） ----------
export {
  countRichTextChars,
  createRenderPipeline,
  parseRichText,
  RichText,
  richTextToPlainText,
  sanitizeRichText,
  sliceRichTextNodes,
  TYPEWRITER_BASE_INTERVAL_MS,
  typewriterIntervalMs,
  TypewriterText,
  usePrefersReducedMotion,
  useTypewriter,
} from './text/index.js';
export type {
  RenderInput,
  RenderMedia,
  RenderPipeline,
  RenderPipelineOptions,
  RenderResult,
  RichTextNode,
  RichTextProps,
  TypewriterTextProps,
} from './text/index.js';

// ---- narrative（§6.1/§6.3 叙事区与选择前 checkpoint；FR-READ-03/05；任务 5） -----
export {
  choiceCheckpointLabel,
  createChoiceCheckpoint,
  DEFAULT_NARRATIVE_LABELS,
  describeEnding,
  NarrativeView,
  OptionList,
  withChoiceCheckpoint,
} from './narrative/index.js';
export type {
  CheckpointRuntime,
  ChoiceExecutionResult,
  ChoiceTarget,
  NarrativeLabels,
  NarrativeSegmentEndReason,
  NarrativeSegmentView,
  NarrativeViewProps,
  OptionView,
} from './narrative/index.js';

// ---- panels（§6.4 功能面板：状态面板投影与渲染；FR-UI-03；任务 6） -------------
export {
  DEFAULT_HIGHLIGHT_TTL_MS,
  describeEquipMods,
  projectStatusPanel,
  StatusPanel,
} from './panels/index.js';
export type {
  StatusAttrView,
  StatusEffectView,
  StatusEquipView,
  StatusOutfitView,
  StatusPanelLabels,
  StatusPanelProps,
  StatusPanelView,
  StatusProjectionOptions,
  StatusSkillView,
  StatusWalletView,
} from './panels/index.js';

// ---- panels.map（§6.2 地图导航：区域图/移动消耗/解锁提示；FR-UI-02；任务 7） ----
export { MapPanel, projectAreaViews } from './panels/index.js';
export type {
  MapAreaView,
  MapLocationView,
  MapPanelLabels,
  MapPanelProps,
  MapPosition,
  MapProjectionOptions,
} from './panels/index.js';
