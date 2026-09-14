/**
 * media 子系统出口（媒体意图解析与存在性核对，设计 §5.10 / DD-05；24 号模块）。
 *
 * 经 `@game/engine` 根出口对外发布（§10.4 导出约定）；子系统内部仅此文件
 * 对外暴露实现，横向子系统不得深入本目录路径（DD-06）。
 */
export { MediaResolver } from './resolver.js';
export type {
  MediaCatalogLike,
  MediaResolution,
  MediaResolverOptions,
  MediaWarning,
  SpriteDecl,
  SpriteVariant,
  SpriteVariantQuery,
} from './types.js';
