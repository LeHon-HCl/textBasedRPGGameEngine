import { describe, expect, it } from 'vitest';
import type { EventDef } from '@game/shared';
import { ContentFilter } from '../../src/content/index.js';

/**
 * 应用点 1：事件池 prune 接口预留 + 桩测试（22 任务 2，设计 §5.8 / §4.4）。
 *
 * 真正的 prune 接线（collect → prune → select）属 10 号事件系统；本模块只提供
 * `ContentFilter.eventAdmissible(e)` 判据与语义。本用例以**本模块内的桩 prune**
 * 模拟 10 号的调用形态，锁定「屏蔽标签事件不进入事件池」这一契约——10 号接入时
 * 以真实 prune 步骤替换桩即可，`ContentFilter` 侧零改动。
 */

const TAGS = {
  tags: [
    { id: 'tag_horror', nameKey: 'tags.horror.name', defaultOn: true },
    { id: 'tag_romance', nameKey: 'tags.romance.name', defaultOn: true },
  ],
};

/** 最小事件定义（仅填 prune 判定所需字段；其余给稳定占位） */
function event(id: string, tags?: readonly string[]): EventDef {
  return {
    id,
    where: { area: 'demo' },
    when: {},
    trigger: { type: 'condition', require: 'true' },
    scene: 'scene_start',
    ...(tags === undefined ? {} : { tags: [...tags] }),
  };
}

/** 桩 prune：10 号事件系统 prune 步骤的调用形态（此处只做内容过滤裁剪） */
function pruneByContent(events: readonly EventDef[], filter: ContentFilter): EventDef[] {
  return events.filter((candidate) => filter.eventAdmissible(candidate));
}

describe('22-2 应用点1：事件池 prune 接口预留（桩）', () => {
  it('屏蔽标签事件不进入事件池（FR-CGRD-03「被屏蔽事件不再进入事件池」）', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: ['tag_horror'] });
    const pool = [
      event('ev_plain'),
      event('ev_horror', ['tag_horror']),
      event('ev_love', ['tag_romance']),
    ];
    expect(pruneByContent(pool, filter).map((e) => e.id)).toEqual(['ev_plain', 'ev_love']);
  });

  it('空 disabledTags → 全部事件可入池（缺省不过滤）', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: [] });
    const pool = [event('ev_plain'), event('ev_horror', ['tag_horror'])];
    expect(pruneByContent(pool, filter).map((e) => e.id)).toEqual(['ev_plain', 'ev_horror']);
  });

  it('多标签事件任一命中即被裁剪（与段落/选项同口径）', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: ['tag_horror'] });
    const pool = [event('ev_mixed', ['tag_romance', 'tag_horror'])];
    expect(pruneByContent(pool, filter)).toEqual([]);
  });

  it('判据接受完整 EventDef（10 号接入零改动换实现的结构面）', () => {
    const filter = new ContentFilter(TAGS, { disabledTags: ['tag_horror'] });
    const candidate: EventDef = event('ev_horror', ['tag_horror']);
    expect(filter.eventAdmissible(candidate)).toBe(false);
  });
});
