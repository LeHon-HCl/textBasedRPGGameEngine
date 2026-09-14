import { Dexie } from 'dexie';
import type { Table } from 'dexie';
import type { Profile, SaveBlob } from '@game/shared';
import { projectSaveMeta } from './types.js';
import { PersistenceError, PrivacyModeError } from './memory-adapter.js';
import type { MutableProfile, PersistenceAdapter, ProfileStore, SaveMeta } from './types.js';

/**
 * Dexie（IndexedDB）持久化适配器（设计 §6.7 / DD-04，25 任务 10）。
 *
 * 表结构（§6.7）：
 * - `saves(slot, meta, blob, backup)`——主档与备份同位存放（原子写的实现基础）；
 * - `profile(key, version, data)`——跨存档 Profile（决策 D7，与槽位解耦）；
 * - `kv(key)`——适配器级标记位（如 quota 提示、schema 版本）。
 *
 * 原子写（§6.7「临时键→备份键→正式键」的落地）：在**单个 Dexie 事务**内
 * 先写备份位、再写主档位；事务失败则两处都不落盘——不留半写档。
 * IndexedDB 事务本身提供该原子性，故无需额外的临时键（临时键在文件系统
 * 适配器上才是必需的）。
 *
 * 隐私模式（NFR-10）：构造后首次 IO 前必须 `open()`（探测 + 建表）；失败抛
 * {@link PrivacyModeError}，由宿主经 selectAdapter 回落到 MemoryAdapter。
 */

/** Dexie 适配器标识 */
export const DEXIE_ADAPTER_NAME = 'dexie';

/** saves 表行（slot 为主键） */
interface SaveRow {
  slot: string;
  /** 槽位元信息快照（列表页免加载 blob 即可渲染） */
  meta: SaveMeta;
  blob: SaveBlob;
  /** 写前备份（FR-SAVE-05；首写为 null） */
  backup: SaveBlob | null;
}

/** profile 表行（key 为主键；单例行 key='default'） */
interface ProfileRow {
  key: string;
  /** Profile 自身迁移粒度（FR-MIGR-06） */
  version: number;
  data: Profile;
}

/** kv 表行（适配器级标记） */
interface KvRow {
  key: string;
  value: unknown;
}

/** Profile 单例行键（跨存档 Profile 只有一份） */
const PROFILE_KEY = 'default';

/** Profile 初始档（首次 load 时返回；不写库——读操作无副作用） */
function initialProfile(): Profile {
  return {
    schemaVersion: 1,
    achievements: {},
    points: 0,
    purchasedPerks: [],
    endings: [],
  };
}

/**
 * Dexie 适配器（见模块 TSDoc）。
 *
 * 与 `MemoryAdapter` 行为等价由契约套件保证（test/persistence/contract.ts
 * 对两者各跑一遍）。本类同时实现 `ProfileStore`（§5.6：DexieAdapter implements
 * PersistenceAdapter, ProfileStore）。
 */
export class DexieAdapter implements PersistenceAdapter {
  readonly name = DEXIE_ADAPTER_NAME;
  readonly #db: Dexie;
  readonly #saves: Table<SaveRow, string>;
  readonly #profiles: Table<ProfileRow, string>;
  readonly #kv: Table<KvRow, string>;
  #opened = false;

  /**
   * @param dbName 数据库名（缺省 `tbg-saves`；测试可传唯一名隔离）
   */
  constructor(dbName = 'tbg-saves') {
    this.#db = new Dexie(dbName);
    this.#db.version(1).stores({
      saves: 'slot',
      profile: 'key',
      kv: 'key',
    });
    this.#saves = this.#db.table<SaveRow, string>('saves');
    this.#profiles = this.#db.table<ProfileRow, string>('profile');
    this.#kv = this.#db.table<KvRow, string>('kv');
  }

  /**
   * 打开数据库（探测可用性 + 建表）。
   *
   * @throws PrivacyModeError IndexedDB 不可用（隐私模式）或打开被拒
   */
  async open(): Promise<void> {
    if (this.#opened) return;
    try {
      await this.#db.open();
      this.#opened = true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new PrivacyModeError(`IndexedDB 打开失败：${detail}`);
    }
  }

  /** 关闭连接（宿主在换档/卸载时调用；重复调用安全） */
  close(): void {
    this.#db.close();
    this.#opened = false;
  }

  async listSaves(): Promise<SaveMeta[]> {
    await this.open();
    const rows = await this.#saves.toArray();
    return rows
      .map((row) => row.meta)
      .sort((a, b) => b.createdAt - a.createdAt || a.slot.localeCompare(b.slot));
  }

  async load(slot: string): Promise<SaveBlob> {
    await this.open();
    const row = await this.#saves.get(slot);
    if (row === undefined) {
      throw new PersistenceError(`存档槽 '${slot}' 不存在`);
    }
    return structuredClone(row.blob);
  }

  /**
   * 原子写（单事务：备份位与主档位同时就位）。
   *
   * 事务失败（quota 超限等）时两处都不落盘，旧档保持可读——契约 3 的
   * 「失败不留半写状态」由此实现。
   */
  async write(slot: string, blob: SaveBlob): Promise<void> {
    await this.open();
    const meta = projectSaveMeta(slot, blob);
    await this.#db.transaction('rw', this.#saves, async () => {
      const previous = await this.#saves.get(slot);
      const row: SaveRow = {
        slot,
        meta,
        blob: structuredClone(blob),
        // 覆盖写才有备份；首写 backup 为 null（合法状态，loadBackup 返回 null）
        backup: previous !== undefined ? previous.blob : null,
      };
      await this.#saves.put(row);
    });
  }

  async remove(slot: string): Promise<void> {
    await this.open();
    await this.#saves.delete(slot);
  }

  async rename(slot: string, name: string): Promise<void> {
    await this.open();
    await this.#db.transaction('rw', this.#saves, async () => {
      const row = await this.#saves.get(slot);
      if (row === undefined) {
        throw new PersistenceError(`存档槽 '${slot}' 不存在，无法重命名`);
      }
      await this.#saves.put({
        ...row,
        meta: { ...row.meta, name },
        blob: { ...row.blob, meta: { ...row.blob.meta, name } },
      });
    });
  }

  async loadBackup(slot: string): Promise<SaveBlob | null> {
    await this.open();
    const row = await this.#saves.get(slot);
    if (row === undefined || row.backup === null) return null;
    return structuredClone(row.backup);
  }

  // —— ProfileStore（§5.6；跨存档 Profile，与槽位解耦） ——

  /**
   * Profile 存储门面（设计 §6.7「DexieAdapter implements PersistenceAdapter,
   * ProfileStore」的落地形态）。
   *
   * **as-built 偏差说明**：§5.6 的 `PersistenceAdapter.load(slot)` 与 §5.4 的
   * `ProfileStore.load()` 同名而异签名（`Promise<SaveBlob>` vs `Promise<Profile>`），
   * TypeScript 类无法同时实现两个方法名冲突的接口。此处以**组合**表达
   * 「同一适配器同时提供两种存储」：`adapter.profile` 即 ProfileStore 实例
   * （结构类型，赋值给 `ProfileStore` 参数零成本）。两个接口本身逐字不变，
   * 20 号落地后无需任何调整即可对接。
   */
  readonly profile: ProfileStore<Profile> = {
    load: () => this.#loadProfile(),
    mutate: (fn) => this.#mutateProfile(fn),
  };

  /**
   * 读取 Profile；无记录时返回初始档（不写库——读操作无副作用）。
   */
  async #loadProfile(): Promise<Profile> {
    await this.open();
    const row = await this.#profiles.get(PROFILE_KEY);
    if (row !== undefined) return structuredClone(row.data);
    return initialProfile();
  }

  /**
   * 乐观锁写入：事务内读当前档 → 应用变更 → 写回。
   *
   * IndexedDB 事务对同一对象仓的读改写是串行的，天然满足「写前读版本」的
   * 乐观语义（同一浏览器上下文内无并发丢失更新）；冲突重试策略留给 21 号
   * 迁移面（跨标签页并发场景）。
   */
  async #mutateProfile(fn: (profile: MutableProfile<Profile>) => void): Promise<void> {
    await this.open();
    await this.#db.transaction('rw', this.#profiles, async () => {
      const row = await this.#profiles.get(PROFILE_KEY);
      const current: Profile = row !== undefined ? structuredClone(row.data) : initialProfile();
      fn(current as MutableProfile<Profile>);
      await this.#profiles.put({ key: PROFILE_KEY, version: current.schemaVersion, data: current });
    });
  }

  /** kv 读取（适配器级标记；无记录返回 undefined） */
  async getFlag<T>(key: string): Promise<T | undefined> {
    await this.open();
    const row = await this.#kv.get(key);
    return row?.value as T | undefined;
  }

  /** kv 写入（适配器级标记） */
  async setFlag(key: string, value: unknown): Promise<void> {
    await this.open();
    await this.#kv.put({ key, value });
  }

  /** 清空全部表（仅测试与「重置游戏」路径使用） */
  async clearAll(): Promise<void> {
    await this.open();
    await this.#db.transaction('rw', this.#saves, this.#profiles, this.#kv, async () => {
      await this.#saves.clear();
      await this.#profiles.clear();
      await this.#kv.clear();
    });
  }
}
