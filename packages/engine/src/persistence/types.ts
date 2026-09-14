import type { GameId, SaveBlob, TextKey } from '@game/shared';

/**
 * 持久化适配器契约（设计 §5.6 / DD-04；20 号模块）。
 *
 * 依赖倒置：engine 只定义接口，实现由宿主提供——
 * - `MemoryAdapter`（本子系统，隐私模式降级 + 测试基座）；
 * - `DexieAdapter`（runtime-ui，§6.7，原子写：临时键 → 备份键 → 正式键）。
 *
 * 原子性要求（FR-SAVE-05 / NFR-22）：`write` 必须原子——覆盖写前把旧档移入
 * 备份位（`loadBackup` 可读回），中途失败时旧档保持完整可读且失败显式抛出
 * （不静默、不半写）。契约由 fixtures/helpers 的公共用例集守护
 * （`describePersistenceAdapterContract`），任何实现必须全过。
 */

/** 槽位元信息（设计 §5.6 SaveMeta；listSaves 投影面，UI 存档列表数据源） */
export interface SaveMeta {
  /** 槽位 id（'slot_1' / 'auto_1' / 'quick' 等，宿主命名） */
  readonly slot: string;
  /** 槽位显示名（缺省 = 自动命名；FR-SAVE-06 可重命名） */
  readonly name?: string;
  /** 周目数（FR-UI-08 版本提示与列表展示） */
  readonly loop: number;
  /** 存档时刻所在场景（FR-SAVE-01「位置」） */
  readonly location: GameId;
  /** 存档时刻的天（FR-SAVE-01「时间」） */
  readonly day: number;
  /** 游玩时长（秒，FR-SAVE-01「游玩时长」） */
  readonly playSeconds: number;
  /** 创建时刻（epoch 毫秒） */
  readonly createdAt: number;
  /** 三层版本快照（FR-MIGR-01；列表页兼容性标记数据源） */
  readonly versions: {
    readonly engineVersion: string;
    readonly gameVersion: string;
    readonly schemaVersion: number;
  };
  /**
   * 活动任务摘要（FR-SAVE-01「任务摘要」）。
   * 存任务 id（UI 经 QuestDef + TextResolver 取显示名）——设计 §5.6 写作
   * TextKey[]，但任务显示名的键在 QuestDef 内、需随定义解析，存 id 是唯一
   * 无定义依赖的可投影形态（实现记录偏差，21 号迁移不受影响）。
   */
  readonly activeQuests: readonly TextKey[];
}

/** 持久化适配器（设计 §5.6；实现必须满足 fixtures/helpers 契约套件） */
export interface PersistenceAdapter {
  /** 全部槽位元信息（键序确定 = 槽位字典序；空存储返回空数组） */
  listSaves(): Promise<SaveMeta[]>;
  /** 读取槽位（未知槽位抛 SAVE_CORRUPT） */
  load(slot: string): Promise<SaveBlob>;
  /** 原子写入（临时键 + 备份键；失败显式抛出，FR-SAVE-05） */
  write(slot: string, blob: SaveBlob): Promise<void>;
  /** 删除槽位与备份（未知槽位抛 SAVE_CORRUPT） */
  remove(slot: string): Promise<void>;
  /** 重命名槽位显示名（数据不变；未知槽位抛 SAVE_CORRUPT） */
  rename(slot: string, name: string): Promise<void>;
  /** 写前备份读取（FR-SAVE-05；无备份返回 null——无备份不是错误） */
  loadBackup(slot: string): Promise<SaveBlob | null>;
}
