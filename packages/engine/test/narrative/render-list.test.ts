import { describe, expect, it } from 'vitest';
import type { SceneDef } from '@game/shared';
import type { MediaIntent } from '../../src/runtime/index.js';
import { makeDef, makeRunner } from './fixtures.js';

/**
 * renderList 段落流形态用例（08 任务 A2，设计 §4.2 RenderSegment）：
 * - 相邻文本段落之间产出 spacing 分隔段（段落流的可视化换行语义）；
 * - 场景级媒体绑定（FR-NARR-01，DD-05）在进入时产出 media intent，映射为
 *   前置 image 段落（bg 无 loop；bgm 恒 loop:true）；
 * - image 段落不计入段落游标：advance 的「还有段落」语义只针对文本段落。
 */

const DEF = makeDef({
  scenes: [
    {
      id: 'scene_start',
      area: 'demo',
      segments: [
        { key: 'scenes.start.p1' },
        { key: 'scenes.start.p2' },
        { key: 'scenes.start.p3' },
      ],
      choices: [],
      media: { bg: 'bg_town_rain', bgm: 'bgm_old_town' },
    },
    {
      id: 'scene_plain',
      area: 'demo',
      segments: [{ key: 'scenes.plain.p1' }],
      choices: [],
    },
  ],
  locales: {
    'zh-CN': {
      scenes: {
        start: { p1: '一段。', p2: '二段。', p3: '三段。' },
        plain: { p1: '素场景。' },
      },
    },
  },
});

describe('08-A2 renderList：段落流 spacing 分隔', () => {
  it('相邻文本段落之间插入 spacing（首段之前无分隔）', () => {
    const runner = makeRunner(DEF, { sceneId: 'scene_plain' });
    runner.renderList();
    const segments = runner.renderList();
    expect(segments.map((segment) => segment.kind)).toEqual(['text']);
    expect(segments[0]?.key).toBe('scenes.plain.p1');
  });

  it('揭示两段 → image, text, spacing, text；揭示三段 → 两个 spacing', () => {
    const runner = makeRunner(DEF, { sceneId: 'scene_start' });
    runner.renderList();
    runner.advance();
    const two = runner.renderList();
    expect(two.map((segment) => segment.kind)).toEqual(['image', 'text', 'spacing', 'text']);
    expect(two.map((segment) => segment.key ?? null)).toEqual([
      null,
      'scenes.start.p1',
      null,
      'scenes.start.p2',
    ]);
    runner.advance();
    const three = runner.renderList();
    expect(three.map((segment) => segment.kind)).toEqual([
      'image',
      'text',
      'spacing',
      'text',
      'spacing',
      'text',
    ]);
  });

  it('spacing 段不携带键与 vars（纯布局段）', () => {
    const runner = makeRunner(DEF, { sceneId: 'scene_start' });
    runner.renderList();
    runner.advance();
    const spacing = runner.renderList().filter((segment) => segment.kind === 'spacing');
    expect(spacing).toHaveLength(1);
    expect(spacing[0]?.key).toBeUndefined();
    expect(spacing[0]?.vars).toBeUndefined();
    expect(spacing[0]?.media).toBeUndefined();
  });
});

describe('08-A2 renderList：场景级媒体 intent（FR-NARR-01 / DD-05）', () => {
  it('bg/bgm 绑定 → 前置 image 段落携带 media intent（bgm 恒 loop）', () => {
    const runner = makeRunner(DEF, { sceneId: 'scene_start' });
    const segments = runner.renderList();
    const image = segments[0];
    expect(image?.kind).toBe('image');
    const media = image?.media as readonly MediaIntent[];
    expect(media).toEqual([
      { type: 'bg', assetId: 'bg_town_rain' },
      { type: 'bgm', assetId: 'bgm_old_town', loop: true },
    ]);
    // image 段落不携带文本键
    expect(image?.key).toBeUndefined();
  });

  it('无媒体绑定的场景不产出 image 段落', () => {
    const runner = makeRunner(DEF, { sceneId: 'scene_plain' });
    const segments = runner.renderList();
    expect(segments.some((segment) => segment.kind === 'image')).toBe(false);
  });

  it('image 段落不计入段落游标（advance 只针对文本段落）', () => {
    const runner = makeRunner(DEF, { sceneId: 'scene_start' });
    const first = runner.renderList();
    // 首渲染只揭示 1 个文本段落 + image 前置段
    expect(first.filter((segment) => segment.kind === 'text')).toHaveLength(1);
    expect(first[0]?.kind).toBe('image');
    runner.advance();
    runner.advance();
    runner.advance(); // 段落尽（3 文本段），无选项 → finished
    const final = runner.renderList();
    expect(runner.phase).toBe('finished');
    expect(final.filter((segment) => segment.kind === 'text')).toHaveLength(3);
    expect(final[0]?.kind).toBe('image');
  });

  it('仅绑定 bg 的场景：intent 序列只含 bg（bgm 缺省不产出）', () => {
    const scene: SceneDef = {
      id: 'scene_bg_only',
      area: 'demo',
      segments: [{ key: 'scenes.plain.p1' }],
      choices: [],
      media: { bg: 'bg_only' },
    };
    const def = makeDef({
      scenes: [scene],
      locales: { 'zh-CN': { scenes: { plain: { p1: 'x' } } } },
    });
    const runner = makeRunner(def, { sceneId: 'scene_bg_only' });
    const image = runner.renderList()[0];
    expect(image?.media).toEqual([{ type: 'bg', assetId: 'bg_only' }]);
  });
});
