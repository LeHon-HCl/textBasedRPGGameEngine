import { describe, expect, it } from 'vitest';
import type { QuestDef } from '@game/shared';
import { QuestMachine } from '../../src/quests/quest-machine.js';
import type { QuestStateEnum } from '../../src/quests/types.js';
import { makeDefs, makeHarness, stageQuest } from './fixtures.js';

/**
 * 11 任务 3：阶段推进经 refs 反查表按 TouchReport 触发（§4.5；不轮询）。
 *
 * 核心断言：
 * 1. 条件命中（touched 覆盖其 refs 状态前缀）→ 推进阶段并发 `quest_stage`；
 * 2. 未命中 / 空 touched → 完全不做条件求值（「不轮询」的行为级证明）；
 * 3. 级联：一次触碰可连续推进多个已满足阶段，末阶段 → ready_to_submit。
 */

const MAIN: QuestDef = stageQuest('q_main', [
  { id: 's1', objectiveKey: 'quest.main.s1', completeWhen: 'flag.step1' },
  { id: 's2', objectiveKey: 'quest.main.s2', completeWhen: 'flag.step2' },
]);

const OTHER: QuestDef = stageQuest('q_other', [
  { id: 'o1', objectiveKey: 'quest.other.o1', completeWhen: 'flag.other' },
]);

/** refs 反查表：compile 步骤 poolIndex.questRefs 的形态（表达式路径 → 任务 id） */
const QUEST_REFS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['flag.step1', new Set(['q_main'])],
  ['flag.step2', new Set(['q_main'])],
  ['flag.other', new Set(['q_other'])],
]);

function makeMachine(): QuestMachine {
  return new QuestMachine({ defs: makeDefs([MAIN, OTHER]), questRefs: QUEST_REFS });
}

function activeMain(stage: string): Record<string, ReturnType<typeof mainQuestState>> {
  return { q_main: mainQuestState(stage) };
}

function mainQuestState(stage: string) {
  return { state: 'active' as QuestStateEnum, stage, objectives: {}, startedDay: 1 };
}

describe('11-3 evaluateTouched：命中即推进，不轮询', () => {
  it('触碰 current 阶段条件 → 推进下一阶段 + quest_stage 事件（objectiveKey 指向新阶段）', () => {
    const machine = makeMachine();
    const h = makeHarness({ quests: activeMain('s1'), conditions: { 'flag.step1': true } });
    machine.evaluateTouched(h.ctx, ['world.flags.step1']);
    expect(h.state.quests['q_main']?.stage).toBe('s2');
    expect(h.events).toEqual([
      {
        type: 'quest_stage',
        quest: 'q_main',
        from: 's1',
        to: 's2',
        objectiveKey: 'quest.main.s2',
      },
    ]);
  });

  it('空 touched → 零条件求值、零状态变更（不轮询的行为级证明）', () => {
    const machine = makeMachine();
    const h = makeHarness({ quests: activeMain('s1'), conditions: { 'flag.step1': true } });
    const events = machine.evaluateTouched(h.ctx, []);
    expect(events).toEqual([]);
    expect(h.conditions.calls).toEqual([]);
    expect(h.state.quests['q_main']?.stage).toBe('s1');
    expect(h.events).toEqual([]);
  });

  it('触碰与任务无关的路径 → 不评估该任务条件（脏标记精确，不轮询）', () => {
    const machine = makeMachine();
    const h = makeHarness({
      quests: { ...activeMain('s1'), q_other: mainQuestState('o1') },
      conditions: { 'flag.step1': true, 'flag.other': false },
    });
    machine.evaluateTouched(h.ctx, ['world.flags.other']);
    expect(h.state.quests['q_main']?.stage).toBe('s1');
    expect(h.conditions.calls).not.toContain('flag.step1');
    expect(h.conditions.calls).toEqual(['flag.other']);
  });

  it('refs 未登记的任务不参与评估（缺表缺省不轮询）', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    const h = makeHarness({ quests: activeMain('s1'), conditions: { 'flag.step1': true } });
    machine.evaluateTouched(h.ctx, ['world.flags.step1']);
    expect(h.conditions.calls).toEqual([]);
    expect(h.state.quests['q_main']?.stage).toBe('s1');
  });
});

describe('11-3 evaluateTouched：级联与末阶段', () => {
  it('一次触碰连续推进已满足的多个阶段', () => {
    const machine = makeMachine();
    const h = makeHarness({
      quests: activeMain('s1'),
      conditions: { 'flag.step1': true, 'flag.step2': true },
    });
    machine.evaluateTouched(h.ctx, ['world.flags.step1']);
    // s1 → s2 → ready_to_submit（s2 为末阶段）
    expect(h.state.quests['q_main']?.stage).toBe('s2');
    expect(h.state.quests['q_main']?.state).toBe('ready_to_submit');
    expect(h.events).toEqual([
      {
        type: 'quest_stage',
        quest: 'q_main',
        from: 's1',
        to: 's2',
        objectiveKey: 'quest.main.s2',
      },
      { type: 'quest_state_changed', quest: 'q_main', from: 'active', to: 'ready_to_submit' },
    ]);
  });

  it('末阶段条件达成（当前已在末阶段）→ ready_to_submit，不再发 quest_stage', () => {
    const machine = makeMachine();
    const h = makeHarness({ quests: activeMain('s2'), conditions: { 'flag.step2': true } });
    machine.evaluateTouched(h.ctx, ['world.flags.step2']);
    expect(h.events).toEqual([
      { type: 'quest_state_changed', quest: 'q_main', from: 'active', to: 'ready_to_submit' },
    ]);
    expect(h.state.quests['q_main']?.state).toBe('ready_to_submit');
  });

  it('条件未达成 → 保持不变且不产事件', () => {
    const machine = makeMachine();
    const h = makeHarness({ quests: activeMain('s1'), conditions: { 'flag.step1': false } });
    machine.evaluateTouched(h.ctx, ['world.flags.step1']);
    expect(h.state.quests['q_main']?.stage).toBe('s1');
    expect(h.events).toEqual([]);
  });

  it('非 active 任务（available/done）不推进', () => {
    const machine = makeMachine();
    for (const state of ['available', 'done', 'failed'] as const) {
      const h = makeHarness({
        quests: { q_main: { state, stage: 's1', objectives: {} } },
        conditions: { 'flag.step1': true },
      });
      machine.evaluateTouched(h.ctx, ['world.flags.step1']);
      expect(h.conditions.calls).toEqual([]);
      expect(h.events).toEqual([]);
    }
  });
});

describe('11-3 refs 状态前缀映射：npc / time / quest 域', () => {
  it('npc.<id>.<字段> 映射 npcs.<id>.*（触碰 npcs 命中）', () => {
    const def: QuestDef = stageQuest('q_npc', [
      { id: 'n1', objectiveKey: 'quest.npc.n1', completeWhen: 'npc.old_guard.talked' },
    ]);
    const machine = new QuestMachine({
      defs: makeDefs([def]),
      questRefs: new Map([['npc.old_guard.talked', new Set(['q_npc'])]]),
    });
    const h = makeHarness({
      quests: { q_npc: mainQuestState('n1') },
      conditions: { 'npc.old_guard.talked': true },
    });
    machine.evaluateTouched(h.ctx, ['npcs.old_guard.flags.talked']);
    expect(h.state.quests['q_npc']?.state).toBe('ready_to_submit');
  });

  it('time.day 映射 world.time.day；player.attrs 映射 attr.<id>', () => {
    const def: QuestDef = stageQuest('q_time', [
      { id: 't1', objectiveKey: 'quest.time.t1', completeWhen: 'time.day > 5' },
    ]);
    const machine = new QuestMachine({
      defs: makeDefs([def]),
      questRefs: new Map([['time.day', new Set(['q_time'])]]),
    });
    const h = makeHarness({
      quests: { q_time: mainQuestState('t1') },
      conditions: { 'time.day > 5': true },
    });
    machine.evaluateTouched(h.ctx, ['world.time.day']);
    expect(h.state.quests['q_time']?.state).toBe('ready_to_submit');
  });
});
