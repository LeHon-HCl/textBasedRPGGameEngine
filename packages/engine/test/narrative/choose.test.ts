import { describe, expect, it } from 'vitest';
import { EngineError, isEngineError } from '@game/shared';
import type { SceneDef } from '@game/shared';
import { makeDef, makeRunner, makeRuntime, stubRuntime, visibleIds } from './fixtures.js';

/**
 * choose() 选择消费用例（08 任务 A4，设计 §4.2「执行选项效果 → 消费
 * ExecOutcome.jumps」/ FR-NARR-02）：
 * - 被过滤（show_if / 内容标签）与置灰选项不可选（入参校验，相位不变）；
 * - 选项效果经真实事务管线作用于状态（05 号内置指令集成）；
 * - lastOutcome 把非流程跳转（advance_time / battle）留给宿主消费。
 */

function sceneWith(choices: SceneDef['choices']): SceneDef {
  return { id: 'scene_start', area: 'demo', segments: [{ key: 'scenes.start.p1' }], choices };
}

const LOCALES = {
  'zh-CN': {
    scenes: {
      start: { p1: '段落。', choice: { gated: '需要勇气', plain: '普通', work: '干活' } },
      next: { p1: '下一场景。' },
    },
  },
};

/** 单段落场景推进到 await_choice */
function toChoicePhase(
  scenes: readonly SceneDef[],
  runtimeSpec?: Parameters<typeof makeRuntime>[0],
) {
  const def = makeDef({ scenes, locales: LOCALES });
  const runner = makeRunner(def, {
    sceneId: 'scene_start',
    runtime: makeRuntime(runtimeSpec ?? {}),
  });
  runner.renderList();
  runner.advance();
  expect(runner.phase).toBe('await_choice');
  return runner;
}

describe('08-A4 choose：不可用选项的入参校验', () => {
  it('show_if 隐藏的选项不可选（INTERNAL choiceFiltered，相位不变）', () => {
    const runner = toChoicePhase([
      sceneWith([
        { id: 'gated', textKey: 'scenes.start.choice.gated', showIf: 'flag.never_set' },
        { id: 'plain', textKey: 'scenes.start.choice.plain' },
      ]),
    ]);
    expect(() => runner.choose('gated')).toThrowError(EngineError);
    expect(runner.phase).toBe('await_choice');
    try {
      runner.choose('gated');
    } catch (error) {
      expect(isEngineError(error)).toBe(true);
      expect((error as EngineError).messageKey).toBe('error.narrative.choiceFiltered');
    }
  });

  it('内容标签被禁用的选项同样不可选（过滤即不可点）', () => {
    const runner = toChoicePhase(
      [
        sceneWith([
          { id: 'gated', textKey: 'scenes.start.choice.gated', tags: ['tag_x'] },
          { id: 'plain', textKey: 'scenes.start.choice.plain' },
        ]),
      ],
      { disabledTags: ['tag_x'] },
    );
    expect(visibleIds(runner.choices())).toEqual(['plain']);
    expect(() => runner.choose('gated')).toThrowError(EngineError);
    expect(runner.phase).toBe('await_choice');
  });

  it('置灰选项不可选（INTERNAL choiceDisabled，可见但不可用）', () => {
    const runner = toChoicePhase(
      [
        sceneWith([
          {
            id: 'gated',
            textKey: 'scenes.start.choice.gated',
            disabledIf: 'attr.stamina < 10',
            disabledReasonKey: 'scenes.start.choice.gated',
          },
        ]),
      ],
      { attrs: { stamina: 5 } },
    );
    expect(() => runner.choose('gated')).toThrowError(EngineError);
    expect(runner.phase).toBe('await_choice');
    try {
      runner.choose('gated');
    } catch (error) {
      expect((error as EngineError).messageKey).toBe('error.narrative.choiceDisabled');
      expect((error as EngineError).where['choice']).toBe('gated');
    }
  });
});

describe('08-A4 choose：选项效果与状态事务（真实内置指令集成）', () => {
  it('效果序列真实写入状态（flag/attr），并回到 await_choice', () => {
    const runner = toChoicePhase([
      sceneWith([
        {
          id: 'work',
          textKey: 'scenes.start.choice.work',
          effects: [{ flag: { name: 'worked' } }, { add: { key: 'attr.insight', amount: 2 } }],
        },
      ]),
    ]);
    runner.choose('work');
    expect(runner.phase).toBe('await_choice');
    expect(runner.lastOutcome?.patches.length).toBeGreaterThan(0);
    expect(visibleIds(runner.choices())).toEqual(['work']);
  });

  it('选择后状态变化即时反映到剩余选项的 show_if 过滤（同相位再渲染）', () => {
    const runner = toChoicePhase([
      sceneWith([
        {
          id: 'work',
          textKey: 'scenes.start.choice.work',
          effects: [{ flag: { name: 'insight_gate' } }],
        },
        { id: 'gated', textKey: 'scenes.start.choice.gated', showIf: 'flag.insight_gate' },
      ]),
    ]);
    expect(visibleIds(runner.choices())).toEqual(['work']);
    runner.choose('work');
    expect(visibleIds(runner.choices())).toEqual(['work', 'gated']);
  });

  it('非流程跳转（advance_time）经 lastOutcome 留给宿主，会话留在原场景', () => {
    const runner = toChoicePhase([
      sceneWith([
        {
          id: 'work',
          textKey: 'scenes.start.choice.work',
          effects: [{ advance_time: { cost: 1 } }],
        },
      ]),
    ]);
    runner.choose('work');
    expect(runner.phase).toBe('await_choice');
    expect(runner.lastOutcome?.jumps).toEqual([{ type: 'advanceTime', slots: 1 }]);
  });

  it('exec 上下文定位：source=choice + where.scene=当前场景（桩 runtime 记录）', () => {
    const stub = stubRuntime();
    const def = makeDef({
      scenes: [sceneWith([{ id: 'plain', textKey: 'scenes.start.choice.plain' }])],
      locales: LOCALES,
    });
    const runner = makeRunner(def, { sceneId: 'scene_start', runtime: stub });
    runner.renderList();
    runner.advance();
    runner.choose('plain');
    expect(stub.execCalls[0]?.ctx.source).toBe('choice');
    expect(stub.execCalls[0]?.ctx.where.scene).toBe('scene_start');
  });
});
