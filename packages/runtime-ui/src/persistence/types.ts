import type { GameId, TextKey } from '@game/shared';

/**
 * 存档元信息的**本地结构镜像**（设计 §5.6 SaveMeta / §6.7，DD-04）。
 *
 * 为什么在 runtime-ui 侧镜像而非从 engine 导入：20 号（存档系统）与本模块并行
 * 开发，engine 尚未落地 `engine/src/persistence/adapter.ts` 与其导出。此处按
 * §5.6 的签名做**结构等价**的本地定义，保证：
 * - 本模块现在即可编译与测试（主菜单「继续/读档」的展示面只需 meta）；
 * - **20 号落地后零成本对接**——TS 结构类型无需转换，届时把 import 源换成
 *   `@game/engine` 即可（PersistenceAdapter 等适配器契约同此处置，见任务 10）。
 *
 * 与 §5.6 的一处必要差异：设计中 `SaveMeta.versions` 写作 `SaveBlob['versions']`，
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
  readonly location: GameId;
  readonly day: number;
  readonly slotName: string;
  readonly playSeconds: number;
  /** 存档时刻的任务摘要（文本键；列表页展示用） */
  readonly questSummary: readonly TextKey[];
  /** 创建时刻（epoch 毫秒） */
  readonly createdAt: number;
  readonly versions: SaveVersions;
}

/**
 * 存档槽列表项（主菜单/读档面板的展示投影）。
 *
 * 与 {@link SaveMeta} 的差异只在**呈现口径**：把技术字段折算为可直接渲染的
 * 文本与布尔位（有无版本不兼容风险），避免每个列表项各自重算。
 */
export interface SaveSlotSummary extends SaveMeta {
  /** 是否存在备份档（FR-SAVE-05；列表可提示「可从备份恢复」） */
  readonly hasBackup?: boolean;
}
