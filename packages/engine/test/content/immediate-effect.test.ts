import { describe, expect, it } from 'vitest';
import type { SceneDef } from '@game/shared';
import { ContentFilter } from '../../src/content/index.js';
import { makeDef, makeRunner, makeRuntime, visibleIds } from '../narrative/fixtures.js';

/**
 * 设置即时生效（22 任务 5，设计 §5.8 / FR-CGRD-03）。
 *
 * 约定：ContentFilter 在构造时快照 settings.disabledTags（实例不可变），
 * 「即时生效」= 标签开关变更后由宿主**重建实例**并重渲染当前场景——本用例
 * 模拟该流程：同一 runtime 上分别以「变更前 / 变更后」的过滤器重建 runner，
 * 断言当前场景的段落与选项呈现同步变化。
 *
 * 边界：任务降级（filter-quest-break）不在此列——属 26 号编辑器静态校验的
 * 可达性分析，运行时不管控（设计 §5.8 末段）；见 quest-boundary.test.ts。
 */

const TAGS = {
  tags: [{ id: 'tag_horror', nameKey: 'tags.horror.name', defaultOn: true }],
};

const PLACEHOLDER = 'content.filtered.placeholder';

const SCENE: SceneDef = {
  id: 'scene_start',
  area: 'demo',
  tags: ['tag_horror'],
  segments: [{ key: 'scenes.start.p1' }],
  choices: [
    { id: 'tagged', textKey: 'scenes.start.choice.tagged', tags: ['tag_horror'] },
    { id: 'plain', textKey: 'scenes.start.choice.plain' },
  ],
};

/** 以给定 disabledTags 构造过滤器（模拟设置面板重建设置态） */
function filterFor(disabledTags: readonly string[]): ContentFilter {
  return new ContentFilter(TAGS, { disabledTags }, { placeholderKey: PLACEHOLDER });
}

describe('22-5 设置变更 → 重建实例 → 当前场景重渲染', () => {
  it('关闭 tag_horror：段落替换占位键 + 选项隐藏', () => {
    const def = makeDef({ scenes: [SCENE] });
    const runner = makeRunner(def, {
      runtime: makeRuntime({}),
      contentFilter: filterFor(['tag_horror']),
    });
    const text = runner.renderList().find((segment) => segment.kind === 'text');
    expect(text?.key).toBe(PLACEHOLDER);
    runner.advance();
    expect(visibleIds(runner.choices())).toEqual(['plain']);
  });

  it('重新开启 tag_horror（重建实例）：段落恢复原文 + 选项恢复可见', () => {
    const def = makeDef({ scenes: [SCENE] });
    const runtime = makeRuntime({});
    // 变更前：标签被关闭
    const before = makeRunner(def, { runtime, contentFilter: filterFor(['tag_horror']) });
    expect(before.renderList().find((segment) => segment.kind === 'text')?.key).toBe(PLACEHOLDER);

    // 设置变更 → 重建过滤器实例与 runner（即时生效路径）
    const after = makeRunner(def, { runtime, contentFilter: filterFor([]) });
    expect(after.renderList().find((segment) => segment.kind === 'text')?.key).toBe(
      'scenes.start.p1',
    );
    after.advance();
    expect(visibleIds(after.choices())).toEqual(['tagged', 'plain']);
  });

  it('过滤器实例为设置快照：不随 runtime 状态后续改写漂移', () => {
    const def = makeDef({ scenes: [SCENE] });
    const runtime = makeRuntime({ disabledTags: ['tag_horror'] });
    // 注入的过滤器未关闭任何标签 → 以过滤器为准（快照语义，§5.8「重建实例」）
    const runner = makeRunner(def, { runtime, contentFilter: filterFor([]) });
    expect(runner.renderList().find((segment) => segment.kind === 'text')?.key).toBe(
      'scenes.start.p1',
    );
  });
});
