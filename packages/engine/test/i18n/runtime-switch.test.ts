import { describe, expect, it } from 'vitest';
import type { Lang } from '@game/shared';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { createTextResolver } from '../../src/i18n/text-resolver.js';
import type { InterpVars } from '../../src/i18n/text-resolver.js';
import { makeEvalContext, makeScope, pack, recordWarn } from './fixtures.js';
import type { ExprScope } from '@game/shared';
import type { LocaleValue } from '../../src/loader/index.js';

/**
 * 语言运行时切换用例（07 任务 5，FR-L10N-05「设置面板切换语言即时生效，
 * 无需重载存档」）。
 *
 * 断言口径：
 * - 同一 resolver 实例内交替切换 lang 参数：每次 resolve 按传入 lang 现查，
 *   切换即时生效，无上一语言的缓存残留（实现无内部语言缓存状态，§4.1）；
 * - 回退标记逐次重算：语言缺失键 → fallbackUsed=true；切回有键语言 →
 *   fallbackUsed=false（不残留「曾回退」或「曾直查」状态）；
 * - 插值 / 复数 / select 结构同样跟随切换：select 每次以注入的 EvalContext
 *   现求值，状态变化即时反映（无 case 结果缓存）。
 */

const ZH = pack('zh-CN', {
  'scenes.arrival.open': '你踏上石板路',
  'scenes.tavern.greet': '「又是你啊，{player.name}。」',
  'item.warm_bun.count': {
    plural: {
      one: '你手里攥着 1 个肉包。',
      other: '你手里攥着 {count} 个肉包。',
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
} satisfies Record<string, LocaleValue>);

const EN = pack('en-US', {
  'scenes.arrival.open': 'You step onto the stones',
  'scenes.tavern.greet': '"It is you again, {player.name}."',
  'scenes.mood.line': {
    select: {
      expr: 'flag.mood',
      cases: {
        friendly: 'She smiles at you.',
        other: 'She glances at you.',
      },
    },
  },
} satisfies Record<string, LocaleValue>);

const JA = pack('ja-JP', { 'scenes.arrival.open': '石畳を踏む' });

function makeResolver(warn: (message: string, where: Readonly<Record<string, string>>) => void) {
  return createTextResolver({
    mainLang: 'zh-CN',
    locales: { 'zh-CN': ZH, 'en-US': EN, 'ja-JP': JA },
    functionRegistry: createBuiltinFunctionRegistry(),
    evalContext: () => makeEvalContext(),
    warn,
  });
}

describe('语言运行时切换（07 任务 5，FR-L10N-05）', () => {
  it('同一 resolver 交替切换语言：每次 resolve 按传入语言现查，无缓存残留', () => {
    const { calls, warn } = recordWarn();
    const resolver = makeResolver(warn);
    const script: ReadonlyArray<[Lang, string]> = [
      ['zh-CN', '你踏上石板路'],
      ['en-US', 'You step onto the stones'],
      ['ja-JP', '石畳を踏む'],
      ['en-US', 'You step onto the stones'],
      ['zh-CN', '你踏上石板路'],
      ['ja-JP', '石畳を踏む'],
    ];
    for (const [lang, expected] of script) {
      const resolved = resolver.resolve('scenes.arrival.open', lang);
      expect(resolved.text, `切换到 ${lang} 后应即时生效`).toBe(expected);
      expect(resolved.found).toBe(true);
      expect(resolved.fallbackUsed).toBe(false);
      expect(resolved.key).toBe('scenes.arrival.open');
    }
    expect(calls).toHaveLength(0);
  });

  it('回退标记逐次重算：缺失语言回退 → 切回直查 → 再切回缺失语言仍回退', () => {
    const { calls, warn } = recordWarn();
    const resolver = makeResolver(warn);
    // en-US / ja-JP 均无 item.warm_bun.count → 回退 zh-CN
    expect(resolver.resolve('item.warm_bun.count', 'en-US', { count: 3 })).toEqual({
      text: '你手里攥着 3 个肉包。',
      found: true,
      fallbackUsed: true,
      key: 'item.warm_bun.count',
    });
    expect(resolver.resolve('item.warm_bun.count', 'ja-JP', { count: 3 }).fallbackUsed).toBe(true);
    // 切回主语言：直查，无「曾回退」残留
    expect(resolver.resolve('item.warm_bun.count', 'zh-CN', { count: 3 })).toEqual({
      text: '你手里攥着 3 个肉包。',
      found: true,
      fallbackUsed: false,
      key: 'item.warm_bun.count',
    });
    // 再切回缺失语言：回退语义如初，不因此前直查而残留
    expect(resolver.resolve('item.warm_bun.count', 'en-US', { count: 3 }).fallbackUsed).toBe(true);
    // 每次回退各告警一次（3 次回退 = 3 条）
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.message.includes('回退'))).toBe(true);
  });

  it('插值跟随切换：模板与变量均按当前调用即时取值', () => {
    const { warn } = recordWarn();
    const resolver = makeResolver(warn);
    expect(resolver.resolve('scenes.tavern.greet', 'zh-CN', { 'player.name': '阿澈' }).text).toBe(
      '「又是你啊，阿澈。」',
    );
    expect(resolver.resolve('scenes.tavern.greet', 'en-US', { 'player.name': '阿澈' }).text).toBe(
      '"It is you again, 阿澈."',
    );
    // 同键同语言换变量：结果即时重算（无 ResolvedText 级 memo）
    expect(resolver.resolve('scenes.tavern.greet', 'zh-CN', { 'player.name': '小满' }).text).toBe(
      '「又是你啊，小满。」',
    );
  });

  it('select 跟随切换与状态变化：每次 resolve 以当前 EvalContext 现求值', () => {
    const { warn } = recordWarn();
    let mood = 'friendly';
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: { 'zh-CN': ZH, 'en-US': EN },
      functionRegistry: createBuiltinFunctionRegistry(),
      evalContext: () => makeEvalContext(scopeWithMood(mood)),
      warn,
    });
    expect(resolver.resolve('scenes.mood.line', 'zh-CN').text).toBe('她朝你笑了笑。');
    expect(resolver.resolve('scenes.mood.line', 'en-US').text).toBe('She smiles at you.');
    // 状态变化（mood → stranger）后同一 resolver 立即反映：en-US 落 other 分支
    mood = 'stranger';
    expect(resolver.resolve('scenes.mood.line', 'zh-CN').text).toBe('她警惕地看着你。');
    expect(resolver.resolve('scenes.mood.line', 'en-US').text).toBe('She glances at you.');
  });

  it('切换语言不改变 availableLangs 清单（注册顺序稳定）', () => {
    const { warn } = recordWarn();
    const resolver = makeResolver(warn);
    resolver.resolve('scenes.arrival.open', 'en-US');
    resolver.resolve('scenes.arrival.open', 'ja-JP');
    expect(resolver.availableLangs()).toEqual(['zh-CN', 'en-US', 'ja-JP']);
  });

  it('切换期间的插值失败语义不串语言：缺失变量按当前模板占位符保留', () => {
    const { calls, warn } = recordWarn();
    const resolver = makeResolver(warn);
    const noVars: InterpVars = {};
    expect(resolver.resolve('scenes.tavern.greet', 'en-US', noVars).text).toBe(
      '"It is you again, {player.name}."',
    );
    expect(resolver.resolve('scenes.tavern.greet', 'zh-CN', noVars).text).toBe(
      '「又是你啊，{player.name}。」',
    );
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.where['placeholder'] === 'player.name')).toBe(true);
  });
});

/** 构造仅 mood 不同的求值作用域（其余沿用夹具基线） */
function scopeWithMood(mood: string): ExprScope {
  const base = makeScope();
  return makeScope({ world: { flags: { mood }, time: base.world.time } });
}
