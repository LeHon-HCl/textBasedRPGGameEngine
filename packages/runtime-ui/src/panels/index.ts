/**
 * panels 切片出口（设计 §6.4 功能面板）。
 *
 * 每个面板 = 纯投影（types.ts）+ 受控组件（*Panel.tsx）：投影可在 node 环境
 * 单测，组件经 Testing Library 测渲染与交互。
 */
export { describeEquipMods, projectStatusPanel } from './types.js';
export { projectHistory } from './history-projection.js';
export type { HistoryGroup, HistoryEntryView, HistoryTextResolver } from './history-projection.js';
export { HistoryPanel } from './HistoryPanel.js';
export type { HistoryPanelProps, HistoryPanelLabels } from './HistoryPanel.js';
export type {
  StatusAttrView,
  StatusEffectView,
  StatusEquipView,
  StatusOutfitView,
  StatusPanelView,
  StatusProjectionOptions,
  StatusSkillView,
  StatusWalletView,
} from './types.js';
export { DEFAULT_HIGHLIGHT_TTL_MS, StatusPanel } from './StatusPanel.js';
export type { StatusPanelLabels, StatusPanelProps } from './StatusPanel.js';
export { projectAreaViews } from './map-projection.js';
export type { MapAreaView, MapLocationView, MapProjectionOptions } from './map-projection.js';
export { MapPanel } from './MapPanel.js';
export type { MapPanelLabels, MapPanelProps, MapPosition } from './MapPanel.js';
export { QuestLogPanel } from './QuestLogPanel.js';
export type { QuestLogLabels, QuestLogPanelProps } from './QuestLogPanel.js';
export { progressPercent, projectAchievementGallery } from './achievements-projection.js';
export type { AchievementGalleryGroup, AchievementGalleryView } from './achievements-projection.js';
export { AchievementGalleryPanel } from './AchievementGalleryPanel.js';
export type {
  AchievementGalleryLabels,
  AchievementGalleryPanelProps,
} from './AchievementGalleryPanel.js';
export { CheckResultPanel, checkResultFromEvent } from './CheckResultPanel.js';
export type {
  CheckResultLabels,
  CheckResultPanelProps,
  CheckResultView,
} from './CheckResultPanel.js';
export { BattlePanel } from './BattlePanel.js';
export type {
  BattleActionOption,
  BattlePanelLabels,
  BattlePanelProps,
  BattlePanelState,
  BattleUnitView,
} from './BattlePanel.js';
export { DebugPanel } from './DebugPanel.js';
export type {
  DebugEventEntry,
  DebugPanelLabels,
  DebugPanelProps,
  DebugWatchEntry,
} from './DebugPanel.js';
export { ShopPanel } from './ShopPanel.js';
export type { ShopPanelLabels, ShopPanelProps } from './ShopPanel.js';
