/**
 * 经济与商店子系统（设计 §5.3，17 号）。
 *
 * - S0（2026-09-21）：契约面（{@link ./types.js}）；
 * - S1：投影与定价（{@link ./shop-service.js}）；
 * - S2：交易事务（{@link ./trade.js}——buy/sell 经 GameRuntime 效果指令批次
 *   执行，原子性由事务底座保证）。
 */
export type { ShopEntryView, ShopPrice, ShopService } from './types.js';
export { createShopProjection } from './shop-service.js';
export type { ShopServiceOptions, ShopServiceProjection } from './shop-service.js';
export { createShopService } from './trade.js';
export type { ShopServiceDeps } from './trade.js';
