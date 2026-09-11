import { describe, expect, it } from 'vitest';
import { collectPackage, computeAssetId } from '../../src/loader/collect.js';
import { InMemoryPackageSource } from '../../src/loader/source-memory.js';

/**
 * collect 步骤用例（06 任务 A2，设计 §3.4 / DD-02 场景目录聚合）。
 *
 * 断言口径：collect 是管线步骤 1「PackageSource 列目录」——按 DD-02 聚合
 * `data/scenes/<areaId>/<sceneId>.yaml`，scene.area 与目录不一致 → warning
 * （容错不阻断）；可选目录缺省 = 空域、无诊断；资产与语言包目录聚合为
 * 后续步骤（crossRef / validate）的核对集。
 */

function makeSource(files: Record<string, string>): InMemoryPackageSource {
  return new InMemoryPackageSource(files);
}

describe('collectPackage（管线步骤 1，06 任务 A2）', () => {
  it('按 DD-02 聚合场景文件：路径与目录侧 areaDir 一一对应', async () => {
    const collected = await collectPackage(
      makeSource({
        'manifest.yaml': 'gameId: demo',
        'data/scenes/old_town/arrival.yaml': 'id: arrival\narea: old_town',
        'data/scenes/old_town/market.yaml': 'id: market\narea: old_town',
        'data/scenes/east_wood/cabin.yaml': 'id: cabin\narea: east_wood',
        'data/events.yaml': '- id: ev_x\n  scene: arrival',
      }),
    );
    expect(collected.sceneFiles).toEqual([
      { path: 'data/scenes/east_wood/cabin.yaml', areaDir: 'east_wood' },
      { path: 'data/scenes/old_town/arrival.yaml', areaDir: 'old_town' },
      { path: 'data/scenes/old_town/market.yaml', areaDir: 'old_town' },
    ]);
  });

  it('scene.area 与目录一致时不产生诊断（正例形态）', async () => {
    const collected = await collectPackage(
      makeSource({
        'data/scenes/old_town/arrival.yaml': 'id: arrival\narea: old_town',
      }),
    );
    expect(collected.diagnostics).toEqual([]);
  });

  it('scene.area 与目录不一致 → warning（SCHEMA_INVALID，容错不阻断）', async () => {
    const collected = await collectPackage(
      makeSource({
        'data/scenes/old_town/arrival.yaml': 'id: arrival\narea: east_wood',
        'data/scenes/east_wood/cabin.yaml': 'id: cabin\narea: east_wood',
      }),
    );
    expect(collected.diagnostics).toHaveLength(1);
    const diag = collected.diagnostics[0];
    expect(diag?.severity).toBe('warning');
    expect(diag?.code).toBe('SCHEMA_INVALID');
    expect(diag?.where).toMatchObject({
      file: 'data/scenes/old_town/arrival.yaml',
      scene: 'arrival',
      area: 'east_wood',
      dir: 'old_town',
      phase: 'collect',
    });
    // 与其他场景聚合互不影响：文件仍进入聚合结果与文档缓存
    expect(collected.sceneFiles).toHaveLength(2);
    expect(collected.sceneDocs.get('data/scenes/old_town/arrival.yaml')).toMatchObject({
      id: 'arrival',
    });
  });

  it('场景文件不在 <areaId>/ 层级下 → warning 并忽略聚合（DD-02 层级约定）', async () => {
    const collected = await collectPackage(
      makeSource({
        'data/scenes/loose_scene.yaml': 'id: loose_scene\narea: old_town',
        'data/scenes/old_town/arrival.yaml': 'id: arrival\narea: old_town',
      }),
    );
    const warnings = collected.diagnostics.filter(
      (d) => d.where['file'] === 'data/scenes/loose_scene.yaml',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severity).toBe('warning');
    expect(collected.sceneFiles).toEqual([
      { path: 'data/scenes/old_town/arrival.yaml', areaDir: 'old_town' },
    ]);
    expect(collected.sceneDocs.has('data/scenes/loose_scene.yaml')).toBe(false);
  });

  it('非法 YAML 场景文件 → error 级 SCHEMA_INVALID（阻断，交由管线抛出）', async () => {
    const collected = await collectPackage(
      makeSource({
        'data/scenes/old_town/broken.yaml': 'id: [arrival',
      }),
    );
    expect(collected.diagnostics).toHaveLength(1);
    expect(collected.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'SCHEMA_INVALID',
    });
    expect(collected.diagnostics[0]?.where['file']).toBe('data/scenes/old_town/broken.yaml');
    expect(collected.sceneDocs.has('data/scenes/old_town/broken.yaml')).toBe(false);
  });

  it('JSON 场景文件同协议聚合与解析（预编译静态包直读，设计 §9.1）', async () => {
    const collected = await collectPackage(
      makeSource({
        'data/scenes/old_town/arrival.json': '{"id":"arrival","area":"old_town"}',
      }),
    );
    expect(collected.sceneFiles).toEqual([
      { path: 'data/scenes/old_town/arrival.json', areaDir: 'old_town' },
    ]);
    expect(collected.sceneDocs.get('data/scenes/old_town/arrival.json')).toMatchObject({
      id: 'arrival',
    });
  });

  it('非数据文件（README 等）不聚合也不诊断', async () => {
    const collected = await collectPackage(
      makeSource({
        'data/scenes/README.md': '# 说明',
        'data/scenes/old_town/arrival.yaml': 'id: arrival\narea: old_town',
      }),
    );
    expect(collected.diagnostics).toEqual([]);
    expect(collected.sceneFiles).toHaveLength(1);
  });

  it('assets/ 聚合为文件路径与 assetId（去前缀与扩展名，保留层级）', async () => {
    expect(computeAssetId('assets/bg_town.png')).toBe('bg_town');
    expect(computeAssetId('assets/media/cg_rain.png')).toBe('media/cg_rain');
    expect(computeAssetId('assets/bgm.main')).toBe('bgm');
    const collected = await collectPackage(
      makeSource({
        'assets/bg_town.png': '\u0000png',
        'assets/media/cg_rain.png': '\u0000png',
      }),
    );
    expect(collected.assetFiles).toEqual(['assets/bg_town.png', 'assets/media/cg_rain.png']);
    expect(collected.mediaIds).toEqual(['bg_town', 'media/cg_rain']);
  });

  it('locales/ 聚合语言目录与语言包文件（FR-L10N-02 命名空间镜像）', async () => {
    const collected = await collectPackage(
      makeSource({
        'locales/zh-CN/scenes/arrival.yaml': 'open: 你踏上石板路',
        'locales/zh-CN/ui.yaml': 'title: 旧镇',
        'locales/en-US/ui.yaml': 'title: Old Town',
      }),
    );
    expect([...collected.localeFiles.keys()]).toEqual(['en-US', 'zh-CN']);
    expect(collected.localeFiles.get('zh-CN')).toEqual([
      'locales/zh-CN/scenes/arrival.yaml',
      'locales/zh-CN/ui.yaml',
    ]);
    expect(collected.localeFiles.get('en-US')).toEqual(['locales/en-US/ui.yaml']);
  });

  it('可选目录缺省（无 data/locales/assets）= 空域，无诊断', async () => {
    const collected = await collectPackage(makeSource({ 'manifest.yaml': 'gameId: demo' }));
    expect(collected.sceneFiles).toEqual([]);
    expect(collected.dataFiles).toEqual([]);
    expect(collected.assetFiles).toEqual([]);
    expect(collected.mediaIds).toEqual([]);
    expect(collected.localeFiles.size).toBe(0);
    expect(collected.diagnostics).toEqual([]);
  });
});
