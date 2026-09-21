/**
 * 经济与商店子系统（设计 §5.3，17 号）。
 *
 * S0 阶段（2026-09-21）：仅冻结契约面（{@link ./types.js}）——
 * `ShopService` 实现（条目投影 / 定价 / 交易事务）归 S1/S2 工作包。
 */
export type { ShopEntryView, ShopPrice, ShopService } from './types.js';
