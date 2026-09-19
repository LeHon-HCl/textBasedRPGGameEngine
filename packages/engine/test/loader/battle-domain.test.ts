import { describe, expect, it } from 'vitest';
import { collectPackage } from '../../src/loader/collect.js';
import { parsePackage } from '../../src/loader/parse.js';
import { validatePackage } from '../../src/loader/validate.js';
import { buildRefRegistries, crossRefCheck } from '../../src/loader/cross-ref.js';
import { inventoryPackage } from '../../src/loader/walk.js';
import { InMemoryPackageSource } from '../../src/loader/source-memory.js';
import type { PackageSource, ValidatedPackage } from '../../src/loader/types.js';

/**
 * 战斗数据域加载用例（16 号回填，设计 §5.2 EncounterDef 缺口；约束 8）。
 *
 * 覆盖：
 * - `data/enemies.yaml` / `data/encounters.yaml` 单文件数组域加载 + DUP_ID；
 * - crossRef：encounter.enemies 的 enemy 引用悬空 = error（内容断裂）；
 *   battle 指令的 encounter 引用悬空 = error（约束 8 加载期完整性——此前
 *   `battle.encounter` 是自由串，运行期才炸）；
 * - 无战斗数据的既有包零新增诊断（向前兼容）。
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
  'data/enemies.yaml': [
    '- id: rat',
    '  nameKey: enemies.rat.name',
    '  hp: 12',
    '  attrs: {atk: 4, def: 1, spd: 6}',
    '  skills:',
    '    - {id: bite, params: {mult: 1}}',
  ].join('\n'),
  'data/encounters.yaml': [
    '- id: enc_sewer',
    '  enemies: [rat, rat]',
    '  openingKey: encounters.sewer.opening',
    '  victoryKey: encounters.sewer.victory',
    '  defeatKey: encounters.sewer.defeat',
    '  escapeRate: 0.6',
    '  rewards:',
    '    - money: {currency: silver, amount: 10}',
  ].join('\n'),
  'locales/zh-CN/scenes/arrival.yaml': 'open: 石板路口\nchoice:\n  rest: 休息',
  'locales/zh-CN/areas/old_town.yaml': 'name: 旧镇\ngate: 镇口',
  'locales/zh-CN/enemies/rat.yaml': 'name: 硕鼠',
  'locales/zh-CN/encounters/sewer.yaml':
    'opening: 鼠群扑来\nvictory: 鼠群散去\ndefeat: 你被拖进了下水道',
};

describe('battle 数据域加载（16 号回填，约束 8）', () => {
  it('enemies/encounters 域加载进 PackageDomains 且发布到 GameDefinition 组装源', async () => {
    const { validated } = await stagesToCrossRef(CLEAN_PACKAGE);
    expect([...validated.domains.enemies.keys()]).toEqual(['rat']);
    expect([...validated.domains.encounters.keys()]).toEqual(['enc_sewer']);
    const encounter = validated.domains.encounters.get('enc_sewer');
    expect(encounter).toMatchObject({
      enemies: ['rat', 'rat'],
      escapeRate: 0.6,
    });
    // rewards 效果序列进数据面（结算归 W2）
    expect(encounter?.rewards).toEqual([{ money: { currency: 'silver', amount: 10 } }]);
  });

  it('正例基座零 crossRef 诊断（enemy/文本键全部可解析）', async () => {
    const { diagnostics } = await stagesToCrossRef(CLEAN_PACKAGE);
    expect(diagnostics).toEqual([]);
  });

  it('域内重复 id → DUP_ID', async () => {
    const files = {
      ...CLEAN_PACKAGE,
      'data/enemies.yaml':
        (CLEAN_PACKAGE['data/enemies.yaml'] ?? '') +
        '\n- id: rat\n  nameKey: enemies.rat2.name\n  hp: 5\n  attrs: {}\n  skills: [{id: bite}]',
    };
    const { validated } = await stagesToCrossRef(files);
    // validate 步骤已收集诊断（collectArrayDomain 的 DUP_ID 口径）
    const dup = validated.diagnostics.filter((d) => d.code === 'DUP_ID');
    expect(dup.length).toBeGreaterThan(0);
  });

  it('encounter.enemies 悬空 enemy 引用 → error DANGLING_REF', async () => {
    const files = {
      ...CLEAN_PACKAGE,
      'data/encounters.yaml': (CLEAN_PACKAGE['data/encounters.yaml'] ?? '').replace(
        'enemies: [rat, rat]',
        'enemies: [rat, rat_ghost]',
      ),
    };
    const { diagnostics } = await stagesToCrossRef(files);
    const dangling = diagnostics.find(
      (d) => d.code === 'DANGLING_REF' && d.where['kind'] === 'enemy',
    );
    expect(dangling).toMatchObject({
      severity: 'error',
      where: { kind: 'enemy', ref: 'rat_ghost' },
    });
  });

  it('battle 指令引用不存在的 encounter → error DANGLING_REF（约束 8：加载期拦截，不再等到运行期）', async () => {
    const files = {
      ...CLEAN_PACKAGE,
      'data/scenes/old_town/arrival.yaml': [
        'id: arrival',
        'area: old_town',
        'segments:',
        '  - key: scenes.arrival.open',
        'choices:',
        '  - id: fight',
        '    textKey: scenes.arrival.choice.rest',
        '    effects:',
        '      - battle: {encounter: enc_ghost}',
      ].join('\n'),
    };
    const { diagnostics } = await stagesToCrossRef(files);
    const dangling = diagnostics.find(
      (d) => d.code === 'DANGLING_REF' && d.where['kind'] === 'encounter',
    );
    expect(dangling).toMatchObject({
      severity: 'error',
      where: {
        kind: 'encounter',
        ref: 'enc_ghost',
        from: 'scenes[arrival].choices[0].effects[0].battle.encounter',
      },
    });
  });

  it('无战斗数据的既有包：零新增诊断（向前兼容）', async () => {
    const files = { ...CLEAN_PACKAGE };
    delete files['data/enemies.yaml'];
    delete files['data/encounters.yaml'];
    const { diagnostics } = await stagesToCrossRef(files);
    expect(diagnostics).toEqual([]);
  });
});
