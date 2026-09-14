import type { MediaIntent } from '../runtime/index.js';
import type { MediaCatalogLike, MediaLookup, MediaResolverOptions, MediaWarning } from './types.js';

/**
 * 媒体意图解析器（设计 §5.10，DD-05；24 号模块任务 1）。
 *
 * 职责边界（引擎红线）：
 * - **只做两件事**：查 mediaCatalog 核对 assetId 存在性；给缺失资源补占位标记
 *   （`missing: true`）。不构造意图形态（形态归调用方：叙事层按段落声明、效果
 *   层按指令参数各自装配——意图语义差异不该在解析器里分叉）、不读文件头、不
 *   解码、不加载。播放与降级呈现（占位块/隐藏）归 runtime-ui 播放器（§6.8）；
 * - 缺失策略（FR-MEDIA-06）：warning 出口 + 占位 intent。告警按 assetId 去重
 *   （同一缺失资源在整局游戏中只报一次，避免逐段落刷屏）；
 * - 无告警出口时静默降级（占位 intent 照常产出）——引擎不因媒体缺失中断叙事。
 */

/** 意图的资产 id 提取（判别联合各成员的 assetId 均为必填） */
function assetIdOf(intent: MediaIntent): string {
  return intent.assetId;
}

/**
 * 媒体意图解析器（设计 §5.10 / DD-05；24 号）。
 *
 * 只做两件事：查 `mediaCatalog` 核对 assetId 存在性、给缺失资源补
 * `missing: true` 占位标记（{@link decorate}）。**不构造意图形态**——形态归
 * 调用方（叙事层按段落声明、效果层按指令参数各自装配），避免语义在此分叉。
 *
 * 缺失告警经构造选项 `onWarn` 出口按 assetId 去重（整局只报一次）；
 * {@link lookup} 为免告警查询（预载清单 / 差分探测等批量路径）。
 * 引擎零图像/音频依赖：产出全为纯数据 `MediaIntent`。
 */
export class MediaResolver {
  readonly #catalog: MediaCatalogLike | undefined;
  readonly #onWarn: ((warning: MediaWarning) => void) | undefined;
  /** 已告警的缺失 assetId 集（去重面；不含解析成功的资产） */
  readonly #warned = new Set<string>();

  constructor(options: MediaResolverOptions = {}) {
    this.#catalog = options.catalog;
    this.#onWarn = options.onWarn;
  }

  /** 已登记资产数（0 = 空目录/未注入目录） */
  get size(): number {
    return this.#catalog?.size ?? 0;
  }

  /**
   * 核对并向意图补缺失标记：存在 → 原样返回；缺失 → 发一次告警（按 assetId
   * 去重）并返回带 `missing: true` 的占位意图（形态由调用方决定，此处只加标记）。
   */
  decorate(intent: MediaIntent): MediaIntent {
    const assetId = assetIdOf(intent);
    if (this.#catalog?.resolve(assetId) != null) return intent;
    this.#warnMissing(assetId, intent.type);
    return { ...intent, missing: true } as MediaIntent;
  }

  /** 免告警查询（预载清单/差分基图探测等批量路径用） */
  lookup(assetId: string): MediaLookup {
    const asset = this.#catalog?.resolve(assetId) ?? null;
    return { asset, missing: asset === null };
  }

  /** 缺失告警（去重 + 定位信息：assetId 与媒体类型） */
  #warnMissing(assetId: string, kind: MediaIntent['type']): void {
    if (this.#warned.has(assetId)) return;
    this.#warned.add(assetId);
    this.#onWarn?.({
      severity: 'warning',
      code: 'media_missing',
      where: { assetId, mediaType: kind },
    });
  }
}
