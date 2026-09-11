import type { ErrCode, GameId, Lang, TextKey } from '@game/shared';
import type {
  AchievementDef,
  AreaDef,
  AttrDefs,
  BodyDef,
  ContentTagsDef,
  EndingDef,
  EventDef,
  FactionDef,
  ItemDef,
  LoopConfig,
  Manifest,
  NpcDef,
  PerkDef,
  QuestDef,
  SceneDef,
  ShopDef,
  StatsPageDef,
} from '@game/shared';

/**
 * 游戏包加载器类型（设计 §3.4，06 号模块）。
 *
 * {@link PackageSource} 是三宿主共用的包输入抽象（DD-12 相关）：
 * - Electron/Node 宿主为目录（文件树快照）；
 * - 浏览器静态包为导出期预编译的 JSON chunk（§9.1，parse 步退化为直读）；
 * - 编辑器为内存 DocModel（M3 起）。
 * 三宿主共用同一条七步加载管线，本文件承载输入抽象与各阶段的数据契约。
 */

/**
 * 包源抽象（设计 §3.4）：以包根为基准的只读文件树快照。
 *
 * 约定：
 * - 路径一律正斜杠、相对包根（如 `manifest.yaml`、`data/scenes/old_town/arrival.yaml`）；
 * - {@link read}：文件存在 → 返回文本或二进制内容；指向目录或不存在 → reject；
 * - {@link list}：目录存在 → 返回直接子项（文件与子目录）的相对路径；包根传 `''`；
 *   目录不存在 → reject。
 */
export interface PackageSource {
  read(path: string): Promise<Uint8Array | string>;
  list(dir: string): Promise<string[]>;
}

/**
 * 加载期诊断（设计 §3.4「步骤 4/5 产出的错误汇总为 Diagnostic[]」）。
 *
 * - `severity='error'`：阻断加载（管线收集后抛 EngineError，DD-12 error 级子集）；
 * - `severity='warning'`：进入 definition.diagnostics 供 UI / 编辑器校验中心
 *   显示（编辑器复用同一规则集，DD-12）；
 * - `where`：定位信息（文件 / 数据路径 / 引用 kind 等，值为字符串）；
 *   其中 `messageKey` 键承载重建 EngineError 的用户可读诊断键（§2.2 三元组）。
 */
export interface Diagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: ErrCode;
  readonly where: Readonly<Record<string, string>>;
}

/** 场景文件聚合条目（DD-02：data/scenes/<areaId>/<sceneId>.yaml 一场景一文件） */
export interface SceneFileInfo {
  /** 包内路径（如 data/scenes/old_town/arrival.yaml） */
  readonly path: string;
  /** 目录侧声明的区域 id（<areaId> 目录名） */
  readonly areaDir: string;
}

/**
 * collect 步骤产物（管线步骤 1，设计 §3.4「PackageSource 列目录」）：
 * 目录聚合结果 + 聚合期诊断。场景文件在聚合时解析（提取 id/area 供目录
 * 一致性比对，解析产物进 {@link sceneDocs} 供后续步骤复用——每文件恰好
 * 解析一次），其余文件由 parse 步骤统一读取解析。
 */
export interface CollectedPackage {
  readonly sceneFiles: readonly SceneFileInfo[];
  /** 聚合期解析的场景文档（路径 → YAML/JSON 对象；解析失败者不在此列） */
  readonly sceneDocs: ReadonlyMap<string, unknown>;
  /** data/ 下全部数据文件路径（parse 步骤按域约定取用） */
  readonly dataFiles: readonly string[];
  /** assets/ 下全部资产文件路径（媒体目录数据源，DD-05） */
  readonly assetFiles: readonly string[];
  /** 资产 id（路径去 assets/ 前缀与扩展名；crossRef 媒体引用的核对集） */
  readonly mediaIds: readonly string[];
  /** 语言目录 → 语言包文件路径（FR-L10N-02 命名空间镜像） */
  readonly localeFiles: ReadonlyMap<Lang, readonly string[]>;
  readonly diagnostics: readonly Diagnostic[];
}

// ---- 管线步骤 2 parse（YAML → 对象，设计 §3.4） ------------------------------

/**
 * parse 步骤产物：全部包文件的解析文档缓存（含 collect 聚合期解析的场景文档）。
 * 浏览器静态包宿主（导出期已转 JSON，§9.1）此步退化为直读。
 */
export interface ParsedPackage {
  readonly collected: CollectedPackage;
  /** 路径 → 解析文档（YAML/JSON 对象） */
  readonly docs: ReadonlyMap<string, unknown>;
  readonly diagnostics: readonly Diagnostic[];
}

// ---- 语言包（FR-L10N-02 命名空间镜像，§3.4 语言包条目） ----------------------

/**
 * 语言包键值（FR-L10N-04 复数/选择结构以数据形态透传）：
 * 字符串为普通文本；记录形态（如 `{plural: {...}}`、`{select: {...}}`）由
 * 08 号文本解析器解释，加载器只做结构透传与冻结。
 */
export interface LocaleRecord {
  readonly [key: string]: LocaleValue;
}
export type LocaleValue = string | LocaleRecord | readonly LocaleValue[];

/**
 * 编译后的语言包（§3.4「编译出 LocalePack（Map），键级懒查」）：
 * TextKey → 文本值，键名为命名空间镜像展开后的完整键（如 'scenes.arrival.open'）。
 */
export interface LocalePack {
  readonly lang: Lang;
  readonly keys: ReadonlyMap<TextKey, LocaleValue>;
}

// ---- 管线步骤 3 validate（逐域 Zod + 重复 ID，设计 §3.4） --------------------

/** 场景与其源文件绑定（CompiledScene 的 validate 期形态，freeze 步骤冻结） */
export interface CompiledScene {
  readonly def: SceneDef;
  /** 源文件路径（诊断定位与编辑器跳转用） */
  readonly file: string;
}

/**
 * 全域校验后的游戏数据（§2.4 数据域集合；缺省域为空集合）。
 * 实体域以 Map 承载（GameId → 定义），保留声明顺序；scenes 额外携带源文件
 * 路径（DD-02 目录聚合的直接产物）。manifest 校验失败时为 undefined
 * （管线在 error 级诊断处阻断，下游步骤不会消费残缺域）。
 */
export interface PackageDomains {
  readonly manifest: Manifest | undefined;
  readonly attrs: AttrDefs | undefined;
  readonly body: BodyDef | undefined;
  readonly contentTags: ContentTagsDef | undefined;
  readonly statsPage: StatsPageDef | undefined;
  readonly loop: LoopConfig | undefined;
  readonly areas: ReadonlyMap<GameId, AreaDef>;
  readonly scenes: ReadonlyMap<GameId, CompiledScene>;
  readonly events: readonly EventDef[];
  readonly quests: ReadonlyMap<GameId, QuestDef>;
  readonly npcs: ReadonlyMap<GameId, NpcDef>;
  readonly items: ReadonlyMap<GameId, ItemDef>;
  readonly shops: ReadonlyMap<GameId, ShopDef>;
  readonly achievements: ReadonlyMap<GameId, AchievementDef>;
  readonly perks: ReadonlyMap<GameId, PerkDef>;
  readonly endings: ReadonlyMap<GameId, EndingDef>;
  readonly factions: ReadonlyMap<GameId, FactionDef>;
}

/** validate 步骤产物：全域 Zod 校验 + 重复 ID 检测 + 语言包编译 */
export interface ValidatedPackage {
  readonly parsed: ParsedPackage;
  readonly domains: PackageDomains;
  /** 已加载语言包（仅 manifest.langs 声明的语言；主语言供 crossRef 文本核对） */
  readonly locales: ReadonlyMap<Lang, LocalePack>;
  readonly diagnostics: readonly Diagnostic[];
}
