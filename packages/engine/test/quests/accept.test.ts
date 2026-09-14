import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import type { GameId, QuestDef, QuestState } from '@game/shared';
import { QuestMachine } from '../../src/quests/quest-machine.js';
import { makeDefs, makeHarness, stageQuest } from './fixtures.js';

/**
 * 11 任务 2：accept 校验矩阵（§4.5；FR-QUEST-04）。
 *
 * 覆盖 acceptIf / requires / conflicts 三维校验与拒绝原因可读性；无目录
 * 缺省语义（05 号兼容）保持：不带 stage 直接 active。
 */

const MAIN: QuestDef = stageQuest(
  'q_main',
  [
    { id: 's1', objectiveKey: 'quest.main.s1', completeWhen: 'flag.step1' },
    { id: 's2', objectiveKey: 'quest.main.s2', completeWhen: 'flag.step2' },
  ],
  { acceptIf: 'flag.rumor' },
);

function machineWith(...defs: QuestDef[]): QuestMachine {
  return new QuestMachine({ defs: makeDefs(defs) });
}

/** 断言 accept 被拒：EFFECT_FAILED{op:'quest'} 且 detail 可读 */
function reject(run: () => void, contains: string): void {
  try {
    run();
    expect.unreachable('应当拒绝接取');
  } catch (err) {
    const error = err as EngineError;
    expect(error.code).toBe('EFFECT_FAILED');
    expect(error.where.op).toBe('quest');
    expect(error.where.quest).toBeTypeOf('string');
    expect(error.message).toContain(contains);
  }
}

describe('11-2 accept：建档与状态门', () => {
  it('acceptIf 满足 → active + 首阶段 + startedDay + objectives 空表 + 事件', () => {
    const machine = machineWith(MAIN);
    const h = makeHarness({ day: 3, conditions: { 'flag.rumor': true } });
    machine.accept(h.ctx, 'q_main');
    expect(h.state.quests['q_main']).toEqual({
      state: 'active',
      stage: 's1',
      objectives: {},
      startedDay: 3,
    });
    expect(h.events).toEqual([
      { type: 'quest_state_changed', quest: 'q_main', from: 'undiscovered', to: 'active' },
    ]);
  });

  it('重复接取 / 终态接取：拒绝原因含当前状态', () => {
    const machine = machineWith(MAIN);
    const h = makeHarness({ conditions: { 'flag.rumor': true } });
    machine.accept(h.ctx, 'q_main');
    reject(() => machine.accept(h.ctx, 'q_main'), '不可接取');
    h.state.quests['q_main'] = { state: 'done', objectives: {} };
    reject(() => machine.accept(h.ctx, 'q_main'), '不可接取');
  });

  it('available 态接取合法（六态迁移表）', () => {
    const machine = machineWith(MAIN);
    const h = makeHarness({
      conditions: { 'flag.rumor': true },
      quests: { q_main: { state: 'available', objectives: {} } },
    });
    machine.accept(h.ctx, 'q_main');
    expect(h.state.quests['q_main']?.state).toBe('active');
    expect(h.events[0]).toEqual({
      type: 'quest_state_changed',
      quest: 'q_main',
      from: 'available',
      to: 'active',
    });
  });

  it('无任务目录：accept 允许（05 号兼容，无 stage）', () => {
    const machine = new QuestMachine({ defs: new Map() });
    const h = makeHarness();
    machine.accept(h.ctx, 'q_freeform');
    expect(h.state.quests['q_freeform']).toEqual({
      state: 'active',
      objectives: {},
      startedDay: 1,
    });
  });
});

describe('11-2 accept：acceptIf 条件', () => {
  it('acceptIf 为假 → 拒绝且不写状态（detail 带表达式原文）', () => {
    const machine = machineWith(MAIN);
    const h = makeHarness({ conditions: { 'flag.rumor': false } });
    reject(() => machine.accept(h.ctx, 'q_main'), 'acceptIf');
    expect(h.state.quests['q_main']).toBeUndefined();
    expect(h.events).toEqual([]);
  });

  it('acceptIf 只对同一表达式求值一次（校验不重复消耗）', () => {
    const machine = machineWith(MAIN);
    const h = makeHarness({ conditions: { 'flag.rumor': true } });
    machine.accept(h.ctx, 'q_main');
    expect(h.conditions.calls).toEqual(['flag.rumor']);
  });
});

describe('11-2 accept：requires 前置任务', () => {
  const dependent: QuestDef = stageQuest(
    'q_dep',
    [{ id: 's1', objectiveKey: 'quest.dep.s1', completeWhen: 'flag.done_dep' }],
    { requires: ['q_main'] },
  );

  it('前置未完成（不存在 / active / failed）→ 拒绝', () => {
    const machine = machineWith(MAIN, dependent);
    for (const pre of [undefined, 'active', 'failed'] as const) {
      const quests: Record<GameId, QuestState> = {};
      if (pre !== undefined) quests['q_main'] = { state: pre, objectives: {} };
      const h = makeHarness({ quests });
      reject(() => machine.accept(h.ctx, 'q_dep'), '前置任务');
    }
  });

  it('前置 done → 接取成功', () => {
    const machine = machineWith(MAIN, dependent);
    const h = makeHarness({
      quests: { q_main: { state: 'done', objectives: {} } },
    });
    machine.accept(h.ctx, 'q_dep');
    expect(h.state.quests['q_dep']?.state).toBe('active');
  });
});

describe('11-2 accept：conflicts 互斥任务', () => {
  const conflicting: QuestDef = stageQuest(
    'q_conflict',
    [{ id: 's1', objectiveKey: 'quest.conflict.s1', completeWhen: 'flag.c' }],
    { conflicts: ['q_main'] },
  );

  it('对方 active / ready_to_submit → 拒绝（进行中互斥）', () => {
    const machine = machineWith(MAIN, conflicting);
    for (const state of ['active', 'ready_to_submit'] as const) {
      const h = makeHarness({ quests: { q_main: { state, objectives: {} } } });
      reject(() => machine.accept(h.ctx, 'q_conflict'), '互斥');
    }
  });

  it('对方 done / failed / 不存在 → 不构成互斥，可接取', () => {
    const machine = machineWith(MAIN, conflicting);
    for (const state of ['done', 'failed', undefined] as const) {
      const quests: Record<GameId, QuestState> = {};
      if (state !== undefined) quests['q_main'] = { state, objectives: {} };
      const h = makeHarness({ quests });
      machine.accept(h.ctx, 'q_conflict');
      expect(h.state.quests['q_conflict']?.state).toBe('active');
    }
  });
});

describe('11-2 accept：校验优先级', () => {
  it('状态门先于 acceptIf（已在 active 时不消耗条件求值）', () => {
    const machine = machineWith(MAIN);
    const h = makeHarness({
      quests: { q_main: { state: 'active', objectives: {} } },
      conditions: { 'flag.rumor': true },
    });
    reject(() => machine.accept(h.ctx, 'q_main'), '不可接取');
    expect(h.conditions.calls).toEqual([]);
  });
});
