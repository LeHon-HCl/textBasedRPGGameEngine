import { describe, expect, it } from 'vitest';
import { collectPackage } from '../../src/loader/collect.js';
import { InMemoryPackageSource } from '../../src/loader/source-memory.js';
import { parsePackage } from '../../src/loader/parse.js';
import { validatePackage } from '../../src/loader/validate.js';
import type { PackageSource, ValidatedPackage } from '../../src/loader/types.js';

/**
 * parse + validate 用例（06 任务 A3，设计 §3.4 步骤 2/3）。
 *
 * 断言口径：parse 把包文件解析为文档缓存（manifest 缺失/不可解析 → error）；
 * validate 逐域跑 shared 的 Zod schema（SCHEMA_INVALID error 定位到文件）、
 * 检测重复 ID（DUP_ID error），并按 FR-L10N-02 命名空间目录镜像编译语言包
 * （声明语言缺语言包 → warning）。manifest 校验失败时域数据不产出（undefined）。
 */

async function runStages(source: PackageSource): Promise<ValidatedPackage> {
  const collected = await collectPackage(source);
  const parsed = await parsePackage(source, collected);
  return validatePackage(parsed);
}

function loadStages(files: Record<string, string>): Promise<ValidatedPackage> {
  return runStages(new InMemoryPackageSource(files));
}

/** 合法最小包（单场景 + 单事件 + 双语言），供正例断言复用 */
const MINIMAL_PACKAGE: Record<string, string> = {
  'manifest.yaml': [
    'gameId: mini_game',
    'entryScene: arrival',
    'mainLang: zh-CN',
    'langs: [zh-CN, en-US]',
    'contentTags: []',
    'gameVersion: 1.0.0',
    'schemaVersion: 1',
    'minEngineVersion: 0.1.0',
    'redirects: {}',
    'credits: 测试夹具',
  ].join('\n'),
  'data/attrs.yaml':
    'numeric:\n  hp: {min: 0, max: 100, init: 100, show: true}\nlevel: {}\nderived: {}',
  'data/scenes/old_town/arrival.yaml': [
    'id: arrival',
    'area: old_town',
    'segments:',
    '  - key: scenes.arrival.open',
    'choices:',
    '  - id: stay',
    '    textKey: scenes.arrival.choice.stay',
  ].join('\n'),
  'data/events.yaml': [
    '- id: ev_whisper',
    '  where: {area: old_town, location: gate}',
    '  when:',
    '    slots: [morning]',
    '  trigger:',
    '    type: condition',
    '    require: flag.entered',
    '  scene: arrival',
  ].join('\n'),
  'locales/zh-CN/scenes/arrival.yaml': ['open: 你踏上石板路', 'choice:', '  stay: 留在原地'].join(
    '\n',
  ),
  'locales/en-US/scenes/arrival.yaml': [
    'open: You step onto the stones',
    'choice:',
    '  stay: Stay',
  ].join('\n'),
};

describe('parsePackage（管线步骤 2，06 任务 A3）', () => {
  it('manifest 缺失 → error 级 SCHEMA_INVALID（定位 manifest.yaml）', async () => {
    const validated = await loadStages({ 'data/scenes/a/x.yaml': 'id: x\narea: a' });
    const diag = validated.diagnostics.find(
      (d) => d.where['messageKey'] === 'error.loader.manifestMissing',
    );
    expect(diag).toMatchObject({ severity: 'error', code: 'SCHEMA_INVALID' });
    expect(diag?.where['file']).toBe('manifest.yaml');
    expect(validated.domains.manifest).toBeUndefined();
  });

  it('非法 YAML 数据文件 → error 级 SCHEMA_INVALID，且不进入文档缓存', async () => {
    const manifest = MINIMAL_PACKAGE['manifest.yaml'] ?? '';
    const validated = await loadStages({
      'manifest.yaml': manifest,
      'data/attrs.yaml': 'numeric: [unclosed',
    });
    const diag = validated.diagnostics.find(
      (d) =>
        d.where['file'] === 'data/attrs.yaml' &&
        d.where['messageKey'] === 'error.loader.fileUnparseable',
    );
    expect(diag?.severity).toBe('error');
  });
});

describe('validatePackage（管线步骤 3，06 任务 A3）', () => {
  it('合法最小包：manifest 与各域解析落位（NFR-12 单一 schema 来源）', async () => {
    const validated = await loadStages(MINIMAL_PACKAGE);
    expect(validated.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const { manifest, scenes, events, attrs, areas } = validated.domains;
    expect(manifest).toMatchObject({ gameId: 'mini_game', mainLang: 'zh-CN', schemaVersion: 1 });
    expect(scenes.get('arrival')?.def.area).toBe('old_town');
    expect(scenes.get('arrival')?.file).toBe('data/scenes/old_town/arrival.yaml');
    expect(events).toHaveLength(1);
    expect(events[0]?.trigger.type).toBe('condition');
    expect(attrs?.numeric['hp']).toMatchObject({ init: 100 });
    expect(areas.size).toBe(0); // 缺省域 = 空集合，无诊断
  });

  it('manifest 字段非法（mainLang 不在 langs）→ SCHEMA_INVALID，域不产出', async () => {
    const files = { ...MINIMAL_PACKAGE };
    const manifest = MINIMAL_PACKAGE['manifest.yaml'] ?? '';
    files['manifest.yaml'] = manifest.replace('langs: [zh-CN, en-US]', 'langs: [en-US]');
    const validated = await loadStages(files);
    const diag = validated.diagnostics.find(
      (d) =>
        d.where['file'] === 'manifest.yaml' &&
        d.where['messageKey'] === 'error.loader.schemaInvalid',
    );
    expect(diag?.severity).toBe('error');
    expect(validated.domains.manifest).toBeUndefined();
    expect(validated.domains.scenes.size).toBe(0); // manifest 失败 → 不产出域数据
  });

  it('场景域 schema 违例（未知字段，strictObject）→ SCHEMA_INVALID 定位文件', async () => {
    const files = { ...MINIMAL_PACKAGE };
    files['data/scenes/old_town/arrival.yaml'] += '\nunknown_field: oops';
    const validated = await loadStages(files);
    const diag = validated.diagnostics.find(
      (d) => d.where['file'] === 'data/scenes/old_town/arrival.yaml' && d.code === 'SCHEMA_INVALID',
    );
    expect(diag?.severity).toBe('error');
    expect(diag?.where['at']).toBe('unknown_field');
  });

  it('跨目录场景重复 id → DUP_ID（dup-id 负例形态）', async () => {
    const files = { ...MINIMAL_PACKAGE };
    delete files['data/scenes/old_town/arrival.yaml'];
    files['data/scenes/east_gate/checkpoint.yaml'] =
      'id: checkpoint\narea: east_gate\nsegments: []\nchoices: []';
    files['data/scenes/west_gate/checkpoint.yaml'] =
      'id: checkpoint\narea: west_gate\nsegments: []\nchoices: []';
    const validated = await loadStages(files);
    const diag = validated.diagnostics.find((d) => d.code === 'DUP_ID');
    expect(diag).toMatchObject({
      severity: 'error',
      where: {
        kind: 'scene',
        id: 'checkpoint',
        files: 'data/scenes/east_gate/checkpoint.yaml,data/scenes/west_gate/checkpoint.yaml',
      },
    });
  });

  it('单文件数组域重复 id（事件）→ DUP_ID，来源条目定位到 #序号', async () => {
    const files = { ...MINIMAL_PACKAGE };
    files['data/events.yaml'] = [
      '- id: ev_x',
      '  where: {area: old_town}',
      '  when: {}',
      '  trigger: {type: condition, require: flag.a}',
      '  scene: arrival',
      '- id: ev_x',
      '  where: {area: old_town}',
      '  when: {}',
      '  trigger: {type: condition, require: flag.b}',
      '  scene: arrival',
    ].join('\n');
    const validated = await loadStages(files);
    const diag = validated.diagnostics.find((d) => d.code === 'DUP_ID');
    expect(diag).toMatchObject({
      severity: 'error',
      where: { kind: 'events', id: 'ev_x' },
    });
    expect(diag?.where['files']).toContain('data/events.yaml#0');
    expect(diag?.where['files']).toContain('data/events.yaml#1');
  });

  it('多文件实体域重复 id（物品）→ DUP_ID', async () => {
    const files = { ...MINIMAL_PACKAGE };
    files['data/items/bun.yaml'] = 'id: bun\nnameKey: items.bun.name\ntype: consumable';
    files['data/items/bun_two.yaml'] = 'id: bun\nnameKey: items.bun.name\ntype: consumable';
    const validated = await loadStages(files);
    const diag = validated.diagnostics.find((d) => d.code === 'DUP_ID');
    expect(diag).toMatchObject({ where: { kind: 'item', id: 'bun' } });
    expect(diag?.where['files']).toBe('data/items/bun.yaml,data/items/bun_two.yaml');
  });

  it('attrs 跨形态属性 id 重叠（numeric × derived）→ DUP_ID', async () => {
    const files = { ...MINIMAL_PACKAGE };
    files['data/attrs.yaml'] = [
      'numeric:',
      '  power: {min: 0, max: 9, init: 1, show: true}',
      'level: {}',
      'derived:',
      '  power: {formula: "attr.power * 2"}',
    ].join('\n');
    const validated = await loadStages(files);
    const diag = validated.diagnostics.find((d) => d.code === 'DUP_ID');
    expect(diag).toMatchObject({ where: { kind: 'attr', id: 'power' } });
  });

  it('内容标签 id 重复 → DUP_ID', async () => {
    const files = { ...MINIMAL_PACKAGE };
    files['data/content-tags.yaml'] =
      'tags:\n  - {id: general, nameKey: tags.general.name, defaultOn: true}\n  - {id: general, nameKey: tags.general.name, defaultOn: false}';
    const validated = await loadStages(files);
    const diag = validated.diagnostics.find((d) => d.code === 'DUP_ID');
    expect(diag).toMatchObject({ where: { kind: 'contentTag', id: 'general' } });
  });

  it('语言包按命名空间目录镜像展开为键级 Map（FR-L10N-02）', async () => {
    const validated = await loadStages(MINIMAL_PACKAGE);
    const zh = validated.locales.get('zh-CN');
    const en = validated.locales.get('en-US');
    expect(zh?.lang).toBe('zh-CN');
    expect(zh?.keys.get('scenes.arrival.open')).toBe('你踏上石板路');
    expect(zh?.keys.get('scenes.arrival.choice.stay')).toBe('留在原地');
    expect(en?.keys.get('scenes.arrival.open')).toBe('You step onto the stones');
    expect(zh?.keys.size).toBe(2);
  });

  it('声明语言缺语言包目录 → warning（SCHEMA_INVALID，不阻断）', async () => {
    const files = { ...MINIMAL_PACKAGE };
    delete files['locales/en-US/scenes/arrival.yaml'];
    const validated = await loadStages(files);
    const diag = validated.diagnostics.find(
      (d) => d.where['messageKey'] === 'error.loader.localePackMissing',
    );
    expect(diag).toMatchObject({
      severity: 'warning',
      code: 'SCHEMA_INVALID',
      where: { lang: 'en-US' },
    });
    // 主语言包不受影响，且空包仍登记（回退语义由文本解析器承担）
    expect(validated.locales.get('en-US')?.keys.size).toBe(0);
    expect(validated.locales.get('zh-CN')?.keys.size).toBe(2);
  });

  it('主语言包存在但零键 → warning（§3.4 主语言缺失 warning）', async () => {
    const files = { ...MINIMAL_PACKAGE };
    files['locales/zh-CN/empty.yaml'] = '# 空词典';
    delete files['locales/zh-CN/scenes/arrival.yaml'];
    const validated = await loadStages(files);
    const diag = validated.diagnostics.find(
      (d) => d.where['messageKey'] === 'error.loader.localePackMissing',
    );
    expect(diag).toMatchObject({ severity: 'warning', where: { lang: 'zh-CN' } });
    expect(diag?.where['detail']).toContain('不含任何键');
  });

  it('未声明语言的 locale 目录不加载（manifest.langs 为权威）', async () => {
    const files = { ...MINIMAL_PACKAGE };
    files['locales/fr-FR/ui.yaml'] = 'title: Bonjour';
    const validated = await loadStages(files);
    expect(validated.locales.has('fr-FR')).toBe(false);
    expect(validated.diagnostics.filter((d) => d.where['lang'] === 'fr-FR')).toEqual([]);
  });

  it('未识别的 data/ 文件静默忽略（向前兼容后续数据域）', async () => {
    const files = { ...MINIMAL_PACKAGE };
    files['data/future-domain.yaml'] = 'whatever: true';
    const validated = await loadStages(files);
    expect(
      validated.diagnostics.filter((d) => d.where['file'] === 'data/future-domain.yaml'),
    ).toEqual([]);
  });
});

// ---- 09 任务 1：data/time.yaml（TimeConfig 可选单对象域） --------------------

describe('validatePackage：data/time.yaml（09 任务 1）', () => {
  const TIME_YAML = [
    'slots:',
    '  - {id: slot_morning, nameKey: time.slot.morning}',
    '  - {id: slot_noon, nameKey: time.slot.noon}',
    '  - {id: slot_evening, nameKey: time.slot.evening}',
    '  - {id: slot_night, nameKey: time.slot.night}',
    'weekdays:',
    '  - {nameKey: time.weekday.1}',
    '  - {nameKey: time.weekday.2}',
    '  - {nameKey: time.weekday.3}',
    '  - {nameKey: time.weekday.4}',
    '  - {nameKey: time.weekday.5}',
    '  - {nameKey: time.weekday.6}',
    '  - {nameKey: time.weekday.7}',
    'startWeekday: 1',
  ].join('\n');

  it('合法 time.yaml → domains.time 产出（时段/星期/起始星期）', async () => {
    const files = { ...MINIMAL_PACKAGE, 'data/time.yaml': TIME_YAML };
    const validated = await loadStages(files);
    expect(validated.domains.time).toEqual({
      slots: [
        { id: 'slot_morning', nameKey: 'time.slot.morning' },
        { id: 'slot_noon', nameKey: 'time.slot.noon' },
        { id: 'slot_evening', nameKey: 'time.slot.evening' },
        { id: 'slot_night', nameKey: 'time.slot.night' },
      ],
      weekdays: Array.from({ length: 7 }, (_, i) => ({ nameKey: `time.weekday.${i + 1}` })),
      startWeekday: 1,
    });
    expect(validated.diagnostics.filter((d) => d.where['file'] === 'data/time.yaml')).toEqual([]);
  });

  it('缺省不产出 domains.time（时间域可选；宿主用缺省日历）', async () => {
    const validated = await loadStages(MINIMAL_PACKAGE);
    expect(validated.domains.time).toBeUndefined();
  });

  it('startWeekday 超出星期数 → error 级 SCHEMA_INVALID 定位 data/time.yaml', async () => {
    const files = { ...MINIMAL_PACKAGE, 'data/time.yaml': `${TIME_YAML.replace('startWeekday: 1', 'startWeekday: 8')}` };
    const validated = await loadStages(files);
    const diag = validated.diagnostics.find((d) => d.where['file'] === 'data/time.yaml');
    expect(diag).toMatchObject({ severity: 'error', code: 'SCHEMA_INVALID' });
    expect(validated.domains.time).toBeUndefined();
  });
});
