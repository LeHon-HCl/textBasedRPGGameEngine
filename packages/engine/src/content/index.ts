/**
 * content 子系统出口（内容分级与过滤，设计 §5.8；22 号模块）。
 *
 * 经 `@game/engine` 根出口对外发布（§10.4 导出约定）；子系统内部仅此文件
 * 对外暴露实现，横向子系统不得深入本目录路径（DD-06）。
 */
export { ContentFilter } from './filter.js';
export type { ContentFilterOptions, ContentFilterSettings } from './filter.js';
