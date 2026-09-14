import type { SaveBlob } from '@game/shared';
import { projectSaveMeta } from './types.js';
import type { PersistenceAdapter, SaveMeta } from './types.js';

/**
 * 内存持久化适配器（设计 §5.6 / NFR-10）。
 *
 * 用途有二：
 * 1. **测试替身**：与 DexieAdapter 跑同一份契约套件（contract.ts），
 *    保证「降级不改变语义」；
 * 2. **隐私模式降级实现**（NFR-10）：IndexedDB 不可用时承载本次会话的存档，
 *    并由宿主呈现常驻导出提醒（数据不跨会话保留的事实必须显性告知）。
 *
 * 不变式：写入为「全量替换」；覆盖写把旧档放进备份位（同时只保留一代备份，
 * 与 §5.6「写前备份」的单代语义一致）；`failNextWrite` 为测试注入的失败点
 * （模拟 QuotaExceededError），命中一次后自动复位。
 */

/** 适配器标识（宿主据此判断是否需要「数据不保留」提示） */
export const MEMORY_ADAPTER_NAME = 'memory';

/** 槽位条目（主档 + 备份分开存放，语义与 Dexie 表结构一致） */
interface SlotRecord {
  blob: SaveBlob;
  backup: SaveBlob | null;
}

/** 持久化层错误（UI 包内自有的错误类型；不引入 engine 的 EngineError 语义） */
export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

/** 隐私模式/存储不可用错误（探测与降级路径的显性原因载体） */
export class PrivacyModeError extends PersistenceError {
  constructor(message: string) {
    super(message);
    this.name = 'PrivacyModeError';
  }
}

/**
 * 内存适配器（见模块 TSDoc）。
 *
 * 存储形态为进程内 Map：实例销毁即数据消失——这正是隐私模式下降级所
 * 表达的语义，宿主必须以常驻横幅告知玩家（NFR-10「不静默丢档」）。
 */
export class MemoryAdapter implements PersistenceAdapter {
  readonly name = MEMORY_ADAPTER_NAME;
  readonly #slots = new Map<string, SlotRecord>();
  /** 下一次写入的注入失败（测试用；命中后清空） */
  #failNextWrite: Error | null = null;

  /**
   * 注入一次写入失败（测试模拟 quota 超限等场景）。
   * 生产代码不应调用——失败注入是测试缝，不是降级策略。
   */
  failNextWrite(error: Error): void {
    this.#failNextWrite = error;
  }

  async listSaves(): Promise<SaveMeta[]> {
    return [...this.#slots.entries()]
      .map(([slot, record]) => projectSaveMeta(slot, record.blob))
      .sort((a, b) => b.createdAt - a.createdAt || a.slot.localeCompare(b.slot));
  }

  async load(slot: string): Promise<SaveBlob> {
    const record = this.#slots.get(slot);
    if (record === undefined) {
      throw new PersistenceError(`存档槽 '${slot}' 不存在`);
    }
    // 返回深拷贝：调用方（引擎 restore）不得经引用改写适配器内部状态
    return structuredClone(record.blob);
  }

  async write(slot: string, blob: SaveBlob): Promise<void> {
    const failure = this.#consumeFailure();
    if (failure !== null) throw failure;
    const previous = this.#slots.get(slot);
    // 原子写语义：新档与备份位同时就位（内存实现天然原子——无中间态可观测）
    this.#slots.set(slot, {
      blob: structuredClone(blob),
      backup: previous !== undefined ? previous.blob : null,
    });
  }

  async remove(slot: string): Promise<void> {
    this.#slots.delete(slot);
  }

  async rename(slot: string, name: string): Promise<void> {
    const record = this.#slots.get(slot);
    if (record === undefined) {
      throw new PersistenceError(`存档槽 '${slot}' 不存在，无法重命名`);
    }
    this.#slots.set(slot, {
      blob: { ...record.blob, meta: { ...record.blob.meta, name } },
      backup: record.backup,
    });
  }

  async loadBackup(slot: string): Promise<SaveBlob | null> {
    const record = this.#slots.get(slot);
    if (record === undefined || record.backup === null) return null;
    return structuredClone(record.backup);
  }

  /** 取出并复位注入的失败（一次性） */
  #consumeFailure(): Error | null {
    const failure = this.#failNextWrite;
    this.#failNextWrite = null;
    return failure;
  }
}
