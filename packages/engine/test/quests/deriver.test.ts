import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { QuestDef } from '@game/shared';
import { newGameState } from '../../src/state/new-game.js';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import { createBuiltinEffectRegistry } from '../../src/effects/index.js';
import { QuestMachine } from '../../src/quests/quest-machine.js';
import { createQuestConditionEvaluator, createQuestDeriver } from '../../src/quests/deriver.js';
import { BASE_VERSIONS, makeCtx } from '../effects/fixtures.js';

/**
 * 11 任务 3（runtime 接线）：事务后置派生器按 TouchReport 推进任务阶段。
 *
 * - 命中条件路径的事务 → 阶段推进并入同事务（outcome 可见 quest_stage 事件）；
 * - 未命中 / 空事务 → 零条件求值（不轮询的行为级证明）；
 * - 一次事务触碰多个条件 → 级联到 ready_to_submit。
 */

const DEF: QuestDef = {
  id: 'q_main',
  stages: [
    { id: 's1', objectiveKey: 'quest.main.s1', completeWhen: 'flag.step1' },
    { id: 's2', objectiveKey: 'quest.main.s2', completeWhen: 'flag.step2' },
  ],
};

const DEFS = new Map([['q_main', DEF]]);
const REFS = new Map<string, ReadonlySet<string>>([
  ['flag.step1', new Set(['q_main'])],
  ['flag.step2', new Set(['q_main'])],
]);

function makeRuntime(init: { recordEval?: string[]; stage?: string } = {}) {
  const state = newGameState({ versions: BASE_VERSIONS, attrs: { hp: 10 } }, createRng(1));
  state.quests['q_main'] = {
    state: 'active',
    stage: init.stage ?? 's1',
    objectives: {},
    startedDay: 1,
  };
  const machine = new QuestMachine({ defs: DEFS, questRefs: REFS });
  const base = createQuestConditionEvaluator();
  const evaluator =
    init.recordEval !== undefined
      ? (source: string, view: Parameters<typeof base>[1]): boolean => {
          init.recordEval?.push(source);
          return base(source, view);
        }
      : undefined;
  const deriver = createQuestDeriver(machine, {
    ...(evaluator !== undefined ? { evaluator } : {}),
  });
  const rt = new GameRuntime({
    state,
    rng: createRng(1),
    effectExecutor: createBuiltinEffectRegistry({ quests: DEFS }),
    derivers: [deriver],
  });
  return { rt, machine };
}

describe('11-3 派生器：命中即推进（同事务）', () => {
  it('flag 触碰 completeWhen → 阶段推进 + quest_stage 事件进 outcome', () => {
    const { rt } = makeRuntime();
    const outcome = rt.exec([{ flag: { name: 'step1' } }], makeCtx());
    expect(rt.state.quests['q_main']?.stage).toBe('s2');
    expect(outcome.events).toContainEqual({
      type: 'quest_stage',
      quest: 'q_main',
      from: 's1',
      to: 's2',
      objectiveKey: 'quest.main.s2',
    });
    // 任务状态变更成为事务补丁的一部分（同一 undo 点；对象整体替换 → 路径到任务级）
    expect(outcome.patches.some((patch) => patch.path.join('.') === 'quests.q_main')).toBe(true);
  });

  it('一次事务触碰两个条件 → 级联到 ready_to_submit', () => {
    const { rt } = makeRuntime();
    const outcome = rt.exec([{ flag: { name: 'step1' } }, { flag: { name: 'step2' } }], makeCtx());
    expect(rt.state.quests['q_main']?.state).toBe('ready_to_submit');
    expect(outcome.events).toContainEqual({
      type: 'quest_state_changed',
      quest: 'q_main',
      from: 'active',
      to: 'ready_to_submit',
    });
  });
});

describe('11-3 派生器：不轮询', () => {
  it('无关 flag 事务 → 条件求值零调用', () => {
    const record: string[] = [];
    const { rt } = makeRuntime({ recordEval: record });
    rt.exec([{ flag: { name: 'unrelated' } }], makeCtx());
    expect(record).toEqual([]);
    expect(rt.state.quests['q_main']?.stage).toBe('s1');
  });

  it('空事务（无补丁）→ 零条件求值', () => {
    const record: string[] = [];
    const { rt } = makeRuntime({ recordEval: record });
    rt.exec([], makeCtx());
    expect(record).toEqual([]);
  });

  it('命中路径只评估该任务的条件（脏标记精确）', () => {
    const record: string[] = [];
    const { rt } = makeRuntime({ recordEval: record });
    rt.exec([{ flag: { name: 'step1' } }], makeCtx());
    // 当前阶段 s1 命中；级联评估下一阶段 s2 一次 → 共 2 次，均为 q_main 的条件
    expect(record).toEqual(['flag.step1', 'flag.step2']);
  });
});
