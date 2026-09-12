import { describe, expect, it } from 'vitest';
import type { Lang } from '@game/shared';
import type { LocalePack } from '../../src/loader/index.js';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { createLocaleProvider, createTextResolver } from '../../src/i18n/text-resolver.js';
import type { LocaleProvider } from '../../src/i18n/text-resolver.js';
import { makeEvalContext, pack, recordWarn } from './fixtures.js';

/**
 * 非主语言命名空间懒加载对接用例（07 任务 4，设计 §4.1「非主语言命名空间
 * 懒加载」/ NFR-01 / FR-L10N-02「按命名空间批量加载」）。
 *
 * 断言口径：
 * - TextResolver 经 localeProvider 注入点取词典：无内部词典缓存，每次
 *   resolve 现查 provider——包到达即时生效（25 号 UI 侧可替换为 §9.1
 *   locales/<lang>.json 命名空间 chunk 懒加载实现）；
 * - 迟到包在首见时完成接入校验与 select 编译（缺陷显性抛出，NFR-05）；
 * - 未注册语言 → 主语言回退（FR-L10N-06 语义不变）。
 */

const ZH = pack('zh-CN', { 'scenes.arrival.open': '你踏上石板路' });

describe('localeProvider 懒加载注入点（07 任务 4）', () => {
  it('未注册语言 → 主语言回退（FR-L10N-06 语义不变）', () => {
    const { provider, warn } = withMutableProvider(new Map([['zh-CN', ZH]]));
    const resolver = createTextResolver({ mainLang: 'zh-CN', localeProvider: provider, warn });
    const resolved = resolver.resolve('scenes.arrival.open', 'en-US');
    expect(resolved.fallbackUsed).toBe(true);
    expect(resolved.text).toBe('你踏上石板路');
  });

  it('懒加载包到达后下一次 resolve 即时生效（无缓存残留）', () => {
    const { provider, packs, warn } = withMutableProvider(new Map([['zh-CN', ZH]]));
    const resolver = createTextResolver({ mainLang: 'zh-CN', localeProvider: provider, warn });
    expect(resolver.resolve('scenes.arrival.open', 'en-US').fallbackUsed).toBe(true);

    // 模拟非主语言 chunk 懒加载到达（§9.1 locales/en-US.json）
    packs.set('en-US', pack('en-US', { 'scenes.arrival.open': 'You step onto the stones' }));
    const after = resolver.resolve('scenes.arrival.open', 'en-US');
    expect(after.text).toBe('You step onto the stones');
    expect(after.fallbackUsed).toBe(false);
  });

  it('availableLangs 反映 provider 当前注册清单', () => {
    const { provider, packs } = withMutableProvider(new Map([['zh-CN', ZH]]));
    const resolver = createTextResolver({ mainLang: 'zh-CN', localeProvider: provider });
    expect(resolver.availableLangs()).toEqual(['zh-CN']);
    packs.set('en-US', pack('en-US', {}));
    expect(resolver.availableLangs()).toEqual(['zh-CN', 'en-US']);
  });

  it('迟到包含 select → 首见 resolve 完成编译并正常求解', () => {
    const { provider, packs } = withMutableProvider(new Map([['zh-CN', ZH]]));
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      localeProvider: provider,
      functionRegistry: createBuiltinFunctionRegistry(),
      evalContext: () => makeEvalContext(),
    });
    packs.set(
      'en-US',
      pack('en-US', {
        'scenes.mood.line': {
          select: { expr: 'flag.mood', cases: { friendly: 'She smiles at you.' } },
        },
      }),
    );
    expect(resolver.resolve('scenes.mood.line', 'en-US').text).toBe('She smiles at you.');
  });

  it('迟到包含缺陷 select 表达式 → 首见 resolve 抛 EXPR_COMPILE', () => {
    const { provider, packs } = withMutableProvider(new Map([['zh-CN', ZH]]));
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      localeProvider: provider,
      evalContext: () => makeEvalContext(),
    });
    packs.set(
      'en-US',
      pack('en-US', {
        'x.bad': { select: { expr: 'no_such_fn(1)', cases: { a: 'A' } } },
      }),
    );
    expect(() => resolver.resolve('x.bad', 'en-US')).toThrowError(/no_such_fn/);
  });

  it('迟到包含畸形 plural → 首见 resolve 抛 SCHEMA_INVALID', () => {
    const { provider, packs } = withMutableProvider(new Map([['zh-CN', ZH]]));
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      localeProvider: provider,
      evalContext: () => makeEvalContext(),
    });
    packs.set('en-US', pack('en-US', { 'x.bad': { plural: '文本' } }));
    expect(() => resolver.resolve('x.bad', 'en-US')).toThrowError(/plural/);
  });

  it('迟到包含 select 且未注入 evalContext → 首见 resolve 抛 INTERNAL', () => {
    const { provider, packs } = withMutableProvider(new Map([['zh-CN', ZH]]));
    const resolver = createTextResolver({ mainLang: 'zh-CN', localeProvider: provider });
    packs.set(
      'en-US',
      pack('en-US', {
        'x.line': { select: { expr: 'flag.mood', cases: { friendly: 'F' } } },
      }),
    );
    expect(() => resolver.resolve('x.line', 'en-US')).toThrowError(/EvalContext|求值上下文/);
  });
});

describe('createLocaleProvider 与装配校验（07 任务 4）', () => {
  it('createLocaleProvider：langs 保持注册顺序、get 直查', () => {
    const provider = createLocaleProvider({
      'zh-CN': ZH,
      'en-US': pack('en-US', {}),
      'ja-JP': pack('ja-JP', {}),
    });
    expect(provider.langs()).toEqual(['zh-CN', 'en-US', 'ja-JP']);
    expect(provider.get('en-US')?.lang).toBe('en-US');
    expect(provider.get('ko-KR')).toBeUndefined();
  });

  it('localeProvider 与 locales 同时提供 → provider 优先', () => {
    const { provider } = withMutableProvider(
      new Map([['zh-CN', pack('zh-CN', { 'ui.title': '提供方版本' })]]),
    );
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: { 'zh-CN': pack('zh-CN', { 'ui.title': '常驻版本' }) },
      localeProvider: provider,
    });
    expect(resolver.resolve('ui.title', 'zh-CN').text).toBe('提供方版本');
  });

  it('locales 与 localeProvider 均缺省 → INTERNAL（装配契约违规）', () => {
    expect(() => createTextResolver({ mainLang: 'zh-CN' })).toThrowError(/locales|localeProvider/);
  });
});

/** 组装可变 provider 夹具（附告警记录器） */
function withMutableProvider(initial: Map<Lang, LocalePack>): {
  provider: LocaleProvider;
  packs: Map<Lang, LocalePack>;
  warn: (message: string, where: Readonly<Record<string, string>>) => void;
} {
  const packs = new Map(initial);
  const provider: LocaleProvider = {
    get: (lang) => packs.get(lang),
    langs: () => [...packs.keys()],
  };
  const { warn } = recordWarn();
  return { provider, packs, warn };
}
