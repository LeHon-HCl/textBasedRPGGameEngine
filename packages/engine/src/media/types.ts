import type { MediaAsset } from '../loader/index.js';

/**
 * 媒体解析子系统类型（设计 §5.10，DD-05；24 号模块）。
 *
 * 引擎半边：核对作者声明的 assetId 存在性，并为缺失资源补上占位标记；播放器
 * 半边（runtime-ui，§6.8）消费 intent。引擎**零图像/音频依赖**——本文件全部
 * 类型为纯数据，可在 Node 无媒体环境完整测试（模块验收红线）。
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

/** 解析器构造选项 */
export interface MediaResolverOptions {
  /** 媒体目录（loader.mediaCatalog 直接注入；缺省 = 空目录，一切皆缺失） */
  readonly catalog?: MediaCatalogLike;
  /** 缺失告警出口（默认丢弃；宿主接 definition.diagnostics 同型通道） */
  readonly onWarn?: (warning: MediaWarning) => void;
}

/** 资产查询结果（check 的副产物；预载清单等只读路径可用 asset） */
export interface MediaLookup {
  /** catalog 条目；缺失为 null */
  readonly asset: MediaAsset | null;
  /** true = 资源缺失 */
  readonly missing: boolean;
}
