import { describe, expect, it } from 'vitest';
import type { QuestDef } from '@game/shared';
import { QuestMachine } from '../../src/quests/quest-machine.js';
import { makeDefs, makeHarness, stageQuest } from './fixtures.js';

/**
 * 11 任务 5：failWhen 判定（含 active 触碰触发与全量 evaluateFailures 两径）。
 *
 * - evaluateTouched：failWhen 的 refs 命中且为真 → failed（优先于阶段推进）；
 * - evaluateFailures：时间管线步骤 7 的全量扫描（active/ready_to_submit）；
 * - 失败统一 emit quest_state_changed → failed（on_fail 的作者侧订阅面）。
 */

const DEADLINE: QuestDef = stageQuest(
  'q_timed',
  [{ id: 's1', objectiveKey: 'quest.timed.s1', completeWhen: 'flag.done' }],
  { failWhen: 'time.day > 10' },
);

const MIXED: QuestDef = stageQuest(
  'q_mixed',
  [
    { id: 's1', objectiveKey: 'quest.mixed.s1', completeWhen: 'flag.step1' },
    { id: 's2', objectiveKey: 'quest.mixed.s2', completeWhen: 'flag.step2' },
  ],
  { failWhen: 'flag.abandoned' },
);

const QUEST_REFS = new Map<string, ReadonlySet<string>>([
  ['time.day', new Set(['q_timed'])],
  ['flag.abandoned', new Set(['q_mixed'])],
  ['flag.step1', new Set(['q_mixed'])],
  ['flag.step2', new Set(['q_mixed'])],
]);

function active(stage = 's1', day = 1) {
  return { state: 'active' as const, stage, objectives: {}, startedDay: day };
}

describe('11-5 failWhen：触碰触发（evaluateTouched）', () => {
  it('failWhen refs 命中且为真 → failed + 事件', () => {
    const machine = new QuestMachine({ defs: makeDefs([DEADLINE]), questRefs: QUEST_REFS });
    const h = makeHarness({
      quests: { q_timed: active() },
      conditions: { 'time.day > 10': true },
    });
    machine.evaluateTouched(h.ctx, ['world.time.day']);
    expect(h.state.quests['q_timed']?.state).toBe('failed');
    expect(h.events).toEqual([
      { type: 'quest_state_changed', quest: 'q_timed', from: 'active', to: 'failed' },
    ]);
  });

  it('failWhen 优先于阶段推进（失败后不再推进）', () => {
    const machine = new QuestMachine({ defs: makeDefs([MIXED]), questRefs: QUEST_REFS });
    const h = makeHarness({
      quests: { q_mixed: active() },
      conditions: { 'flag.abandoned': true, 'flag.step1': true },
    });
    machine.evaluateTouched(h.ctx, ['world.flags.abandoned']);
    expect(h.state.quests['q_mixed']?.state).toBe('failed');
    expect(h.state.quests['q_mixed']?.stage).toBe('s1');
    expect(h.events.some((event) => event.type === 'quest_stage')).toBe(false);
  });

  it('failWhen 为假 → 正常推进阶段', () => {
    const machine = new QuestMachine({ defs: makeDefs([MIXED]), questRefs: QUEST_REFS });
    const h = makeHarness({
      quests: { q_mixed: active() },
      conditions: { 'flag.abandoned': false, 'flag.step1': true, 'flag.step2': false },
    });
    machine.evaluateTouched(h.ctx, ['world.flags.step1']);
    expect(h.state.quests['q_mixed']?.stage).toBe('s2');
    expect(h.state.quests['q_mixed']?.state).toBe('active');
  });
});

describe('11-5 evaluateFailures：步骤 7 全量扫描', () => {
  it('仅对 active / ready_to_submit 且 failWhen 为真者失败', () => {
    const machine = new QuestMachine({ defs: makeDefs([DEADLINE, MIXED]) });
    const h = makeHarness({
      quests: {
        q_timed: active(),
        q_mixed: { state: 'ready_to_submit', stage: 's2', objectives: {} },
      },
      conditions: { 'time.day > 10': true, 'flag.abandoned': true },
    });
    machine.evaluateFailures(h.ctx);
    expect(h.state.quests['q_timed']?.state).toBe('failed');
    expect(h.state.quests['q_mixed']?.state).toBe('failed');
    expect(h.events).toEqual([
      { type: 'quest_state_changed', quest: 'q_timed', from: 'active', to: 'failed' },
      { type: 'quest_state_changed', quest: 'q_mixed', from: 'ready_to_submit', to: 'failed' },
    ]);
  });

  it('条件为假 / 非活跃 / 未定义 failWhen → 不变', () => {
    const machine = new QuestMachine({ defs: makeDefs([DEADLINE]) });
    const h = makeHarness({
      quests: {
        q_timed: active(),
        q_other: { state: 'done', objectives: {} },
      },
      conditions: { 'time.day > 10': false },
    });
    machine.evaluateFailures(h.ctx);
    expect(h.state.quests['q_timed']?.state).toBe('active');
    expect(h.events).toEqual([]);
  });

  it('无任务目录 / 无活跃任务：空操作', () => {
    const empty = new QuestMachine({ defs: new Map() });
    const h = makeHarness();
    expect(empty.evaluateFailures(h.ctx)).toEqual([]);
    expect(h.conditions.calls).toEqual([]);
  });
});
