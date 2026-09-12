import { describe, expect, it } from 'vitest';
import type { LocalePack, LocaleValue } from '../../src/loader/index.js';
import { createTextResolver } from '../../src/i18n/text-resolver.js';
import type { TextResolverWarn } from '../../src/i18n/text-resolver.js';

/**
 * TextResolver.resolve 键查找与回退链用例（07 任务 1，设计 §4.1）。
 *
 * 断言口径：
 * - 目标语言缺键 → 主语言回退 + `fallbackUsed=true` + 告警一次（不抛错）；
 * - 主语言亦缺 → `text` 为原始键 + `found=false` + 告警一次；
 * - 目标语言命中 → `fallbackUsed=false`，无告警；
 * - 词典来自手构 LocalePack 夹具（纯函数测试，不依赖加载器运行）。
 */

/** 手构语言包：键值表 → LocalePack（测试夹具专用） */
function pack(lang: string, entries: Record<string, LocaleValue>): LocalePack {
  return { lang, keys: new Map(Object.entries(entries)) };
}

/** 告警记录器：注入 resolver 并收集调用（message + where） */
function recordWarn(): {
  calls: Array<{ message: string; where: Record<string, string> }>;
  warn: TextResolverWarn;
} {
  const calls: Array<{ message: string; where: Record<string, string> }> = [];
  const warn: TextResolverWarn = (message, where) => calls.push({ message, where: { ...where } });
  return { calls, warn };
}

describe('TextResolver.resolve（07 任务 1：键查找 + 回退链 + 告警）', () => {
  it('目标语言命中 → 原文返回，found=true，无告警', () => {
    const { calls, warn } = recordWarn();
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: {
        'zh-CN': pack('zh-CN', { 'scenes.arrival.open': '你踏上石板路' }),
        'en-US': pack('en-US', { 'scenes.arrival.open': 'You step onto the stones' }),
      },
      warn,
    });
    expect(resolver.resolve('scenes.arrival.open', 'en-US')).toEqual({
      text: 'You step onto the stones',
      found: true,
      fallbackUsed: false,
      key: 'scenes.arrival.open',
    });
    expect(calls).toHaveLength(0);
  });

  it('主语言直查（lang == mainLang 命中）→ fallbackUsed=false', () => {
    const { calls, warn } = recordWarn();
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: { 'zh-CN': pack('zh-CN', { 'npc.hawker.greet': '热乎的肉包' }) },
      warn,
    });
    expect(resolver.resolve('npc.hawker.greet', 'zh-CN')).toEqual({
      text: '热乎的肉包',
      found: true,
      fallbackUsed: false,
      key: 'npc.hawker.greet',
    });
    expect(calls).toHaveLength(0);
  });

  it('目标语言缺键 → 回退主语言，fallbackUsed=true，告警一次', () => {
    const { calls, warn } = recordWarn();
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: {
        'zh-CN': pack('zh-CN', { 'scenes.arrival.open': '你踏上石板路' }),
        'en-US': pack('en-US', {}),
      },
      warn,
    });
    const resolved = resolver.resolve('scenes.arrival.open', 'en-US');
    expect(resolved.text).toBe('你踏上石板路');
    expect(resolved.found).toBe(true);
    expect(resolved.fallbackUsed).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.where['key']).toBe('scenes.arrival.open');
    expect(calls[0]?.where['lang']).toBe('en-US');
    expect(calls[0]?.where['mainLang']).toBe('zh-CN');
  });

  it('主语言亦缺 → text 为原始键，found=false，告警一次', () => {
    const { calls, warn } = recordWarn();
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: {
        'zh-CN': pack('zh-CN', { 'scenes.arrival.open': '你踏上石板路' }),
        'en-US': pack('en-US', {}),
      },
      warn,
    });
    const resolved = resolver.resolve('scenes.missing.key', 'en-US');
    expect(resolved).toEqual({
      text: 'scenes.missing.key',
      found: false,
      fallbackUsed: false,
      key: 'scenes.missing.key',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.where['key']).toBe('scenes.missing.key');
  });

  it('lang == mainLang 且缺键 → found=false 且不标 fallbackUsed', () => {
    const { calls, warn } = recordWarn();
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: { 'zh-CN': pack('zh-CN', {}) },
      warn,
    });
    const resolved = resolver.resolve('scenes.missing.key', 'zh-CN');
    expect(resolved.found).toBe(false);
    expect(resolved.fallbackUsed).toBe(false);
    expect(resolved.text).toBe('scenes.missing.key');
    expect(calls).toHaveLength(1);
  });

  it('目标语言包未注册（Record 无该语言）→ 回退主语言并告警', () => {
    const { calls, warn } = recordWarn();
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: { 'zh-CN': pack('zh-CN', { 'ui.title': '旧镇' }) },
      warn,
    });
    const resolved = resolver.resolve('ui.title', 'fr-FR');
    expect(resolved.text).toBe('旧镇');
    expect(resolved.found).toBe(true);
    expect(resolved.fallbackUsed).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('availableLangs() 返回注册语言清单（注册顺序）', () => {
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: {
        'zh-CN': pack('zh-CN', {}),
        'en-US': pack('en-US', {}),
        'ja-JP': pack('ja-JP', {}),
      },
    });
    expect(resolver.availableLangs()).toEqual(['zh-CN', 'en-US', 'ja-JP']);
  });

  it('主语言包为空包（加载器空包登记形态）→ 全部键缺失告警', () => {
    const { calls, warn } = recordWarn();
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: { 'zh-CN': pack('zh-CN', {}) },
      warn,
    });
    const resolved = resolver.resolve('scenes.arrival.open', 'zh-CN');
    expect(resolved.found).toBe(false);
    expect(resolved.text).toBe('scenes.arrival.open');
    expect(calls).toHaveLength(1);
  });
});
