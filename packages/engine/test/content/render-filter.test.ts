import { describe, expect, it } from 'vitest';
import type { SceneDef } from '@game/shared';
import { ContentFilter } from '../../src/content/index.js';
import { makeDef, makeRunner } from '../narrative/fixtures.js';

/**
 * 应用点 2：段落渲染前占位替换（22 任务 3，设计 §5.8 / FR-CGRD-03）。
 *
 * 08 号既有行为兼容红线：**未注入 contentFilter 时逐字不变**（不过滤段落，
 * 原文键原样返回）。屏蔽粒度说明：02 号 `segmentSchema` 无独立 tags，本模块
 * 以**场景标签**为屏蔽粒度（§5.8「场景/段落渲染前」）；被跳过的屏蔽内容不得
 * 进入历史缓冲（FR-READ-04 回看面不泄漏被屏蔽内容）。
 */

const TAGS = {
  tags: [{ id: 'tag_horror', nameKey: 'tags.horror.name', defaultOn: true }],
};

/** 构造注入用过滤器（disabledTags 命中 tag_horror） */
function horrorFilter(placeholderKey?: string): ContentFilter {
  return new ContentFilter(
    TAGS,
    { disabledTags: ['tag_horror'] },
    placeholderKey === undefined ? {} : { placeholderKey },
  );
}

function sceneWith(overrides: Partial<SceneDef> = {}): SceneDef {
  return {
    id: 'scene_start',
    area: 'demo',
    segments: [{ key: 'scenes.start.p1' }, { key: 'scenes.start.p2' }],
    choices: [],
    ...overrides,
  };
}

describe('22-3 应用点2：段落占位替换', () => {
  it('场景标签被屏蔽 + 配置占位键 → 文本段落键替换为占位键（原文不出现）', () => {
    const def = makeDef({ scenes: [sceneWith({ tags: ['tag_horror'] })] });
    const runner = makeRunner(def, { contentFilter: horrorFilter('content.filtered.placeholder') });
    const list = runner.renderList();
    const texts = list.filter((segment) => segment.kind === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0]?.key).toBe('content.filtered.placeholder');
  });

  it('未注入过滤器 → 逐字返回原文键（08 号既有行为不变）', () => {
    const def = makeDef({ scenes: [sceneWith({ tags: ['tag_horror'] })] });
    const runner = makeRunner(def);
    const list = runner.renderList();
    const texts = list.filter((segment) => segment.kind === 'text');
    expect(texts[0]?.key).toBe('scenes.start.p1');
  });

  it('注入过滤器但场景标签未命中 → 返回原文键', () => {
    const def = makeDef({ scenes: [sceneWith({ tags: ['tag_romance'] })] });
    const runner = makeRunner(def, { contentFilter: horrorFilter('content.filtered.placeholder') });
    const texts = runner.renderList().filter((segment) => segment.kind === 'text');
    expect(texts[0]?.key).toBe('scenes.start.p1');
  });

  it('场景无标签 → 过滤器不屏蔽（未标注内容恒放行）', () => {
    const def = makeDef({ scenes: [sceneWith()] });
    const runner = makeRunner(def, { contentFilter: horrorFilter('content.filtered.placeholder') });
    const texts = runner.renderList().filter((segment) => segment.kind === 'text');
    expect(texts[0]?.key).toBe('scenes.start.p1');
  });
});

describe('22-3 应用点2：无占位键回退（跳过）', () => {
  it('屏蔽且未配置占位键 → 文本段落整体跳过（无 text 段落）', () => {
    const def = makeDef({ scenes: [sceneWith({ tags: ['tag_horror'] })] });
    const runner = makeRunner(def, { contentFilter: horrorFilter() });
    const list = runner.renderList();
    expect(list.filter((segment) => segment.kind === 'text')).toHaveLength(0);
  });

  it('场景带媒体绑定 + 屏蔽跳过 → 媒体段落保留，仅文本被跳过', () => {
    const def = makeDef({
      scenes: [sceneWith({ tags: ['tag_horror'], media: { bg: 'bg_room' } })],
    });
    const runner = makeRunner(def, { contentFilter: horrorFilter() });
    const list = runner.renderList();
    expect(list.filter((segment) => segment.kind === 'image')).toHaveLength(1);
    expect(list.filter((segment) => segment.kind === 'text')).toHaveLength(0);
  });

  it('推进到第二段（无占位跳过）仍不产出文本，也不产生悬空间距', () => {
    const def = makeDef({ scenes: [sceneWith({ tags: ['tag_horror'] })] });
    const runner = makeRunner(def, { contentFilter: horrorFilter() });
    runner.renderList();
    runner.advance();
    const kinds = runner.renderList().map((segment) => segment.kind);
    expect(kinds).toEqual([]);
  });
});

describe('22-3 应用点2：历史缓冲不泄漏被屏蔽内容', () => {
  it('占位替换 → 历史记录占位键（可见内容），不含原文键', () => {
    const def = makeDef({ scenes: [sceneWith({ tags: ['tag_horror'] })] });
    const runner = makeRunner(def, { contentFilter: horrorFilter('content.filtered.placeholder') });
    runner.renderList();
    const keys = runner.history().map((entry) => entry.segment.key);
    expect(keys).toEqual(['content.filtered.placeholder']);
  });

  it('屏蔽跳过 → 历史为空（被屏蔽原文不入账）', () => {
    const def = makeDef({ scenes: [sceneWith({ tags: ['tag_horror'] })] });
    const runner = makeRunner(def, { contentFilter: horrorFilter() });
    runner.renderList();
    runner.advance();
    runner.renderList();
    expect(runner.history()).toEqual([]);
  });
});

describe('22-3 应用点2：spacing 只在实际文本间', () => {
  it('屏蔽 + 占位替换多段 → 段落间 spacing 数量与可见文本段数一致', () => {
    const def = makeDef({ scenes: [sceneWith({ tags: ['tag_horror'] })] });
    const runner = makeRunner(def, { contentFilter: horrorFilter('content.filtered.placeholder') });
    runner.renderList();
    runner.advance();
    const list = runner.renderList();
    expect(list.map((segment) => segment.kind)).toEqual(['text', 'spacing', 'text']);
    expect(list.filter((segment) => segment.kind === 'text').map((s) => s.key)).toEqual([
      'content.filtered.placeholder',
      'content.filtered.placeholder',
    ]);
  });
});
