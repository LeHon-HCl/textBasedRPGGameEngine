import type { SaveBlob, TextKey } from '@game/shared';

/**
 * 持久化契约的**本地结构镜像**（设计 §5.6 / §6.7，DD-04；25 任务 10）。
 *
 * 为什么在 runtime-ui 侧镜像而非从 engine 导入：20 号（存档系统）与本模块并行
 * 开发，engine 尚未落地 `engine/src/persistence/adapter.ts` 与
 * `PersistenceAdapter` 导出。此处按 §5.6 的接口签名做**结构等价**的本地定义，
 * 保证：
 * - 本模块现在即可编译、测试（两个适配器可独立验证）；
 * - **20 号落地后零成本对接**——TS 结构类型 + 适配器方法签名逐一对应，
 *   届时把 import 源换成 `@game/engine` 即可，适配器实现不变。
 *
 * 与 §5.6 的一处必要差异：`SaveMeta.versions`。设计中写作 `SaveBlob['versions']`，
 * 但 as-built 的 shared `saveBlobSchema` 把三层版本平铺在 blob 顶层
 * （engineVersion / gameVersion / schemaVersion），并无嵌套 versions 字段。
 * 故此处以 {@link SaveVersions} 三元组表达同一信息，字段名与 shared 逐字一致。
 */

/** 三层版本号快照（对应 shared SaveBlob 顶层的三个版本字段，FR-MIGR-01） */
export interface SaveVersions {
  /** 引擎实际版本 */
  readonly engineVersion: string;
  readonly gameVersion: string;
  /** 全包单一 schema 版本（DD-07） */
  readonly schemaVersion: number;
}

/**
 * 存档槽元信息（§5.6 SaveMeta 的结构镜像；SaveBlob.meta 的投影）。
 *
 * 不变式：
 * - `slot` 为槽位 id（`auto_1..3` / `quick` / 玩家自定名），同档内唯一；
 * - `name` 为玩家可见显示名（缺省由宿主生成，如「自动存档 1」）；
 * - `slotName` 为槽位类型/编号的展示口径（列表分组用），与 `slot` 同源但
 *   可独立本地化；
 * - `questSummary` 为文本键（D4：数据与文本分离），UI 侧经 TextResolver 物化。
 */
export interface SaveMeta {
  readonly slot: string;
  readonly name?: string;
  readonly loop: number;
  readonly location: string;
  readonly day: number;
  readonly slotName: string;
  readonly playSeconds: number;
  /** 存档时刻的任务摘要（文本键；列表页展示用） */
  readonly questSummary: readonly TextKey[];
  /** 创建时刻（epoch 毫秒） */
  readonly createdAt: number;
  readonly versions: SaveVersions;
}

/** 存档槽列表项（主菜单/读档面板的展示投影） */
export interface SaveSlotSummary extends SaveMeta {
  /** 是否存在备份档（FR-SAVE-05；列表可提示「可从备份恢复」） */
  readonly hasBackup?: boolean;
}

/**
 * 存档持久化适配器（§5.6 PersistenceAdapter 的结构镜像）。
 *
 * 契约（实现方必须满足，contract.ts 逐条验证）：
 * - `write` 必须**原子**：覆盖写先备份旧档，失败不留半写状态；
 * - `load` 对未知/损坏文档抛错（不静默返回空档）；
 * - `loadBackup` 无备份返回 null（首写前没有备份是合法状态）；
 * - `listSaves` 按创建时刻降序（主菜单「继续」取首项即最近存档）；
 * - 全部方法异步（IndexedDB / 文件系统皆异步；内存实现也保持 Promise 面）。
 */
export interface PersistenceAdapter {
  /** 适配器标识（诊断与降级提示用：'dexie' | 'memory'） */
  readonly name: string;
  listSaves(): Promise<SaveMeta[]>;
  load(slot: string): Promise<SaveBlob>;
  write(slot: string, blob: SaveBlob): Promise<void>;
  remove(slot: string): Promise<void>;
  rename(slot: string, name: string): Promise<void>;
  /** 写前备份读取（FR-SAVE-05 备份恢复路径）；无备份返回 null */
  loadBackup(slot: string): Promise<SaveBlob | null>;
}

/**
 * Profile 的深可变视图（替代 immer 的 `Draft<T>`）。
 *
 * 设计 §5.6 的 `ProfileStore.mutate` 签名为 `(p: Draft<Profile>) => void`；
 * runtime-ui 不引入 immer（超出已批准的依赖清单），故以本地深可变映射表达
 * 同一语义。`Draft<Profile>` 与本类型的成员逐一对应，ProfileStore 的实现
 * （DexieAdapter）对两者皆可赋值——20 号落地后接口对接零改动。
 */
export type MutableProfile<T> = {
  -readonly [K in keyof T]: T[K] extends readonly (infer U)[]
    ? U[]
    : T[K] extends object
      ? MutableProfile<T[K]>
      : T[K];
};

/**
 * 跨存档 Profile 存储（§5.6 ProfileStore 的结构镜像；决策 D7）。
 *
 * - 与存档槽分离持久化：读档/删档不回收集点数与已解锁成就；
 * - `mutate` 为乐观锁写入（写前读版本，冲突则重试或失败）——实现方保证；
 * - 引擎不直接写 Profile（DD-04 保持引擎无 IO），入账由宿主（runtime-ui）触发。
 *
 * @typeParam TProfile Profile 结构（shared `Profile`；泛型避免本文件 import
 *   其类型而把 20 号的领域知识拉进 UI 包，同时保持结构兼容）
 */
export interface ProfileStore<TProfile = unknown> {
  load(): Promise<TProfile>;
  mutate(fn: (profile: MutableProfile<TProfile>) => void): Promise<void>;
}

/** 由 SaveBlob 投影槽位元信息（含 slotName 的缺省派生规则） */
export function projectSaveMeta(slot: string, blob: SaveBlob): SaveMeta {
  return {
    slot,
    // 槽位显示名：玩家命名 > 槽位 id（不臆造「未命名」之类文案，D4）
    ...(blob.meta.name !== undefined ? { name: blob.meta.name } : {}),
    loop: blob.meta.loop,
    location: blob.meta.location,
    day: blob.meta.day,
    // 槽位类型口径：auto_* / quick / 其余归 manual（列表分组与本地化用）
    slotName: slot.startsWith('auto_') ? 'auto' : slot === 'quick' ? 'quick' : 'manual',
    playSeconds: blob.meta.playSeconds,
    questSummary: [],
    createdAt: blob.meta.createdAt,
    versions: {
      engineVersion: blob.engineVersion,
      gameVersion: blob.gameVersion,
      schemaVersion: blob.schemaVersion,
    },
  };
}
