import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { EvalContext, ExprScope } from '@game/shared';
import type { LocalePack, LocaleValue } from '../../src/loader/index.js';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { createTextResolver } from '../../src/i18n/text-resolver.js';
import type { TextResolverWarn } from '../../src/i18n/text-resolver.js';

/**
 * 复数与 select 变体用例（07 任务 3，设计 §4.1 / FR-L10N-04）。
 *
 * 断言口径：
 * - 复数：键值为 `{plural: {one, other}}` 时按 vars 中的数量选择——简版规则
 *   `=1 → one，否则 other`（ICU 完整复数规则 zero/few/many 不做）；计数
 *   取约定键 `count`（兼容 `n`），须为 number；
 * - select：键值为 `{select: {expr, cases}}` 时 expr 在构造期经 compileExpr
 *   编译、resolve 期以注入的 EvalContext 求值选 case；未知 case 回退 other，
 *   再无兜底 → 沿回退链落主语言；求值遵循 DD-01 严格语义（EVAL_ERROR 抛出）；
 * - 结构缺陷（形态违例 / 表达式编译失败）在构造期显性抛错（NFR-05）。
 */

function pack(lang: string, entries: Record<string, LocaleValue>): LocalePack {
  return { lang, keys: new Map(Object.entries(entries)) };
}

function recordWarn(): {
  calls: Array<{ message: string; where: Record<string, string> }>;
  warn: TextResolverWarn;
} {
  const calls: Array<{ message: string; where: Record<string, string> }> = [];
  const warn: TextResolverWarn = (message, where) => calls.push({ message, where: { ...where } });
  return { calls, warn };
}

/** select 求值作用域夹具（§2.3 ExprScope 最小形态） */
function makeScope(overrides: Partial<ExprScope> = {}): ExprScope {
  const base: ExprScope = {
    player: {
      attrs: { stamina: 5 },
      skills: {},
      outfit: {},
      body: {},
      wallet: { gold: 10 },
    },
    world: {
      flags: { mood: 'friendly' },
      time: { day: 1, weekday: '1', slot: '0' },
    },
    bagCounts: { warm_bun: 2 },
    npcs: { hawker: { favor: 7, met: true, flags: {} } },
    factions: {},
    quests: {},
    loop: 1,
    meta: { points: 0, purchasedPerks: [] },
  };
  return { ...base, ...overrides };
}

function makeEvalContext(scope: ExprScope = makeScope()): EvalContext {
  return {
    state: scope,
    rng: createRng(1),
    registry: createBuiltinFunctionRegistry(),
  };
}

describe('复数结构 {plural: {one, other}}（07 任务 3，简版规则）', () => {
  const zh = pack('zh-CN', {
    'item.warm_bun.count': {
      plural: {
        one: '你手里攥着 {count} 个肉包。',
        other: '你手里攥着 {count} 个肉包，还热乎。',
      },
    },
  });

  function makeResolver(warn: TextResolverWarn) {
    return createTextResolver({ mainLang: 'zh-CN', locales: { 'zh-CN': zh }, warn });
  }

  it.each([
    ['count=1 → one 分支', 1, '你手里攥着 1 个肉包。'],
    ['count=3 → other 分支', 3, '你手里攥着 3 个肉包，还热乎。'],
    ['count=0 → other 分支（简版规则无 zero）', 0, '你手里攥着 0 个肉包，还热乎。'],
    ['count=1.5 → other 分支', 1.5, '你手里攥着 1.5 个肉包，还热乎。'],
  ])('%s', (_label, count, expected) => {
    const { calls, warn } = recordWarn();
    const resolved = makeResolver(warn).resolve('item.warm_bun.count', 'zh-CN', { count });
    expect(resolved.text).toBe(expected);
    expect(resolved.found).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('约定键 n 兼容（count 缺席时）', () => {
    const resolved = makeResolver(() => undefined).resolve('item.warm_bun.count', 'zh-CN', {
      n: 1,
    });
    expect(resolved.text).toBe('你手里攥着 1 个肉包。');
  });

  it('count 缺失 → 告警 + 走回退链（无主语言兜底 → 原始键）', () => {
    const { calls, warn } = recordWarn();
    const resolved = makeResolver(warn).resolve('item.warm_bun.count', 'zh-CN');
    expect(resolved.found).toBe(false);
    expect(resolved.text).toBe('item.warm_bun.count');
    expect(calls).toHaveLength(2); // 复数计数缺失 + 主语言亦缺失
    expect(calls[0]?.where['detail']).toContain('count');
  });

  it('count 为字符串（非 number）→ 同缺失语义，不做隐式转换', () => {
    const { calls, warn } = recordWarn();
    const resolved = makeResolver(warn).resolve('item.warm_bun.count', 'zh-CN', { count: '1' });
    expect(resolved.found).toBe(false);
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('one 分支缺失但 count=1 → 优雅落 other 分支', () => {
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: {
        'zh-CN': pack('zh-CN', {
          'x.count': { plural: { other: '共 {count} 份' } },
        }),
      },
    });
    expect(resolver.resolve('x.count', 'zh-CN', { count: 1 }).text).toBe('共 1 份');
  });

  it('回退主语言后仍按主语言的 plural 结构解析', () => {
    const { calls, warn } = recordWarn();
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: {
        'zh-CN': zh,
        'en-US': pack('en-US', {}),
      },
      warn,
    });
    const resolved = resolver.resolve('item.warm_bun.count', 'en-US', { count: 1 });
    expect(resolved.text).toBe('你手里攥着 1 个肉包。');
    expect(resolved.fallbackUsed).toBe(true);
    expect(calls).toHaveLength(1); // 仅回退告警
  });
});

describe('select 结构 {select: {expr, cases}}（07 任务 3）', () => {
  const zh = pack('zh-CN', {
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
    'scenes.mood.boolean': {
      select: {
        expr: "flag.mood == 'friendly'",
        cases: { true: '判定为真。', false: '判定为假。', other: '未定。' },
      },
    },
    'npc.hawker.stalk': {
      select: {
        expr: 'npc.hawker.favor >= 5',
        cases: { true: '摊主多送了你一块酱肉。', other: '摊主面无表情。' },
      },
    },
    'ui.bag.hint': {
      select: {
        expr: "has('warm_bun')",
        cases: { true: '背包里有热乎的肉包。', other: '背包空空如也。' },
      },
    },
  });

  function makeResolver(warn: TextResolverWarn, scope?: ExprScope) {
    const ctx = makeEvalContext(scope);
    return createTextResolver({
      mainLang: 'zh-CN',
      locales: { 'zh-CN': zh },
      functionRegistry: createBuiltinFunctionRegistry(),
      evalContext: () => ctx,
      warn,
    });
  }

  it('表达式为真 → 对应 case 分支', () => {
    const { calls, warn } = recordWarn();
    const resolved = makeResolver(warn).resolve('scenes.mood.line', 'zh-CN');
    expect(resolved.text).toBe('她朝你笑了笑。');
    expect(calls).toHaveLength(0);
  });

  it('表达式为假 → false 值 case（布尔结果按 String 规范化）', () => {
    const base = makeScope();
    const scope = makeScope({ world: { flags: { mood: 'cold' }, time: base.world.time } });
    const resolved = makeResolver(() => undefined, scope).resolve('scenes.mood.boolean', 'zh-CN');
    expect(resolved.text).toBe('判定为假。');
  });

  it('路径型表达式（npc.favor 阈值）选 case', () => {
    const resolved = makeResolver(() => undefined).resolve('npc.hawker.stalk', 'zh-CN');
    expect(resolved.text).toBe('摊主多送了你一块酱肉。');
  });

  it('函数型表达式（has，内置函数经注册表可用）选 case', () => {
    const resolved = makeResolver(() => undefined).resolve('ui.bag.hint', 'zh-CN');
    expect(resolved.text).toBe('背包里有热乎的肉包。');
  });

  it('未知 case 结果 → 回退 other 分支', () => {
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: {
        'zh-CN': pack('zh-CN', {
          'x.line': {
            select: {
              expr: 'flag.mood',
              cases: { friendly: '友善', other: '未知' },
            },
          },
        }),
      },
      evalContext: () =>
        makeEvalContext(
          makeScope({ world: { flags: { mood: 'cold' }, time: makeScope().world.time } }),
        ),
    });
    expect(resolver.resolve('x.line', 'zh-CN').text).toBe('未知');
  });

  it('无匹配且无 other → 回退主语言 select 结构（回退链续接）', () => {
    const { calls, warn } = recordWarn();
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: {
        'zh-CN': pack('zh-CN', {
          'x.line': {
            select: { expr: 'flag.mood', cases: { friendly: '友善', cold: '冷淡' } },
          },
        }),
        'en-US': pack('en-US', {
          'x.line': {
            select: { expr: 'flag.mood', cases: { hot: 'hot!' } },
          },
        }),
      },
      evalContext: () =>
        makeEvalContext(
          makeScope({ world: { flags: { mood: 'cold' }, time: makeScope().world.time } }),
        ),
      warn,
    });
    const resolved = resolver.resolve('x.line', 'en-US');
    expect(resolved.text).toBe('冷淡');
    expect(resolved.fallbackUsed).toBe(true);
    expect(calls).toHaveLength(2); // en 无匹配告警 + 回退主语言告警
    expect(calls[0]?.where['detail']).toContain('other');
  });

  it('select 表达式求值遵循 DD-01 严格语义：封闭域缺键 → EVAL_ERROR 抛出', () => {
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: {
        'zh-CN': pack('zh-CN', {
          'x.line': {
            select: { expr: 'attr.absent_attr > 1', cases: { true: 'A', other: 'B' } },
          },
        }),
      },
      evalContext: () => makeEvalContext(),
    });
    expect(() => resolver.resolve('x.line', 'zh-CN')).toThrowError(/absent_attr/);
  });

  it('select 分支同样执行插值（vars 传入分支模板）', () => {
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: {
        'zh-CN': pack('zh-CN', {
          'x.line': {
            select: {
              expr: 'flag.mood',
              cases: { friendly: '{player.name}，她朝你笑了笑。', other: '……' },
            },
          },
        }),
      },
      evalContext: () => makeEvalContext(),
    });
    const resolved = resolver.resolve('x.line', 'zh-CN', { 'player.name': '阿澈' });
    expect(resolved.text).toBe('阿澈，她朝你笑了笑。');
  });
});

describe('结构缺陷构造期显性化（07 任务 3，NFR-05 / DD-01）', () => {
  function makeWithKey(value: LocaleValue, options: { evalContext?: boolean } = {}) {
    return () =>
      createTextResolver({
        mainLang: 'zh-CN',
        locales: { 'zh-CN': pack('zh-CN', { 'x.bad': value }) },
        ...(options.evalContext === false ? {} : { evalContext: () => makeEvalContext() }),
      });
  }

  it('select.expr 缺失 → SCHEMA_INVALID（构造期抛出）', () => {
    expect(makeWithKey({ select: { cases: { a: 'A' } } })).toThrowError(/select\.expr/);
  });

  it('select.cases 缺失 → SCHEMA_INVALID', () => {
    expect(makeWithKey({ select: { expr: 'flag.x' } })).toThrowError(/cases/);
  });

  it('plural 值为字符串（非记录）→ SCHEMA_INVALID', () => {
    expect(makeWithKey({ plural: '文本' })).toThrowError(/plural/);
  });

  it('plural 分支值非字符串 → SCHEMA_INVALID', () => {
    expect(makeWithKey({ plural: { one: ['数组'], other: '文本' } })).toThrowError(/one/);
  });

  it('select 与 plural 并存 → SCHEMA_INVALID（互斥防歧义）', () => {
    expect(
      makeWithKey({
        plural: { other: '文本' },
        select: { expr: 'flag.x', cases: { a: 'A' } },
      }),
    ).toThrowError(/互斥/);
  });

  it('select 表达式引用未知变量域 → EXPR_COMPILE（构造期编译阻断，DD-01）', () => {
    expect(makeWithKey({ select: { expr: 'foo.bar == 1', cases: { a: 'A' } } })).toThrowError(
      /foo/,
    );
  });

  it('select 表达式调用未知函数 → EXPR_COMPILE', () => {
    expect(makeWithKey({ select: { expr: 'no_such_fn(1)', cases: { a: 'A' } } })).toThrowError(
      /no_such_fn/,
    );
  });

  it('select 存在但未注入求值上下文 → INTERNAL（装配契约违规）', () => {
    expect(
      makeWithKey({ select: { expr: 'flag.mood', cases: { a: 'A' } } }, { evalContext: false }),
    ).toThrowError(/evalContext|求值上下文/);
  });

  it('抛出错误为 EngineError 且携带 code/where.key 定位', () => {
    try {
      makeWithKey({ select: { expr: 'foo.bar == 1', cases: { a: 'A' } } })();
      expect.unreachable('构造应当抛出');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('EXPR_COMPILE');
      expect((error as { where?: Record<string, string> }).where?.['key']).toBe('x.bad');
    }
  });
});
