import { describe, expect, it } from 'vitest';
import { MediaResolver } from '../../src/media/index.js';
import type { MediaCatalogLike } from '../../src/media/index.js';
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

describe('24-1 MediaResolver：资源解析与缺失占位', () => {
  it('已登记 assetId → 意图原样返回（交回引用同一对象，无分配）', () => {
    const resolver = new MediaResolver({ catalog: catalogOf({ bg_town: asset() }) });
    const intent = { type: 'bg', assetId: 'bg_town' } as const;
    expect(resolver.decorate(intent)).toBe(intent);
  });

  it('未登记 assetId → 占位意图（missing 标记）+ warning（FR-MEDIA-06）', () => {
    const warnings: string[] = [];
    const resolver = new MediaResolver({
      catalog: catalogOf({}),
      onWarn: (warning) => warnings.push(warning.code),
    });
    const decorated = resolver.decorate({ type: 'bg', assetId: 'bg_missing' });
    // 占位保留原形态与 assetId，仅加标记（UI 侧据此决定占位块/隐藏）
    expect(decorated).toEqual({ type: 'bg', assetId: 'bg_missing', missing: true });
    expect(warnings).toEqual(['media_missing']);
  });

  it('意图形态不因解析而改变（bgm 的 loop 等字段原样保留）', () => {
    const resolver = new MediaResolver({ catalog: catalogOf({}) });
    expect(resolver.decorate({ type: 'bgm', assetId: 'bgm_x', loop: true })).toEqual({
      type: 'bgm',
      assetId: 'bgm_x',
      loop: true,
      missing: true,
    });
  });

  it('同一缺失 assetId 重复解析只告警一次（不刷屏）', () => {
    let count = 0;
    const resolver = new MediaResolver({
      catalog: catalogOf({}),
      onWarn: () => {
        count += 1;
      },
    });
    resolver.decorate({ type: 'bg', assetId: 'bg_missing' });
    resolver.decorate({ type: 'bg', assetId: 'bg_missing' });
    resolver.decorate({ type: 'cg', assetId: 'bg_missing' });
    expect(count).toBe(1);
  });

  it('warning 携带 assetId 与媒体类型（诊断定位，§10.2）', () => {
    const seen: Array<Readonly<Record<string, string>>> = [];
    const resolver = new MediaResolver({
      catalog: catalogOf({}),
      onWarn: (warning) => seen.push(warning.where),
    });
    resolver.decorate({ type: 'sprite', assetId: 'sprite_x' });
    expect(seen[0]).toMatchObject({ assetId: 'sprite_x', mediaType: 'sprite' });
  });

  it('无 onWarn 出口时缺失不抛错（占位意图照常产出，NFR-06 容错）', () => {
    const resolver = new MediaResolver({ catalog: catalogOf({}) });
    expect(() => resolver.decorate({ type: 'bg', assetId: 'bg_x' })).not.toThrow();
  });

  it('lookup：免告警查询（预载/差分探测路径；存在与缺失同形）', () => {
    const resolver = new MediaResolver({ catalog: catalogOf({ bg_town: asset() }) });
    expect(resolver.lookup('bg_town')).toEqual({ asset: asset(), missing: false });
    expect(resolver.lookup('nope')).toEqual({ asset: null, missing: true });
  });

  it('未注入目录 → size 0 且一切皆缺失（空目录语义）', () => {
    const resolver = new MediaResolver();
    expect(resolver.size).toBe(0);
    expect(resolver.lookup('any').missing).toBe(true);
  });
});
