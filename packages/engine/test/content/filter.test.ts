import { describe, expect, it } from 'vitest';
import type { ContentTagsDef } from '@game/shared';
import { ContentFilter } from '../../src/content/index.js';

/**
 * ContentFilter 谓词用例（22 任务 1，设计 §5.8 / FR-CGRD-01~03）。
 *
 * 引擎中立性红线：本模块只做「标签 id 集合 ∩ disabledTags」的机制判定，
 * 不解释任何标签语义；标签含义与占位文案责任归游戏包与发布者。
 */

const TAGS: ContentTagsDef = {
  tags: [
    { id: 'tag_horror', nameKey: 'tags.horror.name', defaultOn: false },
    { id: 'tag_romance', nameKey: 'tags.romance.name', defaultOn: true },
  ],
};

describe('22-1 ContentFilter：passes（标签集合判定）', () => {
  it('无标签 / 空标签集合恒放行（未标注内容不受过滤影响）', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: ['tag_horror'] });
    expect(filter.passes()).toBe(true);
    expect(filter.passes([])).toBe(true);
  });

  it('标签未被玩家禁用 → 放行', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: ['tag_horror'] });
    expect(filter.passes(['tag_romance'])).toBe(true);
  });

  it('任一标签被禁用 → 整段屏蔽（多标签取交集语义）', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: ['tag_horror'] });
    expect(filter.passes(['tag_horror'])).toBe(false);
    expect(filter.passes(['tag_romance', 'tag_horror'])).toBe(false);
  });

  it('disabledTags 为空 → 全部放行（缺省不过滤）', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: [] });
    expect(filter.passes(['tag_horror', 'tag_romance'])).toBe(true);
  });
});

describe('22-1 ContentFilter：eventAdmissible（应用点 1 预留言）', () => {
  it('事件标签命中禁用 → 不可进入事件池', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: ['tag_horror'] });
    expect(filter.eventAdmissible({ tags: ['tag_horror'] })).toBe(false);
  });

  it('事件无标签或标签未命中 → 可进入事件池', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: ['tag_horror'] });
    expect(filter.eventAdmissible({})).toBe(true);
    expect(filter.eventAdmissible({ tags: ['tag_romance'] })).toBe(true);
  });
});

describe('22-1 ContentFilter：placeholderFor（占位键回退）', () => {
  it('已屏蔽 + 游戏提供占位键 → 返回该键', () => {
    const filter = new ContentFilter(
      TAGS,
      { disabledTags: ['tag_horror'] },
      { placeholderKey: 'content.filtered.placeholder' },
    );
    expect(filter.placeholderFor(['tag_horror'])).toBe('content.filtered.placeholder');
  });

  it('已屏蔽但未提供占位键 → null（调用方跳过该内容）', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: ['tag_horror'] });
    expect(filter.placeholderFor(['tag_horror'])).toBe(null);
  });

  it('未被屏蔽 → null（调用方保留原文）', () => {
    const filter = new ContentFilter(
      TAGS,
      { disabledTags: ['tag_horror'] },
      { placeholderKey: 'content.filtered.placeholder' },
    );
    expect(filter.placeholderFor(['tag_romance'])).toBe(null);
    expect(filter.placeholderFor()).toBe(null);
  });
});
