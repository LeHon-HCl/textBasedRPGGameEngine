/**
 * settings 切片出口（设计 §6.5 设置与内容分级面板；FR-UI-05）。
 *
 * SettingsPanel 为受控表单：设置由宿主持有，变更经 onChange 上抛；
 * 标签开关只报告新的 disabledTags，ContentFilter 重建归宿主（FR-CGRD-03）。
 */
export { DEFAULT_SHORTCUT_HINTS, SettingsPanel } from './SettingsPanel.js';
export type { SettingsPanelLabels, SettingsPanelProps, ShortcutHint } from './SettingsPanel.js';
