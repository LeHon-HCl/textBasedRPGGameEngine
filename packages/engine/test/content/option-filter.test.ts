import { describe, expect, it } from 'vitest';
import type { SceneDef } from '@game/shared';
import { ContentFilter } from '../../src/content/index.js';
import { makeDef, makeRunner, makeRuntime, visibleIds } from '../narrative/fixtures.js';

/**
 * 应用点 3：选项 `choices()` 过滤（22 任务 4，设计 §5.8 / FR-CGRD-02）。
 *
 * 08 号既有行为兼容红线：**未注入 contentFilter 时沿用既有语义**——选项标签
 * 命中 `settings.disabledTags` 即 hiddenByFilter（choices.test.ts 已锁死）。
 * 注入 contentFilter 后，标签过滤收敛到 ContentFilter 单点（FR-CGRD-03
 * 「全部经 ContentFilter 单点」），此时不再直查 runtime 设置。
 */

const TAGS = {
  tags: [{ id: 'tag_horror', nameKey: 'tags.horror.name', defaultOn: true }],
};

function sceneWith(choices: SceneDef['choices']): SceneDef {
  return { id: 'scene_start', area: 'demo', segments: [{ key: 'scenes.start.p1' }], choices };
}

/** 推进到 await_choice（单段落场景：render + advance 一次） */
function toChoicePhase(def: ReturnType<typeof makeDef>, spec: Parameters<typeof makeRunner>[1]) {
  const runner = makeRunner(def, spec);
  runner.renderList();
  runner.advance();
  return runner;
}

const CHOICES: SceneDef['choices'] = [
  { id: 'tagged', textKey: 'scenes.start.choice.tagged', tags: ['tag_horror'] },
  { id: 'plain', textKey: 'scenes.start.choice.plain' },
];

describe('22-4 应用点3：注入过滤器后选项隐藏', () => {
  it('选项标签命中注入过滤器 → hiddenByFilter（runtime 设置为空也生效）', () => {
    const def = makeDef({ scenes: [sceneWith(CHOICES)] });
    const runner = toChoicePhase(def, {
      runtime: makeRuntime({}),
      contentFilter: new ContentFilter(TAGS, { disabledTags: ['tag_horror'] }),
    });
    expect(runner.phase).toBe('await_choice');
    const views = runner.choices();
    expect(views.find((view) => view.id === 'tagged')?.hiddenByFilter).toBe(true);
    expect(views.find((view) => view.id === 'plain')?.hiddenByFilter).toBeUndefined();
    expect(visibleIds(views)).toEqual(['plain']);
  });

  it('注入过滤器未命中 → 选项可见', () => {
    const def = makeDef({ scenes: [sceneWith(CHOICES)] });
    const runner = toChoicePhase(def, {
      runtime: makeRuntime({}),
      contentFilter: new ContentFilter(TAGS, { disabledTags: ['tag_romance'] }),
    });
    expect(visibleIds(runner.choices())).toEqual(['tagged', 'plain']);
  });

  it('注入过滤器时以过滤器为准，不再直查 runtime.disabledTags（单点语义）', () => {
    const def = makeDef({ scenes: [sceneWith(CHOICES)] });
    const runner = toChoicePhase(def, {
      // runtime 关闭 tag_horror，但注入过滤器未关闭 → 选项可见（过滤收敛单点）
      runtime: makeRuntime({ disabledTags: ['tag_horror'] }),
      contentFilter: new ContentFilter(TAGS, { disabledTags: [] }),
    });
    expect(visibleIds(runner.choices())).toEqual(['tagged', 'plain']);
  });

  it('全部选项被过滤器隐藏 → 段落尽即终局 finished（不可选）', () => {
    const def = makeDef({ scenes: [sceneWith([CHOICES[0] as SceneDef['choices'][number]])] });
    const runner = toChoicePhase(def, {
      runtime: makeRuntime({}),
      contentFilter: new ContentFilter(TAGS, { disabledTags: ['tag_horror'] }),
    });
    expect(runner.phase).toBe('finished');
    expect(runner.choices()).toEqual([]);
  });
});

describe('22-4 应用点3：缺省不过滤（08 号兼容回归）', () => {
  it('未注入过滤器 → 沿用 runtime.disabledTags 直查（既有行为不变）', () => {
    const def = makeDef({ scenes: [sceneWith(CHOICES)] });
    const runner = toChoicePhase(def, { runtime: makeRuntime({ disabledTags: ['tag_horror'] }) });
    expect(visibleIds(runner.choices())).toEqual(['plain']);
  });
});
