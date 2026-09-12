import { describe, expect, it } from 'vitest';
import type { Lang } from '@game/shared';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { createTextResolver } from '../../src/i18n/text-resolver.js';
import type { InterpVars, TextResolverWarn } from '../../src/i18n/text-resolver.js';
import { makeEvalContext, makeScope, pack, recordWarn } from './fixtures.js';
import type { ExprScope } from '@game/shared';
import type { LocalePack } from '../../src/loader/index.js';

/**
 * 词典夹具表驱动测试（07 任务 6，设计 §4.1「独立测试：词典夹具断言
 * 插值/复数/select/回退链/格式化」）。
 *
 * 一份多语言词典夹具（zh-CN 主语言 + en-US + ja-JP）作为唯一事实来源，
 * 按类别表驱动覆盖全路径：
 * - 插值 {path}（直查 / 回退后插值 / 变量缺失保留占位符）；
 * - 格式化 {path|fmt:number:1} 与 {path|fmt:number:+1}（直查 / 回退后格式化 /
 *   字符串值拒格式化）；
 * - 复数 plural（one/other / 回退后解析 / 计数缺失落缺失告警）；
 * - select（状态选 case / other 兜底 / 回退后解析 / 分支内插值）；
 * - 回退链与缺失告警（目标语言缺 → 主语言；主语言亦缺 → 原始键；
 *   不可渲染值 → 走缺失路径）。
 */

/** 词典夹具：一次声明，所有表共用（键 → 主语言 zh-CN 基准 + 译文覆盖面） */
const DICTIONARY: Record<Lang, LocalePack> = {
  'zh-CN': pack('zh-CN', {
    'ui.title': '旧镇轶事',
    'scenes.arrival.open': '你踏上石板路。',
    'npc.hawker.greet': '「{player.name}，来个热乎的肉包？」',
    'stats.hp.line': '体力 {hp|fmt:number:1}（{hpDelta|fmt:number:+1}）',
    'stats.gold.line': '金币 {gold|fmt:number:0}',
    'item.warm_bun.count': {
      plural: {
        one: '手里攥着 1 个肉包。',
        other: '手里攥着 {count} 个肉包。',
      },
    },
    'scenes.mood.line': {
      select: {
        expr: 'flag.mood',
        cases: {
          friendly: '她朝你笑了笑。',
          stranger: '她警惕地看着你。',
          other: '她看了你一眼。',
        },
      },
    },
    // 防御分支夹具：数组叶子合法但不可渲染（加载器正常产物为字符串/结构）
    'scenes.bad.value': ['甲', '乙'],
  }),
  'en-US': pack('en-US', {
    'ui.title': 'Tales of the Old Town',
    'scenes.arrival.open': 'You step onto the stones.',
    'stats.hp.line': 'Stamina {hp|fmt:number:1} ({hpDelta|fmt:number:+1})',
    'scenes.mood.line': {
      select: {
        expr: 'flag.mood',
        cases: {
          friendly: 'She smiles at you, {player.name}.',
          other: 'She glances at you.',
        },
      },
    },
    'en.only.key': 'Only in English.',
  }),
  'ja-JP': pack('ja-JP', {
    'scenes.arrival.open': '石畳を踏む。',
  }),
};

/** 表驱动行：一次 resolve 的完整期望（文本 / found / fallbackUsed / 告警数） */
interface MatrixRow {
  readonly label: string;
  readonly key: string;
  readonly lang: Lang;
  readonly vars?: InterpVars;
  readonly mood?: string;
  readonly expected: string;
  readonly found: boolean;
  readonly fallbackUsed: boolean;
  readonly warns: number;
}

/** 以词典夹具构造 resolver（mood 决定 select 求值作用域，默认 friendly） */
function makeResolver(mood: string, warn: TextResolverWarn) {
  const base = makeScope();
  const scope: ExprScope = makeScope({ world: { flags: { mood }, time: base.world.time } });
  return createTextResolver({
    mainLang: 'zh-CN',
    locales: DICTIONARY,
    functionRegistry: createBuiltinFunctionRegistry(),
    evalContext: () => makeEvalContext(scope),
    warn,
  });
}

function expectRow(row: MatrixRow): void {
  const { calls, warn } = recordWarn();
  const resolved = makeResolver(row.mood ?? 'friendly', warn).resolve(
    row.key,
    row.lang,
    row.vars ?? {},
  );
  expect(resolved.text, row.label).toBe(row.expected);
  expect(resolved.found, row.label).toBe(row.found);
  expect(resolved.fallbackUsed, row.label).toBe(row.fallbackUsed);
  expect(resolved.key, row.label).toBe(row.key);
  expect(calls, row.label).toHaveLength(row.warns);
}

describe('词典夹具表驱动：插值 {path}（07 任务 6）', () => {
  it.each<MatrixRow>([
    {
      label: '主语言直查 + 插值',
      key: 'npc.hawker.greet',
      lang: 'zh-CN',
      vars: { 'player.name': '阿澈' },
      expected: '「阿澈，来个热乎的肉包？」',
      found: true,
      fallbackUsed: false,
      warns: 0,
    },
    {
      label: '译文直查 + 插值（en-US 有同键译文）',
      key: 'ui.title',
      lang: 'en-US',
      expected: 'Tales of the Old Town',
      found: true,
      fallbackUsed: false,
      warns: 0,
    },
    {
      label: '第三语言直查（ja-JP 仅有的键，不回退）',
      key: 'scenes.arrival.open',
      lang: 'ja-JP',
      expected: '石畳を踏む。',
      found: true,
      fallbackUsed: false,
      warns: 0,
    },
    {
      label: 'ja-JP 缺键 → 回退主语言后仍执行插值',
      key: 'npc.hawker.greet',
      lang: 'ja-JP',
      vars: { 'player.name': '阿澈' },
      expected: '「阿澈，来个热乎的肉包？」',
      found: true,
      fallbackUsed: true,
      warns: 1,
    },
    {
      label: '变量未提供 → 保留原始占位符 + 告警（键仍算命中）',
      key: 'npc.hawker.greet',
      lang: 'zh-CN',
      expected: '「{player.name}，来个热乎的肉包？」',
      found: true,
      fallbackUsed: false,
      warns: 1,
    },
  ])('$label', expectRow);
});

describe('词典夹具表驱动：格式化 {path|fmt:number:1}（07 任务 6）', () => {
  it.each<MatrixRow>([
    {
      label: '主语言直查 + 精度与显式正负号',
      key: 'stats.hp.line',
      lang: 'zh-CN',
      vars: { hp: 7.24, hpDelta: 2 },
      expected: '体力 7.2（+2.0）',
      found: true,
      fallbackUsed: false,
      warns: 0,
    },
    {
      label: '译文直查 + 同名占位符格式化（en-US 模板）',
      key: 'stats.hp.line',
      lang: 'en-US',
      vars: { hp: 7.24, hpDelta: -3.56 },
      expected: 'Stamina 7.2 (-3.6)',
      found: true,
      fallbackUsed: false,
      warns: 0,
    },
    {
      label: 'ja-JP 缺键 → 回退主语言后格式化',
      key: 'stats.gold.line',
      lang: 'ja-JP',
      vars: { gold: 42 },
      expected: '金币 42',
      found: true,
      fallbackUsed: true,
      warns: 1,
    },
    {
      label: '字符串值拒数值格式化（无隐式转换）→ 保留占位符 + 告警',
      key: 'stats.gold.line',
      lang: 'zh-CN',
      vars: { gold: '3' },
      expected: '金币 {gold|fmt:number:0}',
      found: true,
      fallbackUsed: false,
      warns: 1,
    },
  ])('$label', expectRow);
});

describe('词典夹具表驱动：复数 plural（07 任务 6）', () => {
  it.each<MatrixRow>([
    {
      label: 'count=1 → one 分支',
      key: 'item.warm_bun.count',
      lang: 'zh-CN',
      vars: { count: 1 },
      expected: '手里攥着 1 个肉包。',
      found: true,
      fallbackUsed: false,
      warns: 0,
    },
    {
      label: 'count=3 → other 分支（模板内插值）',
      key: 'item.warm_bun.count',
      lang: 'zh-CN',
      vars: { count: 3 },
      expected: '手里攥着 3 个肉包。',
      found: true,
      fallbackUsed: false,
      warns: 0,
    },
    {
      label: 'ja-JP 缺键 → 回退主语言 plural 结构解析',
      key: 'item.warm_bun.count',
      lang: 'ja-JP',
      vars: { count: 0 },
      expected: '手里攥着 0 个肉包。',
      found: true,
      fallbackUsed: true,
      warns: 1,
    },
    {
      label: '计数缺失 → 复数告警 + 落缺失路径（显示原始键）',
      key: 'item.warm_bun.count',
      lang: 'zh-CN',
      expected: 'item.warm_bun.count',
      found: false,
      fallbackUsed: false,
      warns: 2,
    },
  ])('$label', expectRow);
});

describe('词典夹具表驱动：select 变体（07 任务 6）', () => {
  it.each<MatrixRow>([
    {
      label: '状态命中 case（mood=friendly）',
      key: 'scenes.mood.line',
      lang: 'zh-CN',
      mood: 'friendly',
      expected: '她朝你笑了笑。',
      found: true,
      fallbackUsed: false,
      warns: 0,
    },
    {
      label: '状态命中另一 case（mood=stranger）',
      key: 'scenes.mood.line',
      lang: 'zh-CN',
      mood: 'stranger',
      expected: '她警惕地看着你。',
      found: true,
      fallbackUsed: false,
      warns: 0,
    },
    {
      label: '未声明状态 → other 兜底分支',
      key: 'scenes.mood.line',
      lang: 'zh-CN',
      mood: 'cold',
      expected: '她看了你一眼。',
      found: true,
      fallbackUsed: false,
      warns: 0,
    },
    {
      label: 'en-US select：译文 case + 分支内插值',
      key: 'scenes.mood.line',
      lang: 'en-US',
      vars: { 'player.name': 'Ace' },
      mood: 'friendly',
      expected: 'She smiles at you, Ace.',
      found: true,
      fallbackUsed: false,
      warns: 0,
    },
    {
      label: 'en-US 无匹配 case → other 兜底（译文结构内收敛）',
      key: 'scenes.mood.line',
      lang: 'en-US',
      mood: 'stranger',
      expected: 'She glances at you.',
      found: true,
      fallbackUsed: false,
      warns: 0,
    },
    {
      label: 'ja-JP 缺键 → 回退主语言 select 结构求值',
      key: 'scenes.mood.line',
      lang: 'ja-JP',
      mood: 'friendly',
      expected: '她朝你笑了笑。',
      found: true,
      fallbackUsed: true,
      warns: 1,
    },
  ])('$label', expectRow);
});

describe('词典夹具表驱动：回退链终点与缺失告警（07 任务 6）', () => {
  it.each<MatrixRow>([
    {
      label: '键仅存在于目标语言 → 主语言亦缺 → 显示原始键 + 告警',
      key: 'en.only.key',
      lang: 'zh-CN',
      expected: 'en.only.key',
      found: false,
      fallbackUsed: false,
      warns: 1,
    },
    {
      label: '全语言均缺 → 显示原始键 + 告警一次',
      key: 'scenes.total.missing',
      lang: 'en-US',
      expected: 'scenes.total.missing',
      found: false,
      fallbackUsed: false,
      warns: 1,
    },
    {
      label: '主语言键值不可渲染（数组叶子）→ 走缺失路径 + 双告警',
      key: 'scenes.bad.value',
      lang: 'zh-CN',
      expected: 'scenes.bad.value',
      found: false,
      fallbackUsed: false,
      warns: 2,
    },
    {
      label: '目标语言与主语言均未注册该键 → 原始键 + 告警（回退链终点）',
      key: 'scenes.neither.lang',
      lang: 'ko-KR',
      expected: 'scenes.neither.lang',
      found: false,
      fallbackUsed: false,
      warns: 1,
    },
  ])('$label', expectRow);
});

describe('词典夹具表驱动：availableLangs 与词典一致性（07 任务 6）', () => {
  it('availableLangs 与词典夹具声明的语言一致（注册顺序）', () => {
    const resolver = makeResolver('friendly', () => undefined);
    expect(resolver.availableLangs()).toEqual(['zh-CN', 'en-US', 'ja-JP']);
  });
});
