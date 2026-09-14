import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { QuestDef, TimeConfig } from '@game/shared';
import { newGameState } from '../../src/state/new-game.js';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import { createBuiltinEffectRegistry } from '../../src/effects/index.js';
import { TimePipeline } from '../../src/time/pipeline.js';
import { createQuestDeadlineProvider } from '../../src/quests/deadline.js';
import { BASE_VERSIONS } from '../effects/fixtures.js';
import { makeDefs, stageQuest } from './fixtures.js';

/**
 * 11 任务 5（管线接线）：时间截止经步骤 7 的 `__quest.deadline` 落地。
 *
 * 管线固定次序里步骤 7 在时钟推进（步骤 1）之后：failWhen 的时间条件在
 * 推进后的时钟上判定，跨过截止日的那次 advance 触发 failed，且与时钟变更
 * 属同一事务（一次推进 = 一个 undo 点）。
 */

const CONFIG: TimeConfig = {
  slots: [
    { id: 'slot_a', nameKey: 'time.slot.a' },
    { id: 'slot_b', nameKey: 'time.slot.b' },
    { id: 'slot_c', nameKey: 'time.slot.c' },
    { id: 'slot_d', nameKey: 'time.slot.d' },
  ],
  weekdays: Array.from({ length: 7 }, (_, i) => ({ nameKey: `time.weekday.${i + 1}` })),
  startWeekday: 1,
};

const TIMED: QuestDef = stageQuest(
  'q_timed',
  [{ id: 's1', objectiveKey: 'quest.timed.s1', completeWhen: 'flag.done' }],
  { failWhen: 'time.day > 2' },
);

function makePipeline() {
  const state = newGameState({ versions: BASE_VERSIONS, attrs: { hp: 10 } }, createRng(1));
  state.quests['q_timed'] = { state: 'active', stage: 's1', objectives: {}, startedDay: 1 };
  const registry = createBuiltinEffectRegistry({
    timeConfig: CONFIG,
    quests: makeDefs([TIMED]),
  });
  const runtime = new GameRuntime({ state, rng: createRng(1), effectExecutor: registry });
  const pipeline = new TimePipeline({
    runtime,
    config: CONFIG,
    questDeadline: createQuestDeadlineProvider(),
  });
  return { runtime, pipeline };
}

describe('11-5 时间截止：管线步骤 7 挂载', () => {
  it('provider 产出 __quest.deadline 内部指令', () => {
    const effects = createQuestDeadlineProvider()({
      runtime: {} as never,
      rng: createRng(1),
      slots: 1,
      crossedDay: false,
      crossedWeek: false,
      crossedMonth: false,
    });
    expect(effects).toEqual([{ '__quest.deadline': {} }]);
  });

  it('未到截止日：推进后任务保持 active', () => {
    const { runtime, pipeline } = makePipeline();
    pipeline.advance(4); // day1 → day2（2 > 2 为假）
    expect(runtime.state.world.time.day).toBe(2);
    expect(runtime.state.quests['q_timed']?.state).toBe('active');
  });

  it('跨过截止日：同一事务内转 failed + quest_state_changed', () => {
    const { runtime, pipeline } = makePipeline();
    pipeline.advance(4); // day2
    const outcome = pipeline.advance(4); // day3 → failWhen 真
    expect(runtime.state.world.time.day).toBe(3);
    expect(runtime.state.quests['q_timed']?.state).toBe('failed');
    expect(outcome.events).toContainEqual({
      type: 'quest_state_changed',
      quest: 'q_timed',
      from: 'active',
      to: 'failed',
    });
    // 时钟与任务失败同属一次推进事务（补丁同批）
    expect(outcome.patches.some((patch) => patch.path[0] === 'world')).toBe(true);
    expect(outcome.patches.some((patch) => patch.path[0] === 'quests')).toBe(true);
  });

  it('失败后再推进不重复发事件（终态稳定）', () => {
    const { runtime, pipeline } = makePipeline();
    pipeline.advance(12); // day4 → failed
    expect(runtime.state.quests['q_timed']?.state).toBe('failed');
    const outcome = pipeline.advance(4);
    expect(outcome.events).toEqual([]);
  });
});
