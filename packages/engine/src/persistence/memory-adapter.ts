import { EngineError } from '@game/shared';
import type { SaveBlob } from '@game/shared';
import type { PersistenceAdapter, SaveMeta } from './types.js';

/**
 * 内存持久化适配器（设计 §5.6 / DD-04；20 号任务 2）。
 *
 * 两个用途：
 * - **测试基座**：契约套件（fixtures/helpers）与 SaveService 单测的无 IO 底座；
 * - **隐私模式降级**（NFR-10）：浏览器 IndexedDB 探测失败时由 runtime-ui 顶替
 *   DexieAdapter，配合常驻「请导出存档」横幅（导出/导入是唯一留存路径）。
 *
 * 原子写语义与真实实现一致（契约面，FR-SAVE-05）：写前把旧档副本移入备份位，
 * 再写入新档；写失败（可注入）时旧档保持原样、备份位不变、失败显式抛出。
 * 存取均做深拷贝——调用方与存储互不影响（契约「隔离」面）。
 */

/** 适配器构造选项（写失败注入面：quota 异常路径的测试缝） */
export interface MemoryAdapterOptions {
  /**
   * 写入钩子（每次 write 调用前触发；抛错 = 模拟写失败——quota 异常等场景）。
   * 用于验证「失败不损坏旧档 + 显式上抛」的契约面（NFR-22 / NFR-10）。
   */
  readonly beforeWrite?: (slot: string, blob: SaveBlob) => void;
}

/** 槽位条目（正式档 + 备份位；备份为 undefined = 该槽尚未被覆盖写过） */
interface SlotEntry {
  blob: SaveBlob;
  backup: SaveBlob | undefined;
}

/** 结构化深拷贝（SaveBlob 为纯 JSON 数据；structuredClone 在 Node 与浏览器均可用） */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/** 槽位缺失（SAVE_CORRUPT：定位字段带槽位，便于 UI 提示与诊断） */
function slotMissing(slot: string, operation: string): EngineError {
  return new EngineError({
    code: 'SAVE_CORRUPT',
    where: { slot, operation, detail: '槽位不存在' },
    messageKey: 'error.save.slotMissing',
  });
}

/** SaveMeta 投影（从 blob 派生；listSaves 的映射口径与真实实现共用） */
export function projectSaveMeta(slot: string, blob: SaveBlob): SaveMeta {
  const activeQuests = Object.entries(blob.state.quests)
    .filter(([, quest]) => quest.state === 'active')
    .map(([id]) => id)
    .sort();
  return {
    slot,
    ...(blob.meta.name !== undefined ? { name: blob.meta.name } : {}),
    loop: blob.meta.loop,
    location: blob.meta.location,
    day: blob.meta.day,
    playSeconds: blob.meta.playSeconds,
    createdAt: blob.meta.createdAt,
    versions: {
      engineVersion: blob.engineVersion,
      gameVersion: blob.gameVersion,
      schemaVersion: blob.schemaVersion,
    },
    activeQuests,
  };
}

export class MemoryAdapter implements PersistenceAdapter {
  readonly #slots = new Map<string, SlotEntry>();
  readonly #beforeWrite: ((slot: string, blob: SaveBlob) => void) | undefined;

  constructor(options: MemoryAdapterOptions = {}) {
    this.#beforeWrite = options.beforeWrite;
  }

  /** 已用槽位数（含无备份的槽；测试与容量预估用） */
  get size(): number {
    return this.#slots.size;
  }

  async listSaves(): Promise<SaveMeta[]> {
    return [...this.#slots.entries()]
      .map(([slot, entry]) => projectSaveMeta(slot, entry.blob))
      .sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  }

  async load(slot: string): Promise<SaveBlob> {
    const entry = this.#slots.get(slot);
    if (entry === undefined) throw slotMissing(slot, 'load');
    return clone(entry.blob);
  }

  async write(slot: string, blob: SaveBlob): Promise<void> {
    this.#beforeWrite?.(slot, blob);
    const current = this.#slots.get(slot);
    // 原子写：旧档先入备份位，再替换正式档（顺序即原子性——失败在钩子处抛出时
    // 尚未触碰 map，旧档与备份位保持原样）
    this.#slots.set(slot, {
      blob: clone(blob),
      backup: current === undefined ? undefined : current.blob,
    });
  }

  async remove(slot: string): Promise<void> {
    if (!this.#slots.delete(slot)) throw slotMissing(slot, 'remove');
  }

  async rename(slot: string, name: string): Promise<void> {
    const entry = this.#slots.get(slot);
    if (entry === undefined) throw slotMissing(slot, 'rename');
    // 显示名是唯一可变位（数据不变）；blob.meta.name 为该字段的唯一真相源
    const renamed = clone(entry.blob);
    renamed.meta = { ...renamed.meta, name };
    this.#slots.set(slot, {
      blob: renamed,
      backup: entry.backup === undefined ? undefined : clone(entry.backup),
    });
  }

  async loadBackup(slot: string): Promise<SaveBlob | null> {
    const entry = this.#slots.get(slot);
    if (entry === undefined || entry.backup === undefined) return null;
    return clone(entry.backup);
  }
}
