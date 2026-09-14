/**
 * persistence 切片出口（设计 §5.6 / §6.7，DD-04）。
 *
 * 当前只发布**契约的本地结构镜像**（20 号落地前的解耦手段）与 Dexie 适配器；
 * 20 号模块合入后，接口 import 源切换为 `@game/engine`，本切片保留适配器实现。
 */
export type { SaveMeta, SaveSlotSummary, SaveVersions } from './types.js';
