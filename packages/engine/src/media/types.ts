import type { GameId } from '@game/shared';
import type { MediaAsset } from '../loader/index.js';
import type { MediaIntent } from '../runtime/index.js';

/**
 * 媒体解析子系统类型（设计 §5.10，DD-05；24 号模块）。
 *
 * 引擎半边：把作者声明的 assetId 解析为可播放意图（intent）并核对存在性；
 * 播放器半边（runtime-ui，§6.8）消费 intent。引擎**零图像/音频依赖**——本文件
 * 全部类型为纯数据，可在 Node 无媒体环境完整测试（模块验收红线）。
 */

/**
 * MediaCatalog 的结构化最小视图（§5.10）。
 *
 * `loader.MediaCatalog` 结构化满足本接口；单独声明是为了让解析器测试无需装配
 * 加载器（DD-06 同型的最小依赖面）。跨子系统只依赖该最小面。
 */
export interface MediaCatalogLike {
  /** 资产查询：未登记返回 null */
  resolve(assetId: string): MediaAsset | null;
  /** 已登记资产数（诊断/预载清单用） */
  readonly size: number;
}

/** 媒体缺失告警（FR-MEDIA-06：加载失败/缺失的降级显示与告警） */
export interface MediaWarning {
  readonly severity: 'warning';
  readonly code: 'media_missing';
  /** 定位信息：assetId 与媒体类型（诊断卡片展示面，§10.2） */
  readonly where: Readonly<Record<string, string>>;
}

/** 解析结果（resolved / missing 同形：调用方只需消费 intent） */
export interface MediaResolution {
  /** 原始 assetId（占位 intent 亦保留，便于作者定位） */
  readonly assetId: string;
  /** catalog 条目；缺失为 null */
  readonly asset: MediaAsset | null;
  /** true = 资源缺失（intent.missing = true，已发 warning） */
  readonly missing: boolean;
  /** 播放意图（缺失时为占位 intent：带 missing 标记，播放器决定降级呈现） */
  readonly intent: MediaIntent;
}

/** 解析器构造选项 */
export interface MediaResolverOptions {
  /** 媒体目录（loader.mediaCatalog 直接注入；缺省 = 空目录，一切皆缺失） */
  readonly catalog?: MediaCatalogLike;
  /** 缺失告警出口（默认丢弃；宿主接 definition.diagnostics 同型通道） */
  readonly onWarn?: (warning: MediaWarning) => void;
}

/** 立绘差分解析输入（FR-MEDIA-03：条件表达式已由调用方求值为布尔） */
export interface SpriteVariantQuery {
  /** NPC id（差分声明的归属；用于定位与去重） */
  readonly npc: GameId;
  /** 差分声明（基图 + 有序变体；首个条件为真者胜） */
  readonly sprites: readonly SpriteDecl[];
  /** 变体条件求值（条件原文 → 布尔；编译/求值错误由调用方按 DD-01 处理） */
  readonly evalCondition: (expr: string) => boolean;
}

/** 单条立绘声明（§2.4 NpcDef.sprites 升级形态；基图 + 条件差分） */
export interface SpriteDecl {
  /** 基图资产 id（无变体命中时的回落目标） */
  readonly base?: string;
  /** 变体（按声明顺序取首个命中；`when` 为普通表达式，§5.10） */
  readonly variants?: readonly SpriteVariant[];
}

/** 立绘差分条目：条件命中 → 该 assetId（含基图回落） */
export interface SpriteVariant {
  /** 差分选择条件（好感阶段/身体部位/服装驱动，FR-MEDIA-03） */
  readonly when: string;
  /** 命中时使用的资产 id */
  readonly asset: string;
}
