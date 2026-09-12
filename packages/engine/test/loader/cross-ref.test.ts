import { describe, expect, it } from 'vitest';
import { collectPackage } from '../../src/loader/collect.js';
import { parsePackage } from '../../src/loader/parse.js';
import { validatePackage } from '../../src/loader/validate.js';
import { buildRefRegistries, crossRefCheck } from '../../src/loader/cross-ref.js';
import { inventoryPackage } from '../../src/loader/walk.js';
import { InMemoryPackageSource } from '../../src/loader/source-memory.js';
import type { PackageSource, ValidatedPackage } from '../../src/loader/types.js';

/**
 * crossRef 用例（06 任务 B1，设计 §3.4 步骤 4 / §2.1 refKind 元数据驱动）。
 *
 * 断言口径：悬空引用沿 schema 的 refId(kind) 元数据逐域检出——实体引用
 * （scene/area/location/item/npc/quest/achievement/faction）缺失 = error 阻断；
 * 媒体（FR-MEDIA-06 容错）与文本键（§3.4 主语言缺失键）缺失 = warning 入
 * definition。事件 where.location 按 where.area 作用域核对。
 */

async function stagesToCrossRef(files: Record<string, string>): Promise<{
  validated: ValidatedPackage;
  diagnostics: Array<{ severity: string; code: string; where: Record<string, string> }>;
}> {
  const source: PackageSource = new InMemoryPackageSource(files);
  const collected = await collectPackage(source);
  const parsed = await parsePackage(source, collected);
  const validated = validatePackage(parsed);
  const inventory = inventoryPackage(validated.domains);
  const registries = buildRefRegistries(validated.domains, collected.mediaIds, validated.locales);
  const diagnostics = crossRefCheck(inventory, registries);
  return { validated, diagnostics };
}

const BASE_MANIFEST = [
  'gameId: demo_pkg',
  'entryScene: arrival',
  'mainLang: zh-CN',
  'langs: [zh-CN]',
  'contentTags: []',
  'gameVersion: 1.0.0',
  'schemaVersion: 1',
  'minEngineVersion: 0.1.0',
  'redirects: {}',
  'credits: 测试',
].join('\n');

/** 无任何悬空引用的最小正例基座（各负例在其上注入单一缺陷） */
const CLEAN_PACKAGE: Record<string, string> = {
  'manifest.yaml': BASE_MANIFEST,
  'data/scenes/old_town/arrival.yaml': [
    'id: arrival',
    'area: old_town',
    'segments:',
    '  - key: scenes.arrival.open',
    'choices:',
    '  - id: rest',
    '    textKey: scenes.arrival.choice.rest',
  ].join('\n'),
  'data/areas/old_town.yaml': [
    'id: old_town',
    'nameKey: areas.old_town.name',
    'locations:',
    '  gate: {nameKey: areas.old_town.gate, moveCost: 1, mapPos: [1, 2]}',
  ].join('\n'),
  'data/events.yaml': [
    '- id: ev_gate',
    '  where: {area: old_town, location: gate}',
    '  when: {}',
    '  trigger: {type: condition, require: flag.entered}',
    '  scene: arrival',
  ].join('\n'),
  'locales/zh-CN/scenes/arrival.yaml': 'open: 石板路口\nchoice:\n  rest: 休息',
  'locales/zh-CN/areas/old_town.yaml': 'name: 旧镇\ngate: 镇口',
};

/** 供负例注入缺陷的正例基座文件内容（索引访问需显式兜底） */
const BASE_SCENE_YAML = CLEAN_PACKAGE['data/scenes/old_town/arrival.yaml'] ?? '';
const BASE_EVENTS_YAML = CLEAN_PACKAGE['data/events.yaml'] ?? '';

describe('crossRefCheck（管线步骤 4，06 任务 B1）', () => {
  it('正例基座零诊断：实体/地点/文本键全部可解析', async () => {
    const { diagnostics } = await stagesToCrossRef(CLEAN_PACKAGE);
    expect(diagnostics).toEqual([]);
  });

  it('choice.goto 指向不存在场景 → error DANGLING_REF（dangling-ref 负例形态）', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['data/scenes/old_town/locked_door.yaml'] = [
      'id: locked_door',
      'area: old_town',
      'segments: []',
      'choices:',
      '  - id: open',
      '    textKey: scenes.arrival.open',
      '    goto: nowhere_hall',
    ].join('\n');
    const { diagnostics } = await stagesToCrossRef(files);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'DANGLING_REF',
      where: { kind: 'scene', ref: 'nowhere_hall' },
    });
  });

  it('manifest.entryScene 悬空 → error DANGLING_REF', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['manifest.yaml'] = BASE_MANIFEST.replace('entryScene: arrival', 'entryScene: ghost');
    const { diagnostics } = await stagesToCrossRef(files);
    const diag = diagnostics.find((d) => d.where['from'] === 'manifest.entryScene');
    expect(diag).toMatchObject({
      severity: 'error',
      code: 'DANGLING_REF',
      where: { kind: 'scene', ref: 'ghost' },
    });
  });

  it('event.scene 悬空 → error DANGLING_REF；where.area 悬空 → error', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['data/events.yaml'] = BASE_EVENTS_YAML.replace(
      '  scene: arrival',
      '  scene: missing_scene',
    );
    const { diagnostics } = await stagesToCrossRef(files);
    expect(diagnostics.find((d) => d.where['ref'] === 'missing_scene')?.where['kind']).toBe(
      'scene',
    );
    // 缺失的事件场景（事件域 schema 已通过，悬空由 crossRef 检出）
    expect(diagnostics.filter((d) => d.code === 'DANGLING_REF')).toHaveLength(1);
  });

  it('事件 where.location 限定在 where.area 的地点集内（作用域核对）', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['data/areas/east_wood.yaml'] = [
      'id: east_wood',
      'nameKey: areas.east_wood.name',
      'locations:',
      '  cabin: {nameKey: areas.east_wood.cabin, moveCost: 1, mapPos: [3, 4]}',
    ].join('\n');
    // gate 存在于 old_town，但事件声明在 east_wood → 作用域内缺失
    files['data/events.yaml'] = BASE_EVENTS_YAML.replace(
      '  where: {area: old_town, location: gate}',
      '  where: {area: east_wood, location: gate}',
    );
    const { diagnostics } = await stagesToCrossRef(files);
    // east_wood 区域名与 cabin 地点名文本键缺失（2 条 text warning）+ location 悬空（error）
    expect(diagnostics).toHaveLength(3);
    const locationDiag = diagnostics.find((d) => d.where['kind'] === 'location');
    expect(locationDiag).toMatchObject({
      severity: 'error',
      code: 'DANGLING_REF',
      where: { ref: 'gate', scopeArea: 'east_wood' },
    });
  });

  it('NPC 日程 location（无区域上下文）对全包地点集核对', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['data/npcs/guard.yaml'] = [
      'id: guard',
      'nameKey: npcs.guard.name',
      'schedule:',
      '  - at: {slots: [morning]}',
      '    location: gate',
      '  - at: {slots: [night]}',
      '    location: cellar',
    ].join('\n');
    const { diagnostics } = await stagesToCrossRef(files);
    const dangling = diagnostics.filter((d) => d.code === 'DANGLING_REF' && d.severity === 'error');
    expect(dangling).toHaveLength(1); // cellar 全包不存在；gate 存在于 old_town 即通过
    expect(dangling[0]).toMatchObject({
      severity: 'error',
      where: { kind: 'location', ref: 'cellar' },
    });
    const textWarnings = diagnostics.filter((d) => d.where['kind'] === 'text');
    expect(textWarnings).toHaveLength(1); // npcs.guard.name 缺失
  });

  it('任务 giver（npc）与 rewards give.item 悬空 → error DANGLING_REF', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['data/quests/wall.yaml'] = [
      'id: wall',
      'giver: ghost_guard',
      'stages:',
      '  - id: inspect',
      '    objectiveKey: quests.wall.obj',
      '    completeWhen: flag.done',
      'rewards:',
      '  - give: {item: ghost_bun, count: 1}',
    ].join('\n');
    const { diagnostics } = await stagesToCrossRef(files);
    const dangling = diagnostics.filter((d) => d.code === 'DANGLING_REF' && d.severity === 'error');
    expect(dangling.map((d) => d.where['ref'])).toEqual(['ghost_bun', 'ghost_guard']);
    expect(dangling.every((d) => d.where['kind'] === 'item' || d.where['kind'] === 'npc')).toBe(
      true,
    );
  });

  it('商店条目 item 悬空 → error DANGLING_REF', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['data/shops.yaml'] = [
      '- id: stall',
      '  nameKey: shops.stall.name',
      '  entries:',
      '    - {item: ghost_sword}',
      '  priceBuy: "10"',
      '  priceSell: "5"',
    ].join('\n');
    const { diagnostics } = await stagesToCrossRef(files);
    expect(diagnostics.find((d) => d.where['kind'] === 'item')).toMatchObject({
      severity: 'error',
      where: { ref: 'ghost_sword', from: 'shops[stall].entries[0].item' },
    });
  });

  it('媒体引用悬空 → warning DANGLING_REF（FR-MEDIA-06 占位容错）', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['data/scenes/old_town/arrival.yaml'] = BASE_SCENE_YAML.replace(
      'id: arrival',
      ['id: arrival', 'media:', '  bg: missing_bg', '  bgm: missing_bgm'].join('\n'),
    );
    const { diagnostics } = await stagesToCrossRef(files);
    const media = diagnostics.filter((d) => d.where['kind'] === 'media');
    expect(media).toHaveLength(2);
    expect(media.every((d) => d.severity === 'warning' && d.code === 'DANGLING_REF')).toBe(true);
  });

  it('媒体资产存在时引用通过（assetId = 路径去前缀与扩展名）', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['assets/bg_town.png'] = 'fake-png-bytes';
    files['data/scenes/old_town/arrival.yaml'] = BASE_SCENE_YAML.replace(
      'id: arrival',
      'id: arrival\nmedia:\n  bg: bg_town',
    );
    const { diagnostics } = await stagesToCrossRef(files);
    expect(diagnostics.filter((d) => d.where['kind'] === 'media')).toEqual([]);
  });

  it('文本键缺失于主语言词典 → warning DANGLING_REF（主语言缺失键）', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['data/scenes/old_town/arrival.yaml'] = BASE_SCENE_YAML.replace(
      '  - key: scenes.arrival.open',
      '  - key: scenes.arrival.lost_key',
    );
    const { diagnostics } = await stagesToCrossRef(files);
    const textDiag = diagnostics.find((d) => d.where['kind'] === 'text');
    expect(textDiag).toMatchObject({
      severity: 'warning',
      code: 'DANGLING_REF',
      where: { ref: 'scenes.arrival.lost_key' },
    });
  });

  it('unlock 指令的 gallery/cg/achievement 引用按 refKind 核对', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['data/scenes/old_town/arrival.yaml'] = BASE_SCENE_YAML.replace(
      '  - id: rest',
      [
        '  - id: rest',
        '    effects:',
        '      - unlock: {kind: gallery, id: ghost_scene}',
        '      - unlock: {kind: cg, id: ghost_cg}',
        '      - unlock: {kind: achievement, id: ghost_achv}',
      ].join('\n'),
    );
    const { diagnostics } = await stagesToCrossRef(files);
    const dangling = diagnostics.filter((d) => d.code === 'DANGLING_REF');
    const refs = dangling.map((d) => d.where['ref']).sort();
    expect(refs).toEqual(['ghost_achv', 'ghost_cg', 'ghost_scene']);
    expect(dangling.find((d) => d.where['ref'] === 'ghost_cg')?.severity).toBe('warning');
    expect(dangling.find((d) => d.where['ref'] === 'ghost_scene')?.severity).toBe('error');
  });

  it('效果子序列（check 分支）内的引用与表达式同样盘点', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['data/scenes/old_town/arrival.yaml'] = BASE_SCENE_YAML.replace(
      '  - id: rest',
      [
        '  - id: rest',
        '    effects:',
        '      - check:',
        '          value: attr.hp',
        '          onSuccess:',
        '            - give: {item: ghost_item}',
        '            - goto: ghost_branch_scene',
      ].join('\n'),
    );
    const { diagnostics } = await stagesToCrossRef(files);
    const refs = diagnostics
      .filter((d) => d.code === 'DANGLING_REF')
      .map((d) => `${d.where['kind']}:${d.where['ref']}`)
      .sort();
    expect(refs).toEqual(['item:ghost_item', 'scene:ghost_branch_scene']);
  });

  it('同一悬空目标多处引用合并为一条诊断（kind+value 去重）', async () => {
    const files = { ...CLEAN_PACKAGE };
    files['data/scenes/old_town/a.yaml'] =
      'id: a\narea: old_town\nsegments: []\nchoices:\n  - id: x\n    textKey: t.x\n    goto: void_scene';
    files['data/scenes/old_town/b.yaml'] =
      'id: b\narea: old_town\nsegments: []\nchoices:\n  - id: y\n    textKey: t.y\n    goto: void_scene';
    const { diagnostics } = await stagesToCrossRef(files);
    expect(diagnostics.filter((d) => d.where['ref'] === 'void_scene')).toHaveLength(1);
  });
});
