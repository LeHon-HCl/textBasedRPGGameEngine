import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import type { QuestDef } from '@game/shared';
import { makeBuiltinRuntime, makeCtx } from '../effects/fixtures.js';
import type { EngineEvent } from '../../src/runtime/index.js';

/**
 * 11 任务 2（指令接线）：`quest` accept 经 QuestMachine 校验矩阵（§4.5）。
 *
 * 验证指令层与状态机的接线：acceptIf 不满足 → EFFECT_FAILED（op='quest'，
 * 原因可读）；满足 → 建 active 档并 emit quest_state_changed。
 */

const QUESTS: ReadonlyMap<string, QuestDef> = new Map([
  [
    'q_guarded',
    {
      id: 'q_guarded',
      acceptIf: 'flag.rumor',
      stages: [{ id: 's1', objectiveKey: 'quest.guarded.s1', completeWhen: 'flag.done' }],
    } satisfies QuestDef,
  ],
]);

describe('11-2 quest 指令：accept 接入真实状态机', () => {
  it('acceptIf 不满足 → 拒绝且不建档（拒绝原因可读）', () => {
    const { rt } = makeBuiltinRuntime({ registryOptions: { quests: QUESTS } });
    try {
      rt.exec([{ quest: { id: 'q_guarded', action: 'accept' } }], makeCtx());
      expect.unreachable('acceptIf 不满足应当失败');
    } catch (err) {
      const outer = err as EngineError;
      expect(outer.code).toBe('EFFECT_FAILED');
      const cause = outer.cause as EngineError;
      expect(cause.where.op).toBe('quest');
      expect(cause.message).toContain('acceptIf');
    }
    expect(rt.state.quests['q_guarded']).toBeUndefined();
  });

  it('acceptIf 满足 → active + 首阶段 + quest_state_changed 事件', () => {
    const { rt } = makeBuiltinRuntime({ registryOptions: { quests: QUESTS } });
    rt.exec([{ flag: { name: 'rumor' } }], makeCtx());
    const outcome = rt.exec([{ quest: { id: 'q_guarded', action: 'accept' } }], makeCtx());
    expect(rt.state.quests['q_guarded']).toEqual({
      state: 'active',
      stage: 's1',
      objectives: {},
      startedDay: 1,
    });
    expect(outcome.events).toContainEqual<EngineEvent>({
      type: 'quest_state_changed',
      quest: 'q_guarded',
      from: 'undiscovered',
      to: 'active',
    });
  });
});
