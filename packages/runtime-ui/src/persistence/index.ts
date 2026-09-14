/**
 * persistence 切片出口（设计 §5.6 / §6.7，DD-04；25 任务 10）。
 *
 * 契约当前为**本地结构镜像**（types.ts TSDoc 说明原因与 20 号的对接路径）：
 * 20 号合入后 import 源切换为 `@game/engine`，本切片的适配器实现保持不变。
 *
 * 三个产物：
 * - `DexieAdapter`：IndexedDB 实现（原子写 / ProfileStore / kv 标记）；
 * - `MemoryAdapter` + `selectAdapter`/`probeIndexedDb`：隐私模式降级（NFR-10）；
 * - `PrivacyBanner`：降级态的常驻导出提醒。
 */
export { projectSaveMeta } from './types.js';
export type {
  MutableProfile,
  PersistenceAdapter,
  ProfileStore,
  SaveMeta,
  SaveSlotSummary,
  SaveVersions,
} from './types.js';
export {
  MemoryAdapter,
  MEMORY_ADAPTER_NAME,
  PersistenceError,
  PrivacyModeError,
} from './memory-adapter.js';
export { DexieAdapter, DEXIE_ADAPTER_NAME } from './dexie-adapter.js';
export { probeIndexedDb, selectAdapter } from './fallback.js';
export type { AdapterSelection, SelectAdapterOptions, StorageProbeResult } from './fallback.js';
export { PrivacyBanner } from './PrivacyBanner.js';
export type { PrivacyBannerLabels, PrivacyBannerProps } from './PrivacyBanner.js';
