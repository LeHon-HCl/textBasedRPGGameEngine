import { describe, expect, it } from 'vitest';
import { MediaResolver, type MediaCatalogLike } from '../../src/media/index.js';
import type { MediaAsset } from '../../src/loader/index.js';

/**
 * 24 任务 1：MediaResolver —— catalog 查询 + 缺失告警 + 占位 intent
 * （设计 §5.10 / FR-MEDIA-06）。
 *
 * 引擎红线（DD-05）：只产出纯数据 intent，不接触任何图像/音频 API。
 * 缺失资源策略：warning 出口 + 占位 intent（占位 marker 由 runtime-ui 决定
 * 渲染成占位块还是隐藏——引擎只表达「此处应有媒体但缺失」）。
 */

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    path: 'assets/bg/old_town.png',
    hash: 'deadbeef',
    preload: false,
    type: 'image',
    ...overrides,
  };
}

function catalogOf(entries: Record<string, MediaAsset>): MediaCatalogLike {
  return {
    resolve: (assetId) => entries[assetId] ?? null,
    size: Object.keys(entries).length,
  };
}

describe('24-1 MediaResolver：资源解析', () => {
  it('已登记 assetId → resolved=true 且携带 MediaAsset（path/hash/type）', () => {
    const resolver = new MediaResolver({ catalog: catalogOf({ bg_town: asset() }) });
    const result = resolver.resolve('bg_town', 'bg');
    expect(result.assetId).toBe('bg_town');
    expect(result.asset).toEqual(asset());
    expect(result.missing).toBe(false);
    expect(result.intent).toEqual({ type: 'bg', assetId: 'bg_town' });
  });

  it('未登记 assetId → missing=true + warning + 占位 intent（FR-MEDIA-06）', () => {
    const warnings: string[] = [];
    const resolver = new MediaResolver({
      catalog: catalogOf({}),
      onWarn: (warning) => warnings.push(warning.code),
    });
    const result = resolver.resolve('bg_missing', 'bg');
    expect(result.missing).toBe(true);
    expect(result.asset).toBeNull();
    // 占位 intent 保留 assetId 与类型（UI 侧据此决定占位块/隐藏）
    expect(result.intent).toEqual({ type: 'bg', assetId: 'bg_missing', missing: true });
    expect(warnings).toEqual(['media_missing']);
  });

  it('同一缺失 assetId 重复解析只告警一次（不刷屏）', () => {
    let count = 0;
    const resolver = new MediaResolver({
      catalog: catalogOf({}),
      onWarn: () => {
        count += 1;
      },
    });
    resolver.resolve('bg_missing', 'bg');
    resolver.resolve('bg_missing', 'bg');
    resolver.resolve('bg_missing', 'cg');
    expect(count).toBe(1);
  });

  it('warning 携带 assetId 与媒体类型（诊断定位，§10.2）', () => {
    const seen: Array<Readonly<Record<string, string>>> = [];
    const resolver = new MediaResolver({
      catalog: catalogOf({}),
      onWarn: (warning) => seen.push(warning.where),
    });
    resolver.resolve('sprite_x', 'sprite');
    expect(seen[0]).toMatchObject({ assetId: 'sprite_x', mediaType: 'sprite' });
  });

  it('无 onWarn 出口时缺失不抛错（占位 intent 照常产出，NFR-06 容错）', () => {
    const resolver = new MediaResolver({ catalog: catalogOf({}) });
    expect(() => resolver.resolve('bg_x', 'bg')).not.toThrow();
  });

  it('intentFor：仅返回 intent（resolved 与 missing 同形，UI 只看 intent）', () => {
    const resolver = new MediaResolver({ catalog: catalogOf({ bg_town: asset() }) });
    expect(resolver.intentFor('bg_town', 'bg')).toEqual({ type: 'bg', assetId: 'bg_town' });
    expect(resolver.intentFor('nope', 'bg')).toEqual({
      type: 'bg',
      assetId: 'nope',
      missing: true,
    });
  });

  it('assetOf：解析存在的 assetId 免告警查询（差分/预载路径用）', () => {
    const resolver = new MediaResolver({ catalog: catalogOf({ bg_town: asset() }) });
    expect(resolver.assetOf('bg_town')).toEqual(asset());
    expect(resolver.assetOf('nope')).toBeNull();
  });
});
