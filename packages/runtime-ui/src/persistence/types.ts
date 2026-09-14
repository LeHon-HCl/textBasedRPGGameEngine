import type { SaveBlob } from '@game/shared';
import { projectSaveMeta as engineProjectSaveMeta } from '@game/engine';
import type { PersistenceAdapter as EnginePersistenceAdapter } from '@game/engine';
import type { SaveMeta as EngineSaveMeta } from '@game/engine';

/**
 * 持久化契约（设计 §5.6 / §6.7，DD-04；25 任务 10）。
 *
 * **20 号落地后的对接状态（2026-09-14）**：`SaveMeta` 与 `PersistenceAdapter` 直接
 * 复用 `@game/engine` 的真实导出（此前 20 号并行开发期间为本地结构镜像，现已对齐）。
 * 适配器实现（DexieAdapter / MemoryAdapter）的方法签名与 engine 契约逐一对应，
 * 故实现代码无需改动。
 *
 * 本文件保留的 UI 侧内容（均**不**修改 engine 契约）：
 * - {@link SaveVersions}：三层版本三元组的 UI 别名（engine 内为 SaveMeta.versions 的
 *   内联结构，此处命名以便 UI 侧类型引用）；
 * - {@link SaveSlotSummary}：engine SaveMeta + UI 展示附加字段（备份位提示、槽位类型
 *   口径 `slotName`）——列表分组与「可从备份恢复」提示的数据面。
 */

/** 三层版本号快照（engine SaveMeta.versions 的命名别名，FR-MIGR-01） */
export type SaveVersions = EngineSaveMeta['versions'];

/** engine 的存档槽元信息（UI 侧统一经此别名消费，避免与 engine 定义漂移） */
export type SaveMeta = EngineSaveMeta;

/** engine 的持久化适配器契约（本包适配器的实现基准） */
export type PersistenceAdapter = EnginePersistenceAdapter;

/**
 * UI 侧适配器契约 = engine 契约 + 适配器标识。
 *
 * `name`（`'dexie' | 'memory'`）是 runtime-ui 的诊断扩展：降级提示与调试面板需要
 * 区分当前生效的适配器，engine 契约本身不需要它（引擎不感知平台）。本包两个实现
 * 都提供该字段，故 UI 侧以本类型消费。
 */
export interface UiPersistenceAdapter extends EnginePersistenceAdapter {
  /** 适配器标识（诊断与降级提示用：'dexie' | 'memory'） */
  readonly name: string;
}

/**
 * 存档槽列表项（主菜单/读档面板的展示投影；engine SaveMeta + UI 附加字段）。
 *
 * - `hasBackup`：是否存在备份档（FR-SAVE-05；列表可提示「可从备份恢复」）；
 * - `slotName`：槽位类型口径（`auto` / `quick` / `manual`）——纯展示派生，由
 *   {@link projectSlotName} 从 slot 计算，不进入 engine 契约。
 */
export interface SaveSlotSummary extends EngineSaveMeta {
  /** 是否存在备份档（FR-SAVE-05；列表可提示「可从备份恢复」） */
  readonly hasBackup?: boolean;
  /** 槽位类型口径（列表分组与本地化用；由 slot 派生） */
  readonly slotName?: string;
}

/**
 * Profile 的深可变视图（替代 immer 的 `Draft<T>`）。
 *
 * 设计 §5.6 的 `ProfileStore.mutate` 签名为 `(p: Draft<Profile>) => void`；
 * runtime-ui 不引入 immer（超出已批准的依赖清单），故以本地深可变映射表达
 * 同一语义。`Draft<Profile>` 与本类型的成员逐一对应，ProfileStore 的实现
 * （DexieAdapter）对两者皆可赋值。
 */
export type MutableProfile<T> = {
  -readonly [K in keyof T]: T[K] extends readonly (infer U)[]
    ? U[]
    : T[K] extends object
      ? MutableProfile<T[K]>
      : T[K];
};

/**
 * 跨存档 Profile 存储（§5.6 ProfileStore；决策 D7）。
 *
 * - 与存档槽分离持久化：读档/删档不回收集点数与已解锁成就；
 * - `mutate` 为乐观锁写入（写前读版本，冲突则重试或失败）——实现方保证；
 * - 引擎不直接写 Profile（DD-04 保持引擎无 IO），入账由宿主（runtime-ui）触发。
 *
 * @typeParam TProfile Profile 结构（shared `Profile`；泛型避免本文件 import
 *   其类型而把 18/19 号的领域知识拉进 UI 包，同时保持结构兼容）
 */
export interface ProfileStore<TProfile = unknown> {
  load(): Promise<TProfile>;
  mutate(fn: (profile: MutableProfile<TProfile>) => void): Promise<void>;
}

/** 槽位类型口径（`auto` / `quick` / `manual`；列表分组与本地化用） */
export function projectSlotName(slot: string): 'auto' | 'quick' | 'manual' {
  return slot.startsWith('auto_') ? 'auto' : slot === 'quick' ? 'quick' : 'manual';
}

/**
 * UI 侧的槽位元信息投影：engine {@link SaveMeta} + 展示附加字段。
 *
 * 与 engine `projectSaveMeta` 的分工：engine 版负责从 SaveBlob 派生**领域元信息**
 * （含 activeQuests 等），本函数在其产物上叠加 UI 展示口径（`slotName`），避免重复
 * 实现派生逻辑（单一事实源在 engine）。
 */
export function withSlotDisplayMeta(slot: string, meta: EngineSaveMeta): SaveSlotSummary {
  return { ...meta, slotName: projectSlotName(slot) };
}

/** 便捷组合：直接从 blob 投影 UI 展示用的槽位摘要（engine 投影 + 展示口径） */
export function projectSaveMeta(slot: string, blob: SaveBlob): SaveSlotSummary {
  return withSlotDisplayMeta(slot, engineProjectSaveMeta(slot, blob));
}
