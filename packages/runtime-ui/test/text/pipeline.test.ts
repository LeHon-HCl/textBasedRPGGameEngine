import { describe, expect, it } from 'vitest';
import { createTextResolver } from '@game/engine';
import type { LocalePack } from '@game/engine';
import { createRenderPipeline } from '../../src/text/index.js';

/**
 * 25 任务 4：渲染管线（设计 §6.1）。
 *
 * 管线：`RenderSegment → TextResolver.resolve（插值）→ sanitize（白名单）→ 节点树`。
 * 断言口径为**行为**：键物化、变量插值、标记白名单、缺失键回退与告警。
 * 次序不变式（§6.1）：先插值后 sanitize——插值值里的尖括号不得成为标签。
 */

const LOCALES: Record<string, LocalePack> = {
  'zh-CN': {
    lang: 'zh-CN',
    keys: new Map<string, string>([
      ['scenes.arrival.open', '暮雨初歇，你踏上旧镇的石板路。'],
      ['ui.hp', '生命 {player.attrs.hp} / 100'],
      ['ui.rich', '你感到<b>疲惫</b>。'],
      ['ui.tone', '灯火是<span class="tone-warm">暖的</span>。'],
      ['ui.inject', '你捡起了 {item.name}。'],
    ]),
  },
};

function makePipeline(): ReturnType<typeof createRenderPipeline> {
  const resolver = createTextResolver({ mainLang: 'zh-CN', locales: LOCALES });
  return createRenderPipeline({ resolver, lang: 'zh-CN' });
}

describe('渲染管线：键物化与插值（§6.1 / FR-L10N-03）', () => {
  it('文本键经 resolver 物化为纯文本节点', () => {
    const pipeline = makePipeline();
    const result = pipeline.render({ kind: 'text', key: 'scenes.arrival.open' });
    expect(result.nodes).toEqual([{ kind: 'text', text: '暮雨初歇，你踏上旧镇的石板路。' }]);
    expect(result.plainText).toBe('暮雨初歇，你踏上旧镇的石板路。');
    expect(result.found).toBe(true);
  });

  it('vars 参与插值（引擎做插值，UI 不重复劳动）', () => {
    const pipeline = makePipeline();
    const result = pipeline.render({
      kind: 'text',
      key: 'ui.hp',
      vars: { player: { attrs: { hp: 42 } } },
    });
    expect(result.plainText).toBe('生命 42 / 100');
  });

  it('白名单标记在物化结果中保留为元素节点', () => {
    const pipeline = makePipeline();
    expect(pipeline.render({ kind: 'text', key: 'ui.rich' }).nodes).toEqual([
      { kind: 'text', text: '你感到' },
      { kind: 'element', tag: 'b', children: [{ kind: 'text', text: '疲惫' }] },
      { kind: 'text', text: '。' },
    ]);
    expect(pipeline.render({ kind: 'text', key: 'ui.tone' }).nodes).toContainEqual({
      kind: 'element',
      tag: 'span',
      className: 'tone-warm',
      children: [{ kind: 'text', text: '暖的' }],
    });
  });

  it('插值值含标记字符时不引入标签（先插值后 sanitize 的次序保证）', () => {
    const pipeline = makePipeline();
    const result = pipeline.render({
      kind: 'text',
      key: 'ui.inject',
      vars: { item: { name: '<b>假标记</b>' } },
    });
    expect(result.nodes.every((node) => node.kind === 'text')).toBe(true);
    expect(result.plainText).toBe('你捡起了 <b>假标记</b>。');
  });

  it('缺键回退为原始键（found=false，不静默为空）', () => {
    const pipeline = makePipeline();
    const result = pipeline.render({ kind: 'text', key: 'missing.key' });
    expect(result.found).toBe(false);
    expect(result.plainText).toBe('missing.key');
    expect(result.nodes).toEqual([{ kind: 'text', text: 'missing.key' }]);
  });

  it('spacing 段落无文本（布局占位，不产生节点）', () => {
    const pipeline = makePipeline();
    const result = pipeline.render({ kind: 'spacing' });
    expect(result.nodes).toEqual([]);
    expect(result.plainText).toBe('');
    expect(result.found).toBe(true);
  });
});

describe('渲染管线：媒体段落与告警出口', () => {
  it('image 段落不产文本，媒体意图原样透传', () => {
    const pipeline = makePipeline();
    const result = pipeline.render({
      kind: 'image',
      media: [{ type: 'bg', assetId: 'old_town_street' }],
    });
    expect(result.plainText).toBe('');
    expect(result.media).toEqual([{ type: 'bg', assetId: 'old_town_street' }]);
  });

  it('缺失键不改走 UI 出口（resolver 的 warn 面负责，避免双份告警）', () => {
    const warnings: string[] = [];
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: LOCALES,
      warn: () => undefined,
    });
    const pipeline = createRenderPipeline({
      resolver,
      lang: 'zh-CN',
      onWarn: (message) => warnings.push(message),
    });
    pipeline.render({ kind: 'text', key: 'nope' });
    // 缺键告警由引擎 resolver 的 warn 出口送达；本管线的 onWarn 只承载
    // 「物化抛错」这类 UI 侧事件——同一缺陷不产生两处告警（§10.2 单点告警）
    expect(warnings).toEqual([]);
  });

  it('resolver 抛错时转为可见占位文本 + 告警，不把异常抛给渲染层', () => {
    const warnings: string[] = [];
    const resolver = createTextResolver({
      mainLang: 'zh-CN',
      locales: LOCALES,
      warn: () => undefined,
    });
    // 结构值违例是 §4.1 明确的抛错面；以桩 resolver 复现该路径
    const throwing: typeof resolver = {
      resolve: () => {
        throw new Error('SCHEMA_INVALID: 词典记录形态违例');
      },
      availableLangs: () => resolver.availableLangs(),
    };
    const pipeline = createRenderPipeline({
      resolver: throwing,
      lang: 'zh-CN',
      onWarn: (message) => warnings.push(message),
    });
    const result = pipeline.render({ kind: 'text', key: 'bad.key' });
    expect(result.found).toBe(false);
    expect(result.plainText).toBe('bad.key');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('bad.key');
  });
});

describe('渲染管线：片段列表与打字机数据面', () => {
  it('renderAll 返回逐段结果（叙事区一次推进的批量视图）', () => {
    const pipeline = makePipeline();
    const results = pipeline.renderAll([
      { kind: 'text', key: 'scenes.arrival.open' },
      { kind: 'spacing' },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]?.plainText).toContain('石板路');
    expect(results[1]?.plainText).toBe('');
  });

  it('段落的 vars 为函数时逐次求值（延迟插值，FR-NARR-04）', () => {
    const pipeline = makePipeline();
    let counter = 0;
    const result = pipeline.render({
      kind: 'text',
      key: 'ui.hp',
      vars: () => ({ player: { attrs: { hp: (counter += 1) } } }),
    });
    expect(result.plainText).toBe('生命 1 / 100');
    const again = pipeline.render({
      kind: 'text',
      key: 'ui.hp',
      vars: () => ({ player: { attrs: { hp: (counter += 1) } } }),
    });
    expect(again.plainText).toBe('生命 2 / 100');
  });
});
