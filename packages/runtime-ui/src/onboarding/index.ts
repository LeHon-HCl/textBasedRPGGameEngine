/**
 * onboarding 切片出口（设计 §6.5 末段首启内容向导；FR-CGRD-04）。
 *
 * 数据投影（needed / warningKey）由引擎 `resolveContentWizard` 提供（22 号），
 * 本切片只承载 UI 流程：警告页 → 标签开关 → 确认/跳过。
 */
export { ContentWizard } from './ContentWizard.js';
export type { ContentWizardLabels, ContentWizardProps } from './ContentWizard.js';
