import { describe, expect, it } from 'vitest';
import type { QuestDef, QuestState } from '@game/shared';
import { projectQuestLog } from '../../src/quests/projection.js';

/**
 * 11 任务 7：任务日志数据源投影（FR-QUEST-03）。
 *
 * - 按状态分组（固定展示序：active → ready_to_submit → available → failed →
 *   done → undiscovered；缺省不含 undiscovered）；
 * - 条目带当前阶段 objectiveKey / giver / startedDay；
 * - 追踪置顶：按传入 tracked 顺序，受 trackingLimit 限制。
 */

const DEFS = new Map<string, QuestDef>([
  [
    'q_active',
    {
      id: 'q_active',
      giver: 'npc_a',
      stages: [
        { id: 's1', objectiveKey: 'quest.active.s1', completeWhen: 'flag.x' },
        { id: 's2', objectiveKey: 'quest.active.s2', completeWhen: 'flag.y' },
      ],
    } satisfies QuestDef,
  ],
  [
    'q_ready',
    {
      id: 'q_ready',
      stages: [{ id: 'r1', objectiveKey: 'quest.ready.r1', completeWhen: 'flag.z' }],
    } satisfies QuestDef,
  ],
  [
    'q_avail',
    {
      id: 'q_avail',
      giver: 'npc_b',
      stages: [{ id: 'a1', objectiveKey: 'quest.avail.a1', completeWhen: 'flag.w' }],
    } satisfies QuestDef,
  ],
  [
    'q_done',
    {
      id: 'q_done',
      giver: 'npc_c',
      stages: [{ id: 'd1', objectiveKey: 'quest.done.d1', completeWhen: 'flag.v' }],
    } satisfies QuestDef,
  ],
]);

function state(quests: Record<string, QuestState>): { quests: Record<string, QuestState> } {
  return { quests };
}

describe('11-7 projectQuestLog：分组与条目', () => {
  it('按状态分组且组序固定；缺省不含 undiscovered', () => {
    const view = projectQuestLog(
      state({
        q_done: { state: 'done', stage: 'd1', objectives: {} },
        q_active: { state: 'active', stage: 's2', objectives: {}, startedDay: 3 },
        q_avail: { state: 'available', objectives: {} },
        q_ready: { state: 'ready_to_submit', stage: 'r1', objectives: {} },
      }),
      DEFS,
    );
    expect(view.groups.map((group) => group.state)).toEqual([
      'active',
      'ready_to_submit',
      'available',
      'done',
    ]);
    const active = view.groups.find((group) => group.state === 'active')?.entries[0];
    expect(active).toEqual({
      quest: 'q_active',
      state: 'active',
      stage: 's2',
      objectiveKey: 'quest.active.s2',
      giver: 'npc_a',
      startedDay: 3,
    });
    const avail = view.groups.find((group) => group.state === 'available')?.entries[0];
    expect(avail?.objectiveKey).toBeUndefined();
    expect(avail?.giver).toBe('npc_b');
  });

  it('includeUndiscovered 时含 undiscovered 组（无阶段条目）', () => {
    const view = projectQuestLog(
      state({ q_avail: { state: 'undiscovered', objectives: {} } }),
      DEFS,
      { includeUndiscovered: true },
    );
    expect(view.groups).toEqual([
      {
        state: 'undiscovered',
        entries: [{ quest: 'q_avail', state: 'undiscovered', giver: 'npc_b' }],
      },
    ]);
  });

  it('同一状态多条目：按目录声明序稳定排列（不随状态对象插入序）', () => {
    const defs = new Map<string, QuestDef>([
      [
        'q_first',
        { id: 'q_first', stages: [{ id: 'f1', objectiveKey: 'q.first', completeWhen: 'flag.f' }] },
      ],
      [
        'q_second',
        {
          id: 'q_second',
          stages: [{ id: 'n1', objectiveKey: 'q.second', completeWhen: 'flag.n' }],
        },
      ],
    ]);
    const view = projectQuestLog(
      state({
        q_second: { state: 'available', objectives: {} },
        q_first: { state: 'available', objectives: {} },
      }),
      defs,
    );
    expect(view.groups[0]?.entries.map((entry) => entry.quest)).toEqual(['q_first', 'q_second']);
  });

  it('空状态 → 空 groups / tracked', () => {
    expect(projectQuestLog(state({}), DEFS)).toEqual({ groups: [], tracked: [] });
  });
});

describe('11-7 projectQuestLog：追踪置顶', () => {
  it('tracked 按传入顺序置顶，受 trackingLimit 限制', () => {
    const quests: Record<string, QuestState> = {
      q_active: { state: 'active', stage: 's1', objectives: {} },
      q_ready: { state: 'ready_to_submit', stage: 'r1', objectives: {} },
      q_done: { state: 'done', stage: 'd1', objectives: {} },
    };
    const view = projectQuestLog(state(quests), DEFS, {
      tracked: ['q_done', 'q_active', 'q_ready'],
      trackingLimit: 2,
    });
    expect(view.tracked.map((entry) => entry.quest)).toEqual(['q_done', 'q_active']);
  });

  it('tracked 中不存在于状态的任务被跳过；缺省 limit=3', () => {
    const view = projectQuestLog(
      state({
        q_active: { state: 'active', stage: 's1', objectives: {} },
        q_ready: { state: 'ready_to_submit', stage: 'r1', objectives: {} },
        q_done: { state: 'done', stage: 'd1', objectives: {} },
      }),
      DEFS,
      { tracked: ['q_ghost', 'q_ready', 'q_active', 'q_done'] },
    );
    expect(view.tracked.map((entry) => entry.quest)).toEqual(['q_ready', 'q_active', 'q_done']);
  });
});
