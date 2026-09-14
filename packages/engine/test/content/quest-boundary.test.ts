import { describe, expect, it } from 'vitest';
import { EngineError, isEngineError } from '@game/shared';
import type { SceneDef } from '@game/shared';
import { ContentFilter } from '../../src/content/index.js';
import { makeDef, makeRunner, makeRuntime, visibleIds } from '../narrative/fixtures.js';

/**
 * 任务降级边界说明（22 任务 7，设计 §5.8 末段 / FR-CGRD-05）。
 *
 * **边界结论**：被屏蔽内容是否破坏任务线（任务目标不可达）属**静态校验**
 * 问题，由 26 号编辑器校验中心的 `filter-quest-break` 规则（默认过滤下的图
 * 可达性分析，detail-design §7.7）承担；**运行时不管控**（性能考虑，§5.8）。
 *
 * 因此本模块在运行期只做「呈现层」过滤——段落占位替换、选项隐藏、事件池
 * prune 接口，绝不改写任务状态、不评估任务可达性。本用例锁定该边界：屏蔽
 * 标签的渲染与选择失败均不得触碰 `state.quests`。
 */

const TAGS = {
  tags: [{ id: 'tag_horror', nameKey: 'tags.horror.name', defaultOn: true }],
};

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

function setup() {
  const def = makeDef({ scenes: [SCENE] });
  const runtime = makeRuntime({});
  const runner = makeRunner(def, {
    runtime,
    contentFilter: new ContentFilter(TAGS, { disabledTags: ['tag_horror'] }),
  });
  runner.renderList();
  runner.advance();
  return { runtime, runner };
}

describe('22-7 任务降级边界：运行时不管控任务可达性（归 26 号 filter-quest-break）', () => {
  it('屏蔽标签的渲染/推进不改写 state.quests', () => {
    const { runtime, runner } = setup();
    const before = structuredClone(runtime.state.quests);
    runner.renderList();
    expect(runtime.state.quests).toEqual(before);
  });

  it('被过滤器隐藏的选项不可选（choiceFiltered），且不触发任何任务结算', () => {
    const { runtime, runner } = setup();
    const before = structuredClone(runtime.state.quests);
    expect(visibleIds(runner.choices())).toEqual(['plain']);
    let caught: unknown;
    try {
      runner.choose('tagged');
    } catch (error) {
      caught = error;
    }
    expect(isEngineError(caught)).toBe(true);
    expect((caught as EngineError).messageKey).toBe('error.narrative.choiceFiltered');
    // 运行时未因「屏蔽内容关联任务」做任何降级/补偿——可达性属 26 号静态校验
    expect(runtime.state.quests).toEqual(before);
    expect(runner.phase).toBe('await_choice');
  });

  it('可见选项正常执行但不隐式改动任务域（过滤与任务系统无耦合）', () => {
    const { runtime, runner } = setup();
    const before = structuredClone(runtime.state.quests);
    runner.choose('plain');
    expect(runtime.state.quests).toEqual(before);
  });
});
