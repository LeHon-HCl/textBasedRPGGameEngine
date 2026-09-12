import { describe, expect, it } from 'vitest';
import { loadGamePackage } from '../../src/loader/pipeline.js';
import { InMemoryPackageSource } from '../../src/loader/source-memory.js';
import type { GameDefinition, LocaleRecord } from '../../src/loader/index.js';

/**
 * 语言包结构文本值透传用例（07 任务 3 的加载侧适配，设计 §4.1 / FR-L10N-04）。
 *
 * 断言口径（加法式适配，不改变 06 号既有展开语义）：
 * - 记录值含顶层 `plural` / `select` 属性 → 整体透传为 LocaleRecord 键值
 *   （§4.1「键值可为结构」），不再按命名空间展开为 `key.plural.one` 等碎片键；
 * - 普通组织性嵌套（如 choice 分组）仍按命名空间展开为键级条目（FR-L10N-02）；
 * - mini-game 风格扁平键不受影响；结构值随后经 TextResolver 解析
 *   （i18n 侧用例见 test/i18n/variants.test.ts 与 dictionary-fixture.test.ts）。
 */

const FILES: Record<string, string> = {
  'manifest.yaml': [
    'gameId: i18n_fixture',
    'entryScene: arrival',
    'mainLang: zh-CN',
    'langs: [zh-CN, en-US]',
    'contentTags: []',
    'gameVersion: 1.0.0',
    'schemaVersion: 1',
    'minEngineVersion: 0.1.0',
    'redirects: {}',
    'credits: 07 号结构透传夹具',
  ].join('\n'),
  'data/attrs.yaml':
    'numeric:\n  hp: {min: 0, max: 100, init: 100, show: true}\nlevel: {}\nderived: {}',
  'data/areas/old_town.yaml': [
    'id: old_town',
    'nameKey: areas.old_town.name',
    'locations:',
    '  gate: {nameKey: areas.old_town.gate, moveCost: 1, mapPos: [10, 20]}',
  ].join('\n'),
  'data/scenes/old_town/arrival.yaml': [
    'id: arrival',
    'area: old_town',
    'segments:',
    '  - key: scenes.arrival.open',
    'choices:',
    '  - id: stay',
    '    textKey: scenes.arrival.choice.stay',
  ].join('\n'),
  'locales/zh-CN/scenes/arrival.yaml': ['open: 你踏上石板路', 'choice:', '  stay: 留在原地'].join(
    '\n',
  ),
  'locales/en-US/scenes/arrival.yaml': [
    'open: You step onto the stones',
    'choice:',
    '  stay: Stay',
  ].join('\n'),
  'locales/zh-CN/areas/old_town.yaml': ['name: 旧镇', 'gate: 镇口'].join('\n'),
  'locales/en-US/areas/old_town.yaml': ['name: Old Town', 'gate: Town Gate'].join('\n'),
  // 结构文本值：复数（plural）与选择（select）
  'locales/zh-CN/scenes/bun.yaml': [
    'count_msg:',
    '  plural:',
    '    one: 你手里攥着 {count} 个肉包。',
    '    other: 你手里攥着 {count} 个肉包，还热乎。',
    'choice:',
    '  eat: 吃掉它',
  ].join('\n'),
  'locales/zh-CN/scenes/mood.yaml': [
    'line:',
    '  select:',
    '    expr: "flag.mood"',
    '    cases:',
    '      friendly: 她朝你笑了笑。',
    '      stranger: 她警惕地看着你。',
  ].join('\n'),
};

async function loadPackage(): Promise<GameDefinition> {
  return loadGamePackage(new InMemoryPackageSource(FILES));
}

/** 主语言包取值（缺失即测试夹具缺陷，显性失败） */
function mainPackOf(def: GameDefinition) {
  const pack = def.locales[def.manifest.mainLang];
  if (pack === undefined) throw new Error(`主语言包 ${def.manifest.mainLang} 未登记`);
  return pack;
}

describe('语言包结构文本值透传（07 任务 3 加载侧适配）', () => {
  it('plural 结构整体透传为 LocaleRecord 键值（不展开为碎片键）', async () => {
    const def = await loadPackage();
    const keys = mainPackOf(def).keys;
    const value = keys.get('scenes.bun.count_msg');
    expect(typeof value).toBe('object');
    const plural = (value as LocaleRecord)['plural'] as LocaleRecord;
    expect(plural['one']).toBe('你手里攥着 {count} 个肉包。');
    expect(plural['other']).toBe('你手里攥着 {count} 个肉包，还热乎。');
    expect(keys.has('scenes.bun.count_msg.plural.one')).toBe(false);
  });

  it('select 结构整体透传（expr 字符串与 cases 记录原样保留）', async () => {
    const def = await loadPackage();
    const keys = mainPackOf(def).keys;
    const select = (keys.get('scenes.mood.line') as LocaleRecord)['select'] as LocaleRecord;
    expect(select['expr']).toBe('flag.mood');
    const cases = select['cases'] as LocaleRecord;
    expect(cases['friendly']).toBe('她朝你笑了笑。');
    expect(cases['stranger']).toBe('她警惕地看着你。');
    expect(keys.has('scenes.mood.line.select.expr')).toBe(false);
  });

  it('普通组织性嵌套仍按命名空间展开（FR-L10N-02 不变）', async () => {
    const def = await loadPackage();
    const keys = mainPackOf(def).keys;
    expect(keys.get('scenes.arrival.choice.stay')).toBe('留在原地');
    expect(keys.get('scenes.bun.choice.eat')).toBe('吃掉它');
    expect(typeof keys.get('scenes.arrival.open')).toBe('string');
  });
});
