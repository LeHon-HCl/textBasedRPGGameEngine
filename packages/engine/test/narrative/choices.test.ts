import { describe, expect, it } from 'vitest';
import type { SceneDef } from '@game/shared';
import { makeDef, makeRunner, makeRuntime, visibleIds } from './fixtures.js';

/**
 * choices() 过滤与置灰用例（08 任务 A3，设计 §4.2 ChoiceView / FR-NARR-02 /
 * FR-CGRD-02）：
 * - show_if 不满足 → hiddenByFilter（整个选项不出现）；
 * - disabledIf 满足 → enabled=false 置灰（可见但不可用）+ disabledReasonKey；
 * - 选项内容标签命中 settings.disabledTags → hiddenByFilter（内容过滤）。
 */

function sceneWith(choices: SceneDef['choices']): SceneDef {
  return { id: 'scene_start', area: 'demo', segments: [{ key: 'scenes.start.p1' }], choices };
}

const LOCALES = {
  'zh-CN': {
    scenes: {
      start: {
        p1: '段落。',
        choice: {
          gated: '需要勇气',
          muted: '被禁言',
          tagged: '越界内容',
          plain: '普通选项',
        },
      },
    },
  },
};

/** 推进到 await_choice 的辅助（单段落场景：render + advance 一次） */
function toChoicePhase(
  def: ReturnType<typeof makeDef>,
  runtimeSpec?: Parameters<typeof makeRuntime>[0],
) {
  const runner = makeRunner(def, {
    sceneId: 'scene_start',
    runtime: makeRuntime(runtimeSpec ?? {}),
  });
  runner.renderList();
  runner.advance();
  expect(runner.phase).toBe('await_choice');
  return runner;
}

describe('08-A3 choices：置灰条件（disabledIf / disabledReasonKey）', () => {
  it('disabledIf 满足 → enabled=false 且透传 disabledReasonKey（仍出现在列表）', () => {
    const def = makeDef({
      scenes: [
        sceneWith([
          {
            id: 'muted',
            textKey: 'scenes.start.choice.muted',
            disabledIf: 'attr.stamina < 10',
            disabledReasonKey: 'scenes.start.choice.gated',
          },
        ]),
      ],
      locales: LOCALES,
    });
    const runner = toChoicePhase(def, { attrs: { stamina: 5 } });
    const views = runner.choices();
    expect(views).toHaveLength(1);
    expect(views[0]?.enabled).toBe(false);
    expect(views[0]?.disabledReasonKey).toBe('scenes.start.choice.gated');
    expect(views[0]?.hiddenByFilter).toBeUndefined();
    expect(visibleIds(views)).toEqual(['muted']);
  });

  it('disabledIf 不满足 → enabled=true 且不携带 disabledReasonKey', () => {
    const def = makeDef({
      scenes: [
        sceneWith([
          {
            id: 'muted',
            textKey: 'scenes.start.choice.muted',
            disabledIf: 'attr.stamina < 10',
            disabledReasonKey: 'scenes.start.choice.gated',
          },
        ]),
      ],
      locales: LOCALES,
    });
    const runner = toChoicePhase(def, { attrs: { stamina: 30 } });
    const views = runner.choices();
    expect(views[0]?.enabled).toBe(true);
    expect(views[0]?.disabledReasonKey).toBeUndefined();
  });

  it('置灰但未声明原因键 → enabled=false 且无 reasonKey（可选项独立）', () => {
    const def = makeDef({
      scenes: [
        sceneWith([
          { id: 'muted', textKey: 'scenes.start.choice.muted', disabledIf: 'flag.blocked' },
        ]),
      ],
      locales: LOCALES,
    });
    const runner = toChoicePhase(def, { flags: { blocked: true } });
    const views = runner.choices();
    expect(views[0]?.enabled).toBe(false);
    expect(views[0]?.disabledReasonKey).toBeUndefined();
  });
});

describe('08-A3 choices：内容标签过滤（FR-CGRD-02）', () => {
  it('选项标签命中 settings.disabledTags → hiddenByFilter', () => {
    const def = makeDef({
      scenes: [
        sceneWith([
          { id: 'tagged', textKey: 'scenes.start.choice.tagged', tags: ['tag_horror'] },
          { id: 'plain', textKey: 'scenes.start.choice.plain' },
        ]),
      ],
      locales: LOCALES,
    });
    const runner = toChoicePhase(def, { disabledTags: ['tag_horror'] });
    const views = runner.choices();
    expect(views.find((view) => view.id === 'tagged')?.hiddenByFilter).toBe(true);
    expect(views.find((view) => view.id === 'plain')?.hiddenByFilter).toBeUndefined();
    expect(visibleIds(views)).toEqual(['plain']);
  });

  it('标签未被禁用 → 选项正常可见', () => {
    const def = makeDef({
      scenes: [
        sceneWith([{ id: 'tagged', textKey: 'scenes.start.choice.tagged', tags: ['tag_horror'] }]),
      ],
      locales: LOCALES,
    });
    const runner = toChoicePhase(def, { disabledTags: ['tag_romance'] });
    expect(visibleIds(runner.choices())).toEqual(['tagged']);
  });
});

describe('08-A3 choices：过滤与置灰叠加', () => {
  it('show_if 隐藏与 disabledIf 置灰相互独立：隐藏项仍报告置灰状态', () => {
    const def = makeDef({
      scenes: [
        sceneWith([
          {
            id: 'gated',
            textKey: 'scenes.start.choice.gated',
            showIf: 'flag.never_set',
            disabledIf: 'attr.stamina < 10',
            disabledReasonKey: 'scenes.start.choice.gated',
          },
          { id: 'plain', textKey: 'scenes.start.choice.plain' },
        ]),
      ],
      locales: LOCALES,
    });
    const runner = toChoicePhase(def, { attrs: { stamina: 5 } });
    const views = runner.choices();
    const gated = views.find((view) => view.id === 'gated');
    expect(gated?.hiddenByFilter).toBe(true);
    expect(gated?.enabled).toBe(false);
    expect(visibleIds(views)).toEqual(['plain']);
  });

  it('全部选项被过滤 → 无可见选项（段落尽即终局，A1 口径复核）', () => {
    const def = makeDef({
      scenes: [
        sceneWith([{ id: 'tagged', textKey: 'scenes.start.choice.tagged', tags: ['tag_x'] }]),
      ],
      locales: LOCALES,
    });
    const runner = makeRunner(def, {
      sceneId: 'scene_start',
      runtime: makeRuntime({ disabledTags: ['tag_x'] }),
    });
    runner.renderList();
    runner.advance();
    expect(runner.phase).toBe('finished');
    expect(runner.choices()).toEqual([]);
  });
});
