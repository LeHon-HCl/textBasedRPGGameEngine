/**
 * persistence 子系统出口（存档服务与持久化适配器契约，设计 §5.6 / DD-04；
 * 20 号模块；路径取设计 §9.2 目录树的 `engine/src/persistence/`）。
 *
 * 经 `@game/engine` 根出口对外发布（§10.4 导出约定）；子系统内部仅此文件
 * 对外暴露实现，横向子系统不得深入本目录路径（DD-06）。
 */
export { MemoryAdapter, projectSaveMeta } from './memory-adapter.js';
export type { MemoryAdapterOptions } from './memory-adapter.js';
export { AUTOSAVE_SLOTS, QUICKSAVE_SLOT, SaveService } from './service.js';
export type {
  AutosavePoint,
  LoadResult,
  SaveInput,
  SaveServiceOptions,
  SaveServiceVersions,
} from './service.js';
export type { PersistenceAdapter, SaveMeta } from './types.js';
