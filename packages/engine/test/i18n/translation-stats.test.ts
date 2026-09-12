import { describe, expect, it } from 'vitest';
import type { Lang } from '@game/shared';
import { collectTranslationStats } from '../../src/i18n/translation-stats.js';
import type { TranslationStatsInput } from '../../src/i18n/translation-stats.js';
import { pack } from './fixtures.js';
import type { LocalePack, LocaleValue } from '../../src/loader/index.js';

/**
 * 翻译完成度统计用例（07 任务 7，设计 §7.8「缺失/占位符不一致」状态来源，
 * 供 26 号编辑器翻译管理 FR-EDTR-13 复用）。
 *
 * 断言口径（任务书定义）：
 * - missingKeys：主语言包有而目标语言包没有的键（译文缺失）；
 * - unusedKeys：目标语言包有而主语言包没有的键（主语言已删或键名错误的孤儿键）；
 * - placeholderMismatchKeys：两语言都有该键，但主语言与译文的 `{path}`
 *   占位符**集合**不同（比较变量路径，与格式化段 `|fmt:number:…` 无关）；
 * - 输出按键名字典序排序（编辑器表格与断言的确定性）；
 * - 纯集合比对，不抛错、不做结构形态校验（那是加载器 / TextResolver 职责）。
 */

/** 手构统计输入：manifest.mainLang + locales（GameDefinition 的结构子集） */
function makeDef(
  mainLang: Lang,
  locales: Record<Lang, Record<string, LocaleValue>>,
): TranslationStatsInput {
  const packs: Record<Lang, LocalePack> = {};
  for (const [lang, entries] of Object.entries(locales)) {
    packs[lang] = pack(lang, entries);
  }
  return { manifest: { mainLang }, locales: packs };
}

describe('collectTranslationStats：缺失与未使用键（07 任务 7）', () => {
  it('全部键已翻译 → 三个清单均为空', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.line': '甲', 'b.line': '乙' },
      'en-US': { 'a.line': 'A', 'b.line': 'B' },
    });
    expect(collectTranslationStats(def, 'en-US')).toEqual({
      missingKeys: [],
      unusedKeys: [],
      placeholderMismatchKeys: [],
    });
  });

  it('主语言有而目标语言没有 → 记入 missingKeys', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.line': '甲', 'b.line': '乙' },
      'en-US': { 'a.line': 'A' },
    });
    expect(collectTranslationStats(def, 'en-US').missingKeys).toEqual(['b.line']);
  });

  it('目标语言有而主语言没有 → 记入 unusedKeys（孤儿键）', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.line': '甲' },
      'en-US': { 'a.line': 'A', 'en.stale': 'Stale' },
    });
    const stats = collectTranslationStats(def, 'en-US');
    expect(stats.missingKeys).toEqual([]);
    expect(stats.unusedKeys).toEqual(['en.stale']);
  });

  it('缺失与未使用并存 → 各自归位，互不混入', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.line': '甲', 'b.line': '乙', 'c.line': '丙' },
      'en-US': { 'a.line': 'A', 'c.line': 'C', 'x.ghost': 'Ghost' },
    });
    const stats = collectTranslationStats(def, 'en-US');
    expect(stats.missingKeys).toEqual(['b.line']);
    expect(stats.unusedKeys).toEqual(['x.ghost']);
  });

  it('输出按键名字典序排序（确定性）', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'c.line': '丙', 'a.line': '甲', 'b.line': '乙' },
      'en-US': { 'zz.ghost': 'Z', 'aa.ghost': 'A' },
    });
    const stats = collectTranslationStats(def, 'en-US');
    expect(stats.missingKeys).toEqual(['a.line', 'b.line', 'c.line']);
    expect(stats.unusedKeys).toEqual(['aa.ghost', 'zz.ghost']);
  });

  it('目标语言包未注册（def.locales 无该语言）→ 全部主语言键记缺失', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.line': '甲', 'b.line': '乙' },
      'en-US': { 'a.line': 'A' },
    });
    const stats = collectTranslationStats(def, 'ja-JP');
    expect(stats.missingKeys).toEqual(['a.line', 'b.line']);
    expect(stats.unusedKeys).toEqual([]);
    expect(stats.placeholderMismatchKeys).toEqual([]);
  });

  it('lang == mainLang → 与自身比对，三个清单均为空', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.line': '甲', 'x.struct': { plural: { other: '{count} 份' } } },
    });
    expect(collectTranslationStats(def, 'zh-CN')).toEqual({
      missingKeys: [],
      unusedKeys: [],
      placeholderMismatchKeys: [],
    });
  });
});

describe('collectTranslationStats：占位符不一致（07 任务 7，集合语义）', () => {
  it('译文缺少主语言占位符 → 记入 placeholderMismatchKeys', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.line': '{name} 拾取 {count|fmt:number:0} 个' },
      'en-US': { 'a.line': '{name} picked up something' },
    });
    expect(collectTranslationStats(def, 'en-US').placeholderMismatchKeys).toEqual(['a.line']);
  });

  it('译文多出主语言没有的占位符 → 同样记入（集合双向比对）', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.line': '写死文本' },
      'en-US': { 'a.line': '{extra} appeared' },
    });
    expect(collectTranslationStats(def, 'en-US').placeholderMismatchKeys).toEqual(['a.line']);
  });

  it('占位符集合相同（含格式段差异）→ 不算不一致（比较的是变量路径）', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.line': '{gold|fmt:number:2} 枚' },
      'en-US': { 'a.line': '{gold} coins' },
    });
    expect(collectTranslationStats(def, 'en-US').placeholderMismatchKeys).toEqual([]);
  });

  it('同一占位符出现次数不同 → 集合语义下不算不一致（任务书定义为集合比较）', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.line': '{name} 对 {name} 说' },
      'en-US': { 'a.line': '{name} says' },
    });
    expect(collectTranslationStats(def, 'en-US').placeholderMismatchKeys).toEqual([]);
  });

  it('占位符集合相同但顺序不同 → 不算不一致', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.line': '{a} 然后 {b}' },
      'en-US': { 'a.line': '{b} then {a}' },
    });
    expect(collectTranslationStats(def, 'en-US').placeholderMismatchKeys).toEqual([]);
  });

  it('结构值：plural/select 占位符取全部分支模板的并集参与比对', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': {
        'bun.count': { plural: { one: '{count} 个', other: '{count} 个（{note}）' } },
        'mood.line': {
          select: { expr: 'flag.mood', cases: { friendly: '{name}，你好', other: '……' } },
        },
      },
      'en-US': {
        // 译文仅保留 other 分支，但并集占位符 {count, note} 未全覆盖主语言 → 不一致
        'bun.count': { plural: { other: '{count} items' } },
        // 译文 case 覆盖了 {name} → 并集一致
        'mood.line': {
          select: { expr: 'flag.mood', cases: { friendly: 'Hi {name}', other: '...' } },
        },
      },
    });
    expect(collectTranslationStats(def, 'en-US').placeholderMismatchKeys).toEqual(['bun.count']);
  });

  it('select.expr 为表达式原文，不参与占位符比对（表达式语法无占位符）', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': {
        'mood.line': { select: { expr: 'flag.mood', cases: { other: '她看了你一眼。' } } },
      },
      'en-US': { 'mood.line': { select: { expr: 'flag.mood', cases: { other: 'She glances.' } } } },
    });
    const stats = collectTranslationStats(def, 'en-US');
    expect(stats.placeholderMismatchKeys).toEqual([]);
    expect(stats.missingKeys).toEqual([]);
  });

  it('缺失键不重复进入占位符比对（missing 与 mismatch 互斥）', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.line': '{name}', 'b.line': '{name}' },
      'en-US': { 'b.line': '无占位符' },
    });
    const stats = collectTranslationStats(def, 'en-US');
    expect(stats.missingKeys).toEqual(['a.line']);
    expect(stats.placeholderMismatchKeys).toEqual(['b.line']);
  });
});

describe('collectTranslationStats：LocaleValue 递归与防御（07 任务 7）', () => {
  it('数组叶子内的字符串模板同样提取占位符（LocaleValue 递归）', () => {
    const def = makeDef('zh-CN', {
      'zh-CN': { 'a.list': ['{first} 在前', '{second} 在后'] },
      'en-US': { 'a.list': ['{first} first'] },
    });
    expect(collectTranslationStats(def, 'en-US').placeholderMismatchKeys).toEqual(['a.list']);
  });

  it('主语言包未注册（异常形态）→ 目标全部键记 unused，不抛错', () => {
    const def = makeDef('zh-CN', {
      'en-US': { 'a.line': 'A' },
    });
    const stats = collectTranslationStats(def, 'en-US');
    expect(stats.missingKeys).toEqual([]);
    expect(stats.unusedKeys).toEqual(['a.line']);
    expect(stats.placeholderMismatchKeys).toEqual([]);
  });
});
