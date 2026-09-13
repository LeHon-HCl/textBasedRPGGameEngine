import type {
  CompiledExpr,
  ErrCode,
  ExprFunctionDef,
  ExprFunctionRegistry,
  GameId,
  Lang,
  TextKey,
} from '@game/shared';
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
  TimeConfig,
} from '@game/shared';
import type {
  CheckRule,
  CheckRuleResolver,
  EffectInstructionDef,
  EffectRegistry,
} from '../effects/index.js';

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
  /** 时段制日历（§4.3 TimeConfig；data/time.yaml 缺省 = undefined，宿主用缺省日历） */
  readonly time: TimeConfig | undefined;
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

// ---- 管线步骤 6 scripts（宿主注入脚本模块，§3.4 / §5.9 / FR-SCR-04） --------

/**
 * 作者脚本模块注册 API（设计 §5.9 ScriptSetupApi 的加载期注册面）：
 * 脚本在管线步骤 6 内经此 API 注册效果指令 / 表达式函数 / 判定规则；
 * 步骤 6 完成后注册表冻结（EffectRegistry.freeze），注册窗口关闭。
 * 时间钩子（onHook）与事务入口（host.transaction）由 23 号脚本宿主
 * 接入时间管线时扩展，本 API 只承载加载期注册。
 */
export interface ScriptSetupApi {
  /** 注册作者扩展效果指令：id 必须 `x.<script>.<name>`（DD-08） */
  registerEffect(def: EffectInstructionDef<unknown>): void;
  /** 注册作者扩展表达式函数：name 必须 `x.<script>.<name>`（DD-08） */
  registerFunction(def: ExprFunctionDef): void;
  /** 注册作者扩展判定规则（§5.1 CheckRule；'x.<script>.<rule>' 可插拔） */
  registerCheckRule(rule: CheckRule): void;
}

/**
 * 作者脚本模块（设计 §5.9 ScriptModule，§9.2 编译产物接口）：引擎只接受
 * 宿主注入的模块实例（NFR-19 / FR-SCR-06，运行期无任何动态加载）。
 */
export interface ScriptModule {
  /** 脚本模块 id（x.* 命名空间段使用） */
  readonly id: string;
  setup(api: ScriptSetupApi): void;
}

// ---- 冻结产物（管线步骤 7，设计 §3.4 GameDefinition） ------------------------

/**
 * 冻结的游戏定义（设计 §3.4）：loadGamePackage 的产物，运行期不可变。
 * - scenes/areas 等实体域以（冻结的）Map 承载，DD-02 目录聚合的键级视图；
 * - functionRegistry 为脚本注册完成并冻结后的最终表达式函数注册表
 *   （内置 20 函数 + x.* 扩展，§3.2/§5.9）；
 * - effectRegistry 为冻结的效果指令注册表（05 号 EffectRegistry，
 *   GameRuntime 经 GameRuntimeOptions.effectExecutor 注入运行）；
 * - diagnostics 仅含 warning 级（error 已在管线阻断）。
 */
export interface GameDefinition {
  readonly manifest: Manifest;
  readonly scenes: ReadonlyMap<GameId, CompiledScene>;
  readonly areas: ReadonlyMap<GameId, AreaDef>;
  readonly events: readonly EventDef[];
  readonly poolIndex: PoolIndex;
  /** 全包表达式编译缓存（键 = 表达式原文，§3.4） */
  readonly exprCache: ReadonlyMap<string, CompiledExpr>;
  /** 冻结后的最终表达式函数注册表（内置 20 函数 + 脚本 x.* 扩展，§3.2） */
  readonly functionRegistry: ExprFunctionRegistry;
  /** 冻结后的效果指令注册表（05 号；GameRuntime 的 effectExecutor 注入面） */
  readonly effectRegistry: EffectRegistry;
  /** 媒体目录（DD-05：assetId → {path, hash, preload, type}） */
  readonly mediaCatalog: MediaCatalog;
  /** 时段制日历（§4.3 TimeConfig；data/time.yaml 缺省 = undefined，09 号） */
  readonly time: TimeConfig | undefined;
  /** 语言包（FR-L10N-02：仅 manifest.langs 声明语言） */
  readonly locales: Record<Lang, LocalePack>;
  /** manifest.redirects（旧 ID → 新 ID，§5.7 迁移定向改写用） */
  readonly redirects: Readonly<Record<string, GameId>>;
  /** warning 级诊断（error 已阻断；编辑器校验中心复用同一规则集，DD-12） */
  readonly diagnostics: readonly Diagnostic[];
}

/** loadGamePackage 选项（设计 §3.4 加载入口） */
export interface LoadGameOptions {
  /**
   * 优先加载的语言：提供时仅加载主语言与该语言两包（内存受限宿主）；
   * 缺省加载 manifest.langs 全部声明语言。未声明语言 → warning。
   */
  readonly lang?: Lang;
  /** 宿主注入的作者脚本模块（管线步骤 6；缺省 = 无脚本，FR-SCR-06） */
  readonly scripts?: readonly ScriptModule[];
  /** 宿主级判定规则解析器（脚本规则之外的基础规则，15 号注入 coc/generic） */
  readonly checkResolver?: CheckRuleResolver;
}

// ---- 管线步骤 5 compile（表达式缓存 / 事件池索引 / 反查表 / 媒体目录，§3.4） --

/**
 * 事件池索引（设计 §4.4 PoolIndex；由加载器 compile 步骤构建，10 号事件系统
 * 消费）：key = `${area}/${location ?? '*'}` 的作用域候选表、VarRef.path → 事件
 * 的脏标记反查表（NFR-02 增量求值）、互斥组成员表，以及任务/成就条件的
 * refs 反查表（§4.5「与事件系统同一机制，不轮询」）。
 */
export interface PoolIndex {
  readonly byScope: ReadonlyMap<string, readonly EventDef[]>;
  /** VarRef.path → 依赖该路径的事件 id（来源：trigger.require 的编译期 refs） */
  readonly dirtyMap: ReadonlyMap<string, ReadonlySet<GameId>>;
  readonly mutexGroups: ReadonlyMap<string, readonly GameId[]>;
  /** VarRef.path → 依赖该路径的任务 id（acceptIf/completeWhen/failWhen） */
  readonly questRefs: ReadonlyMap<string, ReadonlySet<GameId>>;
  /** VarRef.path → 依赖该路径的成就 id（when/progressExpr） */
  readonly achievementRefs: ReadonlyMap<string, ReadonlySet<GameId>>;
}

/** 媒体资产条目（DD-05：assetId → {path, hash, preload}） */
export interface MediaAsset {
  /** 包内路径（assets/ 下相对路径，含扩展名） */
  readonly path: string;
  /** 加载期内容指纹（FNV-1a，非密码学；发布完整性由 exporter sha256 承担，§9.1） */
  readonly hash: string;
  /** 预加载标记（缺省 false；媒体全懒加载为 NFR-04 首屏预算基线） */
  readonly preload: boolean;
  /** 资产类型（按扩展名推断，DD-05 播放器消费） */
  readonly type: 'image' | 'audio' | 'other';
}

/** 媒体目录（设计 §5.10 MediaCatalog：engine 只核对 assetId 存在性） */
export interface MediaCatalog {
  resolve(assetId: string): MediaAsset | null;
  readonly size: number;
}

/** 表达式引用的 x.* 函数（scripts 步骤存在性/purity 核对，FR-SCR-04） */
export interface XFunctionRef {
  readonly name: string;
  /** 引用位置是否缓存敏感（事件 require；脚本函数为非纯时 EXPR_COMPILE） */
  readonly requirePure: boolean;
}

/** compile 步骤产物（scripts/freeze 步骤与 GameRuntime 装配的数据源） */
export interface CompiledArtifacts {
  /** 全包表达式编译缓存（键 = 表达式原文，§3.4 exprCache） */
  readonly exprCache: ReadonlyMap<string, CompiledExpr>;
  readonly poolIndex: PoolIndex;
  readonly mediaCatalog: MediaCatalog;
  /** 表达式中引用的 x.* 函数清单（存在性核对归 scripts 步骤） */
  readonly xFunctionRefs: readonly XFunctionRef[];
}
