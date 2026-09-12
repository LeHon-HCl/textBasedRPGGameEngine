import { describe, expect, it } from 'vitest';
import type { LocalePack, LocaleValue } from '../../src/loader/index.js';
import { createTextResolver } from '../../src/i18n/text-resolver.js';
import type { TextResolverWarn } from '../../src/i18n/text-resolver.js';

/**
 * 插值与格式化用例（07 任务 2，设计 §4.1 / FR-L10N-03）。
 *
 * 断言口径：
 * - `{path}` 从 InterpVars 取值（扁平点路径优先，嵌套对象逐段下探）；
 *   引擎不做插值内表达式求值——调用方预先经表达式准备好变量（§4.1）；
 * - `{path|fmt:number:1}` 数值格式化：精度 = 保留 N 位小数（toFixed），
 *   `+` 前缀 = 显式正负号（FR-L10N-03「数值精度、正负号」子集）；
 * - 插值失败（变量缺失 / 值不可渲染 / 格式不合法）→ 保留原始占位符 +
 *   告警一次，`found` 不受影响（键已命中）。
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

/** 构造仅含一个键的主语言 resolver（表驱动用） */
function makeResolver(template: string, warn: TextResolverWarn) {
  return createTextResolver({
    mainLang: 'zh-CN',
    locales: { 'zh-CN': pack('zh-CN', { 'test.line': template }) },
    warn,
  });
}

describe('插值 {path}（07 任务 2：InterpVars 取值，不做插值内表达式求值）', () => {
  it.each([
    ['简洁形态：{name} → 扁平键命中', '你好，{name}。', { name: '阿澈' }, '你好，阿澈。'],
    [
      '点路径扁平键：{player.name}（调用方预准备的表达式产物）',
      '欢迎回来，{player.name}。',
      { 'player.name': '阿澈' },
      '欢迎回来，阿澈。',
    ],
    [
      '嵌套对象下探：vars.player.name',
      '{player.name} 的冒险',
      { player: { name: '阿澈' } },
      '阿澈 的冒险',
    ],
    [
      '多占位符混排',
      '{name} 已来过 {stats.visits} 次。',
      { name: '阿澈', 'stats.visits': 3 },
      '阿澈 已来过 3 次。',
    ],
    ['数值默认渲染为 String（精度交给 fmt 段）', '余额 {gold}。', { gold: 12.5 }, '余额 12.5。'],
    ['布尔渲染', '已完成：{done}', { done: true }, '已完成：true'],
    ['无占位符模板原样返回', '烟味扑面而来。', {}, '烟味扑面而来。'],
    [
      '插值值不参与二次插值（值含 {…} 原样输出，杜绝注入）',
      '原文：{raw}',
      { raw: '{evil}' },
      '原文：{evil}',
    ],
  ])('%s', (_label, template, vars, expected) => {
    const { calls, warn } = recordWarn();
    const resolved = makeResolver(template, warn).resolve('test.line', 'zh-CN', vars);
    expect(resolved.text).toBe(expected);
    expect(resolved.found).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('扁平键优先于嵌套对象（同名时）', () => {
    const resolver = makeResolver('{player.name}', () => undefined);
    const resolved = resolver.resolve('test.line', 'zh-CN', {
      'player.name': '扁平',
      player: { name: '嵌套' },
    });
    expect(resolved.text).toBe('扁平');
  });

  it.each([
    ['空占位符 {} 不是合法占位符，原样保留', '花括号 {} 保留', {}, '花括号 {} 保留'],
    ['孤立 | 的 {a|} 原样保留', '值 {a|} 保留', { a: 1 }, '值 {a|} 保留'],
  ])('%s', (_label, template, vars, expected) => {
    const { calls, warn } = recordWarn();
    const resolved = makeResolver(template, warn).resolve('test.line', 'zh-CN', vars);
    expect(resolved.text).toBe(expected);
    expect(calls).toHaveLength(0);
  });
});

describe('格式化 {path|fmt:number:1}（07 任务 2：数值精度与正负号）', () => {
  it.each([
    ['fmt:number:1 → 保留 1 位小数', '{ratio|fmt:number:1}', { ratio: 25.34 }, '25.3'],
    ['fmt:number:0 → 整数（四舍五入）', '{ratio|fmt:number:0}', { ratio: 25.5 }, '26'],
    ['fmt:number:2 → 保留 2 位小数', '{price|fmt:number:2}', { price: 3.1 }, '3.10'],
    ['fmt:number（无精度段）→ 默认字符串形态', '{gold|fmt:number}', { gold: 42 }, '42'],
    [
      'fmt:number:+1 → 显式正号（负数不叠加符号）',
      '{delta|fmt:number:+1}',
      { delta: 7.25 },
      '+7.3',
    ],
    ['负数保留负号', '{delta|fmt:number:1}', { delta: -3.56 }, '-3.6'],
    ['整数补零到指定精度', '{hp|fmt:number:+0}', { hp: 5 }, '+5'],
  ])('%s', (_label, template, vars, expected) => {
    const { calls, warn } = recordWarn();
    const resolved = makeResolver(template, warn).resolve('test.line', 'zh-CN', vars);
    expect(resolved.text).toBe(expected);
    expect(calls).toHaveLength(0);
  });
});

describe('插值失败语义（FR-L10N-03：显示原始占位并告警）', () => {
  it.each([
    ['变量未提供', '{missing}', {}, '变量未提供'],
    ['null 值不可渲染', '{nothing}', { nothing: null }, '值类型 null 不可渲染为文本'],
    ['数组值不可渲染', '{list}', { list: [1, 2] }, '值类型 array 不可渲染为文本'],
    ['对象值不可渲染', '{obj}', { obj: { a: 1 } }, '值类型 object 不可渲染为文本'],
    [
      '字符串值不接受数值格式（无隐式转换，DD-01 同源严格性）',
      '{label|fmt:number:1}',
      { label: '3.14' },
      '值类型 string 不可渲染为文本（格式化要求 number）',
    ],
    ['未知格式化类别', '{gold|fmt:currency:2}', { gold: 1 }, "未知格式化规格 'fmt:currency:2'"],
    ['精度段非数字', '{gold|fmt:number:many}', { gold: 1 }, "未知格式化规格 'fmt:number:many'"],
  ])('%s → 保留原始占位符 + 告警一次', (_label, template, vars, detail) => {
    const { calls, warn } = recordWarn();
    const resolved = makeResolver(template, warn).resolve('test.line', 'zh-CN', vars);
    expect(resolved.text).toBe(template);
    expect(resolved.found).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.where['key']).toBe('test.line');
    expect(calls[0]?.where['placeholder']).toBeTruthy();
    expect(calls[0]?.where['detail']).toBe(detail);
  });

  it('多占位符部分失败：失败者保留原始占位，成功者正常替换', () => {
    const { calls, warn } = recordWarn();
    const resolved = makeResolver('{name} 拾取 {count|fmt:number:0} 个', warn).resolve(
      'test.line',
      'zh-CN',
      { name: '阿澈' },
    );
    expect(resolved.text).toBe('阿澈 拾取 {count|fmt:number:0} 个');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.where['placeholder']).toBe('count');
  });
});

describe('插值与回退链协作（07 任务 2）', () => {
  it('回退主语言后仍执行插值（目标语言缺键场景）', () => {
    const { calls, warn } = recordWarn();
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: {
        'zh-CN': pack('zh-CN', { 'scenes.tavern.greet': '「又是你啊，{player.name}。」' }),
        'en-US': pack('en-US', {}),
      },
      warn,
    });
    const resolved = resolver.resolve('scenes.tavern.greet', 'en-US', { 'player.name': '阿澈' });
    expect(resolved.text).toBe('「又是你啊，阿澈。」');
    expect(resolved.fallbackUsed).toBe(true);
    expect(calls).toHaveLength(1); // 仅回退告警，插值本身成功
    expect(calls[0]?.where['detail']).toBeUndefined();
  });
});
