import { EngineError, saveBlobSchema } from '@game/shared';
import type { GameId, SaveBlob } from '@game/shared';
import type { GameRuntime } from '../runtime/index.js';
import type { PersistenceAdapter, SaveMeta } from './types.js';

/**
 * 存档服务（设计 §5.6；20 号模块任务 3–9）。
 *
 * 职责：把运行时状态组装成可持久化的 `SaveBlob`（序列化 + 版本三元组 + RNG
 * 状态 + 元信息），并负责读档的**版本闸门**与迁移入口。持久化本身经
 * {@link PersistenceAdapter} 注入（DD-04：engine 零平台依赖，Node 下用
 * MemoryAdapter，浏览器用 DexieAdapter，§6.7）。
 *
 * 失败语义：
 * - **写失败**（quota 等存储异常）→ 显式抛 `SAVE_CORRUPT`（带槽位与 cause，
 *   不静默——NFR-10 的降级呈现归 UI 层）；
 * - **版本高于引擎能力** → `load` 返回 `{ok:false, reason:'VERSION_UNSUPPORTED'}`
 *   **且不触碰运行时数据**（FR-MIGR-02 / FR-UI-08）；
 * - **版本低于当前** → 走注入的迁移入口（`migrate`，21 号模块的接入点）；
 *   未注入迁移能力时返回 `MIGRATION_FAILED`（不静默接受形状不明的旧档）。
 *
 * 槽位命名：手动槽位由宿主命名；自动槽位固定 `auto_1..3`（环形轮换），
 * 快存槽位固定 `quick`（FR-SAVE-02/03 的「独立槽位」语义）。
 */

/** 自动存档槽位（设计 §5.6「默认保留 3 份」；FR-SAVE-02） */
export const AUTOSAVE_SLOTS = ['auto_1', 'auto_2', 'auto_3'] as const;

/** 快存槽位（FR-SAVE-03 单键快存/快读的独立槽位） */
export const QUICKSAVE_SLOT = 'quick';

/** 自动存档触发点（FR-SAVE-02：时段推进 / 场景进入 / 事件完成） */
export type AutosavePoint = 'slot_advance' | 'scene_enter' | 'event_end';

/** 读档结果（设计 §5.6 LoadResult） */
export type LoadResult =
  | { readonly ok: true; readonly blob: SaveBlob }
  | {
      readonly ok: false;
      readonly reason: 'VERSION_UNSUPPORTED' | 'MIGRATION_FAILED';
      readonly detail: string;
    };

/** 存档输入（每次写入的运行时刻投影；meta 的其余字段由服务从状态派生） */
export interface SaveInput {
  readonly runtime: GameRuntime;
  /** 存档时刻所在场景（FR-SAVE-01「位置」；宿主取 SceneRunner.currentSceneId） */
  readonly location: GameId;
  /** 游玩时长（秒；FR-SAVE-01「游玩时长」，由宿主累计） */
  readonly playSeconds: number;
  /** 槽位显示名（FR-SAVE-06；缺省 = 自动命名） */
  readonly name?: string;
  /** 创建时刻覆盖（缺省 = 时钟；导入/复制场景可指定） */
  readonly createdAt?: number;
}

/** 版本三元组（blob 的版本面；缺省取自运行时状态 versions） */
export interface SaveServiceVersions {
  readonly gameVersion: string;
  readonly schemaVersion: number;
}

/** 存档服务构造选项 */
export interface SaveServiceOptions {
  /** 持久化适配器（必需；实现必须通过 fixtures/helpers 契约套件） */
  readonly adapter: PersistenceAdapter;
  /** 版本来源（缺省 = 每次写入时取运行时状态 versions，保证与状态一致） */
  readonly versions?: SaveServiceVersions;
  /** 引擎实际版本（FR-MIGR-01；缺省取运行时状态的 versions.engineVersion） */
  readonly engineVersion?: string;
  /**
   * 迁移入口（21 号模块接入点）：低版本存档的升级链。
   * 未注入时低版本返回 MIGRATION_FAILED（不静默接受形状不明的旧档）。
   */
  readonly migrate?: (blob: SaveBlob) => Promise<SaveBlob>;
  /**
   * 读档完成回调（23 号 `load_complete` 脚本钩子的挂点，2026-09-25 裁定）：
   * **全部恢复完成后**触发（迁移 → 周目恢复 → 状态就位，DD-10 末环）——
   * 脚本据此重建自己的缓存/派生数据。效果由宿主 ScriptHost 提交。
   */
  readonly onLoadComplete?: () => void;
  /** 时钟（createdAt 来源；缺省 Date.now——测试可注入固定时钟） */
  readonly now?: () => number;
}

/** SaveBlob 文档格式版本（blob 结构级；与 schemaVersion 分离演进） */
const FORMAT_VERSION = 1;

/**
 * 存档服务（设计 §5.6；20 号）。
 *
 * 把运行时状态组装成可持久化的 `SaveBlob`（序列化 + 三层版本 + RNG 状态 +
 * 元信息），并负责读档的**版本闸门**与迁移入口。持久化本身经注入的
 * {@link PersistenceAdapter} 完成（DD-04：engine 零平台依赖）。
 *
 * 失败语义：
 * - 写失败（quota 等存储异常）→ 显式抛 `SAVE_CORRUPT`（带槽位与 cause，不静默）；
 * - 版本高于引擎能力 → `load` 返回 `{ok:false, reason:'VERSION_UNSUPPORTED'}`
 *   **且不触碰运行时数据**（FR-MIGR-02）；
 * - 版本低于当前 → 走注入的 `migrate` 入口（21 号接入点）；未注入则返回
 *   `MIGRATION_FAILED`（不静默接受形状不明的旧档）。
 *
 * 槽位命名：手动槽位由宿主命名；自动槽位固定 {@link AUTOSAVE_SLOTS}（环形轮换），
 * 快存槽位固定 {@link QUICKSAVE_SLOT}。
 */
export class SaveService {
  readonly #adapter: PersistenceAdapter;
  readonly #versions: SaveServiceVersions | undefined;
  readonly #engineVersion: string | undefined;
  readonly #migrate: ((blob: SaveBlob) => Promise<SaveBlob>) | undefined;
  readonly #onLoadComplete: (() => void) | undefined;
  readonly #now: () => number;

  constructor(options: SaveServiceOptions) {
    this.#adapter = options.adapter;
    this.#versions = options.versions;
    this.#engineVersion = options.engineVersion;
    this.#migrate = options.migrate;
    this.#onLoadComplete = options.onLoadComplete;
    this.#now = options.now ?? (() => Date.now());
  }

  /** 注入的适配器（宿主复用同一持久层做 Profile / 槽位清理，§6.7） */
  get adapter(): PersistenceAdapter {
    return this.#adapter;
  }

  /** 槽位元信息列表（UI 存档列表数据源，FR-SAVE-01） */
  async listSaves(): Promise<SaveMeta[]> {
    return this.#adapter.listSaves();
  }

  /** 写入槽位（FR-SAVE-01；写失败显式抛 SAVE_CORRUPT，不静默） */
  async save(slot: string, input: SaveInput): Promise<void> {
    const blob = this.#assemble(input);
    await this.#write(slot, blob);
  }

  /** 自动存档（FR-SAVE-02：三点触发 + auto_1..3 环形轮换） */
  async autosave(point: AutosavePoint, input: SaveInput): Promise<void> {
    const slot = await this.#nextAutosaveSlot();
    const blob = this.#assemble(input);
    await this.#write(slot, blob);
    // point 不落档：触发点是行为语义（何时存），不是档内容（存了什么）——
    // 落档会让同一档因触发点不同而产生无意义差异（读档方也无消费面）
    void point;
  }

  /** 快存（FR-SAVE-03；覆盖单一独立槽位） */
  async quicksave(input: SaveInput): Promise<void> {
    const blob = this.#assemble(input);
    await this.#write(QUICKSAVE_SLOT, blob);
  }

  /** 快读（FR-SAVE-03；无快存槽 → SAVE_CORRUPT 上抛） */
  async quickload(runtime: GameRuntime): Promise<LoadResult> {
    return this.load(QUICKSAVE_SLOT, runtime);
  }

  /**
   * 读档（设计 §5.6）：读取 → 版本闸门 → 迁移（低版本）→ Zod 终验 → 恢复。
   * 版本过高时**不触碰**运行时数据（FR-MIGR-02）。
   */
  async load(slot: string, runtime: GameRuntime): Promise<LoadResult> {
    const stored = await this.#adapter.load(slot);
    const current = this.#currentVersions(runtime);
    if (stored.schemaVersion > current.schemaVersion) {
      return {
        ok: false,
        reason: 'VERSION_UNSUPPORTED',
        detail: `存档 schemaVersion=${stored.schemaVersion} 高于引擎当前 ${current.schemaVersion}（槽位 ${slot}）`,
      };
    }
    let blob = stored;
    if (stored.schemaVersion < current.schemaVersion) {
      if (this.#migrate === undefined) {
        return {
          ok: false,
          reason: 'MIGRATION_FAILED',
          detail: `存档 schemaVersion=${stored.schemaVersion} 低于当前 ${current.schemaVersion}，且未注入迁移入口（槽位 ${slot}）`,
        };
      }
      try {
        blob = await this.#migrate(stored);
      } catch (cause) {
        return {
          ok: false,
          reason: 'MIGRATION_FAILED',
          detail: `迁移失败（槽位 ${slot}）：${cause instanceof Error ? cause.message : String(cause)}`,
        };
      }
    }
    const validated = this.#validate(blob, slot);
    runtime.restore(validated);
    // 读档完成钩子（全部恢复完成后触发，DD-10 末环；2026-09-25 裁定）
    this.#onLoadComplete?.();
    return { ok: true, blob: validated };
  }

  /** 读取槽位 blob（不恢复；UI 预览、导出、诊断用） */
  async loadBlob(slot: string): Promise<SaveBlob> {
    return this.#validate(await this.#adapter.load(slot), slot);
  }

  /** 导出槽位（FR-SAVE-04：blob 即 JSON 文档，由宿主写文件/下载） */
  async exportSlot(slot: string): Promise<SaveBlob> {
    return this.loadBlob(slot);
  }

  /**
   * 导入存档（FR-SAVE-04）：结构校验 → 迁移入口（与 load 同一路径）→ 恢复。
   * 不写槽位（纯恢复路径，可复用于文件选择后的预览）。
   */
  async importSlot(blob: unknown, runtime: GameRuntime): Promise<LoadResult> {
    const parsed = this.#validateUnknown(blob, 'import');
    const current = this.#currentVersions(runtime);
    if (parsed.schemaVersion > current.schemaVersion) {
      return {
        ok: false,
        reason: 'VERSION_UNSUPPORTED',
        detail: `导入档 schemaVersion=${parsed.schemaVersion} 高于引擎当前 ${current.schemaVersion}`,
      };
    }
    let migrated = parsed;
    if (parsed.schemaVersion < current.schemaVersion) {
      if (this.#migrate === undefined) {
        return {
          ok: false,
          reason: 'MIGRATION_FAILED',
          detail: `导入档 schemaVersion=${parsed.schemaVersion} 低于当前 ${current.schemaVersion}，且未注入迁移入口`,
        };
      }
      try {
        migrated = await this.#migrate(parsed);
      } catch (cause) {
        return {
          ok: false,
          reason: 'MIGRATION_FAILED',
          detail: `迁移失败：${cause instanceof Error ? cause.message : String(cause)}`,
        };
      }
    }
    runtime.restore(migrated);
    return { ok: true, blob: migrated };
  }

  /**
   * 从写前备份恢复槽位（FR-SAVE-05 的人工救援路径）。
   * 无备份 → false（无备份不是错误）；有备份 → 写回正式位（旧正式档随之入
   * 备份位，操作本身可再撤销一次）。
   */
  async restoreBackup(slot: string): Promise<boolean> {
    const backup = await this.#adapter.loadBackup(slot);
    if (backup === null) return false;
    await this.#write(slot, backup);
    return true;
  }

  /** 重命名槽位显示名（FR-SAVE-06；二次确认归 UI 层，服务层为纯操作） */
  async rename(slot: string, name: string): Promise<void> {
    await this.#adapter.rename(slot, name);
  }

  /** 删除槽位（FR-SAVE-06；含备份） */
  async remove(slot: string): Promise<void> {
    await this.#adapter.remove(slot);
  }

  // —— 内部管线 ————————————————————————————————————————————————————

  /** SaveBlob 组装（序列化 + 版本三元组 + RNG 状态 + meta 投影） */
  #assemble(input: SaveInput): SaveBlob {
    const versions = this.#currentVersions(input.runtime);
    const state = input.runtime.serialize();
    const engineVersion = this.#engineVersion ?? input.runtime.state.versions.engineVersion;
    return {
      formatVersion: FORMAT_VERSION,
      engineVersion,
      gameVersion: versions.gameVersion,
      schemaVersion: versions.schemaVersion,
      state,
      rngState: input.runtime.rng.getState(),
      meta: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        createdAt: input.createdAt ?? this.#now(),
        playSeconds: input.playSeconds,
        location: input.location,
        day: state.world.time.day,
        loop: state.loop,
      },
    };
  }

  /** 写入（适配器异常统一包装为 SAVE_CORRUPT；engine 自身的 SAVE_CORRUPT 透传） */
  async #write(slot: string, blob: SaveBlob): Promise<void> {
    try {
      await this.#adapter.write(slot, blob);
    } catch (cause) {
      if (cause instanceof EngineError && cause.code === 'SAVE_CORRUPT') throw cause;
      throw new EngineError({
        code: 'SAVE_CORRUPT',
        where: {
          slot,
          operation: 'write',
          detail: cause instanceof Error ? cause.message : String(cause),
        },
        messageKey: 'error.save.writeFailed',
        cause,
      });
    }
  }

  /**
   * 当前版本三元组（显式注入优先；否则取运行时状态——versions 挂在 GameState
   * 而非序列化投影上，§3.1「序列化后由 SaveBlob 顶层字段承载」）。
   */
  #currentVersions(runtime: GameRuntime): SaveServiceVersions {
    if (this.#versions !== undefined) return this.#versions;
    const versions = runtime.state.versions;
    return { gameVersion: versions.gameVersion, schemaVersion: versions.schemaVersion };
  }

  /** 下一次自动存档槽位：先补空缺（保持槽位集连续），满则覆盖最旧一份 */
  async #nextAutosaveSlot(): Promise<string> {
    const saves = await this.#adapter.listSaves();
    const autosaves = saves.filter((meta) =>
      (AUTOSAVE_SLOTS as readonly string[]).includes(meta.slot),
    );
    const used = new Set(autosaves.map((meta) => meta.slot));
    const empty = AUTOSAVE_SLOTS.find((slot) => !used.has(slot));
    if (empty !== undefined) return empty;
    // 覆盖最旧：createdAt 升序，同刻按槽位序（写入密集时 createdAt 可能同毫秒）
    const oldest = [...autosaves].sort(
      (a, b) => a.createdAt - b.createdAt || compareSlots(a.slot, b.slot),
    )[0];
    // 不可达：AUTOSAVE_SLOTS 非空且全部命中时 oldest 必有值
    return oldest?.slot ?? AUTOSAVE_SLOTS[0];
  }

  /** Zod 终验（形状非法 → SAVE_CORRUPT：档内容不可信，不静默） */
  #validate(blob: SaveBlob, slot: string): SaveBlob {
    return this.#validateUnknown(blob, slot);
  }

  #validateUnknown(value: unknown, slot: string): SaveBlob {
    const result = saveBlobSchema.safeParse(value);
    if (!result.success) {
      throw new EngineError({
        code: 'SAVE_CORRUPT',
        where: {
          slot,
          operation: 'validate',
          detail: result.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        },
        messageKey: 'error.save.invalidBlob',
        cause: result.error,
      });
    }
    return result.data;
  }
}

/** 槽位字典序（自动槽位补位/覆盖的确定性次序） */
function compareSlots(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
