import { DexieAdapter } from './dexie-adapter.js';
import { MemoryAdapter, PrivacyModeError } from './memory-adapter.js';
import type { PersistenceAdapter } from './types.js';

/**
 * 持久化能力探测与降级选择（设计 §6.7 / NFR-10）。
 *
 * 设计原则：**不静默丢档**——探测失败时切换内存适配器，并由宿主呈现常驻
 * 横幅提醒玩家「请导出存档」（PrivacyBanner）。选择逻辑为纯函数（探测与
 * 工厂皆注入），使「不可用 → 降级」「工厂抛错 → 降级」「探测自身抛错 →
 * 降级」三条路径都可在无 IndexedDB 的环境断言。
 */

/** 探测结果（可用性 + 人可读原因） */
export interface StorageProbeResult {
  readonly available: boolean;
  /** 不可用原因（横幅文案源）；available=true 时可有可无 */
  readonly reason?: string;
}

/** 降级选择结果 */
export interface AdapterSelection {
  readonly adapter: PersistenceAdapter;
  /** true = 已降级到内存（数据不跨会话保留，宿主必须呈现提示） */
  readonly degraded: boolean;
  /** 降级原因（degraded=true 时有值） */
  readonly reason?: string;
}

/** selectAdapter 的注入面（全部可替换，便于测试三条降级路径） */
export interface SelectAdapterOptions {
  /** 可用性探测（缺省 {@link probeIndexedDb}） */
  readonly probe?: () => Promise<StorageProbeResult> | StorageProbeResult;
  /** Dexie 适配器工厂（缺省新建并 open；抛错即降级） */
  readonly createDexie?: () => Promise<PersistenceAdapter> | PersistenceAdapter;
  /** 内存适配器工厂（缺省新建） */
  readonly createMemory?: () => PersistenceAdapter;
}

/**
 * 探测 IndexedDB 可用性（不抛错——探测自身失败按不可用处理）。
 *
 * 判定口径：`globalThis.indexedDB` 存在且 `open()` 能建立连接。隐私模式下
 * 某些浏览器的 `open()` 会以异常/超时拒绝，故必须真实尝试一次连接。
 */
export async function probeIndexedDb(): Promise<StorageProbeResult> {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (idb === undefined) {
    return { available: false, reason: '当前环境不提供 IndexedDB' };
  }
  let probeDb: IDBDatabase | null = null;
  try {
    probeDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open('tbg-probe');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开被拒绝'));
      request.onblocked = () => reject(new Error('IndexedDB 打开被阻塞'));
    });
    return { available: true };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    probeDb?.close();
  }
}

/**
 * 选择持久化适配器（见模块 TSDoc）。
 *
 * 降级触发条件（任一）：
 * 1. 探测报告不可用；
 * 2. 探测函数自身抛错（防御式：探测不得成为启动失败点）；
 * 3. Dexie 适配器工厂/open 抛错（含 {@link PrivacyModeError}）。
 *
 * @param options 注入面（缺省走真实探测与真实 Dexie）
 */
export async function selectAdapter(options: SelectAdapterOptions = {}): Promise<AdapterSelection> {
  const probe = options.probe ?? probeIndexedDb;
  const createMemory = options.createMemory ?? (() => new MemoryAdapter());
  const createDexie =
    options.createDexie ??
    (async () => {
      const adapter = new DexieAdapter();
      await adapter.open();
      return adapter;
    });

  let probed: StorageProbeResult;
  try {
    probed = await probe();
  } catch (error) {
    return degradedSelection(
      createMemory(),
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!probed.available) {
    return degradedSelection(createMemory(), probed.reason ?? '浏览器存储不可用');
  }

  try {
    return { adapter: await createDexie(), degraded: false };
  } catch (error) {
    const detail = error instanceof PrivacyModeError ? error.message : String(error);
    return degradedSelection(createMemory(), detail);
  }
}

/** 构造降级结果（统一补全原因文案，避免 undefined 流入横幅） */
function degradedSelection(adapter: PersistenceAdapter, reason: string): AdapterSelection {
  return { adapter, degraded: true, reason };
}
