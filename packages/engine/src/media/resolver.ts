import type { MediaIntent } from '../runtime/index.js';
import type {
  MediaCatalogLike,
  MediaResolution,
  MediaResolverOptions,
  MediaWarning,
} from './types.js';

/**
 * 媒体意图解析器（设计 §5.10，DD-05；24 号模块任务 1）。
 *
 * 职责边界（引擎红线）：
 * - **只做两件事**：查 mediaCatalog 核对 assetId 存在性；把声明转成 MediaIntent
 *   纯数据。不读文件头、不解码、不加载——播放与降级呈现（占位块/隐藏）归
 *   runtime-ui 播放器（§6.8）；
 * - 缺失策略（FR-MEDIA-06）：warning 出口 + 占位 intent（`missing: true`）。
 *   告警按 assetId 去重（同一缺失资源在整局游戏中只报一次，避免逐段落刷屏）；
 * - 无告警出口时静默降级（占位 intent 照常产出）——引擎不因媒体缺失中断叙事。
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
   * 完整解析：asset + missing + intent。
   * 缺失时发一次 warning（按 assetId 去重）并返回占位 intent。
   */
  resolve(assetId: string, kind: MediaIntent['type']): MediaResolution {
    const asset = this.#catalog?.resolve(assetId) ?? null;
    if (asset === null) this.#warnMissing(assetId, kind);
    return {
      assetId,
      asset,
      missing: asset === null,
      intent: buildIntent(assetId, kind, asset === null),
    };
  }

  /** 只要意图（resolved / missing 同形——播放器只消费 intent） */
  intentFor(assetId: string, kind: MediaIntent['type']): MediaIntent {
    return this.resolve(assetId, kind).intent;
  }

  /** 免告警查询（预载清单/差分基图探测等批量路径用） */
  assetOf(assetId: string): MediaResolution['asset'] {
    return this.#catalog?.resolve(assetId) ?? null;
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

/** intent 装配（§5.10 判别联合；missing 仅缺失时出现，保持 resolved intent 形态稳定） */
function buildIntent(assetId: string, kind: MediaIntent['type'], missing: boolean): MediaIntent {
  switch (kind) {
    case 'bgm':
      return { type: 'bgm', assetId, loop: true, ...(missing ? { missing: true } : {}) };
    case 'sfx':
      return { type: 'sfx', assetId, ...(missing ? { missing: true } : {}) };
    default:
      return { type: kind, assetId, ...(missing ? { missing: true } : {}) };
  }
}
