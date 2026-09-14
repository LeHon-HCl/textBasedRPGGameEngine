import { describe, expect, it } from 'vitest';
import type { QuestDef, QuestState } from '@game/shared';
import { QuestMachine } from '../../src/quests/quest-machine.js';
import { makeDefs, stageQuest } from './fixtures.js';

/**
 * 11 任务 6：progress() 目标进度投影（FR-QUEST-05 文本插值数据源）。
 *
 * 投影规则（文档化契约）：
 * - 逐阶段输出 { stageId, objectiveKey, complete, value }；
 * - complete：done/ready_to_submit 全阶段为真；否则当前阶段之前的阶段为真；
 * - value：优先取 QuestState.objectives[stageId]，缺省按 complete 取 1/0。
 */

const MAIN: QuestDef = stageQuest('q_main', [
  { id: 's1', objectiveKey: 'quest.main.s1', completeWhen: 'flag.a' },
  { id: 's2', objectiveKey: 'quest.main.s2', completeWhen: 'flag.b' },
  { id: 's3', objectiveKey: 'quest.main.s3', completeWhen: 'flag.c' },
]);

function stageState(stage: string, extra: Partial<QuestState> = {}): QuestState {
  return { state: 'active', stage, objectives: {}, ...extra };
}

describe('11-6 progress()：目标进度投影', () => {
  it('active 于首阶段：全部未完成，value 缺省 0', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    expect(machine.progress({ q_main: stageState('s1') }, 'q_main')).toEqual([
      { stageId: 's1', objectiveKey: 'quest.main.s1', complete: false, value: 0 },
      { stageId: 's2', objectiveKey: 'quest.main.s2', complete: false, value: 0 },
      { stageId: 's3', objectiveKey: 'quest.main.s3', complete: false, value: 0 },
    ]);
  });

  it('已越过阶段 marked complete；objectives 数值覆盖默认', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    const progress = machine.progress(
      { q_main: stageState('s2', { objectives: { s2: 3 } }) },
      'q_main',
    );
    expect(progress).toEqual([
      { stageId: 's1', objectiveKey: 'quest.main.s1', complete: true, value: 1 },
      { stageId: 's2', objectiveKey: 'quest.main.s2', complete: false, value: 3 },
      { stageId: 's3', objectiveKey: 'quest.main.s3', complete: false, value: 0 },
    ]);
  });

  it('ready_to_submit / done：全阶段完成', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    for (const state of ['ready_to_submit', 'done'] as const) {
      const progress = machine.progress(
        { q_main: { state, stage: 's3', objectives: {} } },
        'q_main',
      );
      expect(progress.every((entry) => entry.complete)).toBe(true);
    }
  });

  it('done 时 objectives 显式值优先于默认 1', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    const progress = machine.progress(
      { q_main: { state: 'done', stage: 's3', objectives: { s1: 7 } } },
      'q_main',
    );
    expect(progress[0]?.value).toBe(7);
    expect(progress[1]?.value).toBe(1);
  });

  it('failed 于中途：之前阶段完成，当前及之后未完成', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    const progress = machine.progress(
      { q_main: { state: 'failed', stage: 's2', objectives: {} } },
      'q_main',
    );
    expect(progress.map((entry) => entry.complete)).toEqual([true, false, false]);
  });

  it('未接取 / 无目录 / 未知任务 → []', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    expect(machine.progress({}, 'q_main')).toEqual([]);
    expect(machine.progress({ q_main: stageState('s1') }, 'q_ghost')).toEqual([]);
    const noDefs = new QuestMachine({ defs: new Map() });
    expect(noDefs.progress({ q_main: stageState('s1') }, 'q_main')).toEqual([]);
  });
});
