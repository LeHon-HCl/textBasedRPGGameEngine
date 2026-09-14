import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '@game/shared';
import type { QuestDef } from '@game/shared';
import { newGameState } from '../../src/state/new-game.js';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import { createBuiltinEffectRegistry } from '../../src/effects/index.js';
import { QuestMachine } from '../../src/quests/quest-machine.js';
import { BASE_VERSIONS, makeCtx } from '../effects/fixtures.js';
import { makeDefs, makeHarness, stageQuest } from './fixtures.js';

/**
 * 11 任务 4：submit（ready_to_submit → done）+ rewards child 事务原子性（§4.5）。
 *
 * - 奖励经同一 draft 的 child 批执行；任一失败整批回滚，任务保持 ready_to_submit；
 * - 奖励成功后才写 done 并发 quest_state_changed；
 * - 指令路径 `complete` 在 ready 态走 submit（结算），active 态走强制完成（不结算）。
 */

const REWARDS = [
  { money: { silver: 20 } },
  { favor: { npc: 'npc_old_guard', amount: 15 } },
] as unknown as QuestDef['rewards'];

const MAIN: QuestDef = stageQuest(
  'q_main',
  [{ id: 's1', objectiveKey: 'quest.main.s1', completeWhen: 'flag.done' }],
  { rewards: REWARDS },
);

/** 仅发货币的奖励（runtime 集成用；favor 需 NPC 目录，单测由 child 桩覆盖） */
const MONEY_ONLY: QuestDef = stageQuest(
  'q_main',
  [{ id: 's1', objectiveKey: 'quest.main.s1', completeWhen: 'flag.done' }],
  { rewards: [{ money: { silver: 20 } }] as unknown as QuestDef['rewards'] },
);

function ready(): Record<string, { state: 'ready_to_submit'; stage: string; objectives: object }> {
  return { q_main: { state: 'ready_to_submit', stage: 's1', objectives: {} } };
}

/** 以预置 ready_to_submit 状态装配真实 runtime（奖励结算走完整事务链） */
function makeReadyRuntime(def: QuestDef, questState: Record<string, unknown>): GameRuntime {
  const state = newGameState({ versions: BASE_VERSIONS, attrs: { hp: 10 } }, createRng(1));
  state.quests = questState as never;
  return new GameRuntime({
    state,
    rng: createRng(1),
    effectExecutor: createBuiltinEffectRegistry({ quests: makeDefs([def]) }),
  });
}

describe('11-4 submit：奖励结算与状态迁移', () => {
  it('ready_to_submit → child(rewards) → done + 事件', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    const h = makeHarness({ quests: ready() });
    machine.submit(h.ctx, 'q_main');
    expect(h.children).toEqual([REWARDS]);
    expect(h.state.quests['q_main']?.state).toBe('done');
    expect(h.events).toEqual([
      { type: 'quest_state_changed', quest: 'q_main', from: 'ready_to_submit', to: 'done' },
    ]);
  });

  it('非 ready_to_submit（active / done / 不存在）→ 拒绝，不执行奖励', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    const cases = [{ state: 'active' as const }, { state: 'done' as const }, undefined];
    for (const entry of cases) {
      const h = makeHarness();
      if (entry !== undefined) h.state.quests['q_main'] = { ...entry, objectives: {} };
      try {
        machine.submit(h.ctx, 'q_main');
        expect.unreachable('应当拒绝提交');
      } catch (err) {
        const error = err as EngineError;
        expect(error.where.op).toBe('quest');
        expect(error.message).toContain('不可提交');
      }
      expect(h.children).toEqual([]);
    }
  });

  it('奖励 child 失败 → 任务保持 ready_to_submit、零事件（原子性由事务层保证）', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    const h = makeHarness({
      quests: ready(),
      onChild: () => {
        throw new EngineError({
          code: 'EFFECT_FAILED',
          where: { detail: '奖励发放失败（容量不足）' },
          messageKey: 'error.effects.effectFailed',
        });
      },
    });
    expect(() => machine.submit(h.ctx, 'q_main')).toThrow(EngineError);
    expect(h.state.quests['q_main']?.state).toBe('ready_to_submit');
    expect(h.events).toEqual([]);
  });

  it('无 rewards 的任务 submit → 直接 done（无 child 调用）', () => {
    const noRewards: QuestDef = stageQuest('q_plain', [
      { id: 's1', objectiveKey: 'quest.plain.s1', completeWhen: 'flag.x' },
    ]);
    const machine = new QuestMachine({ defs: makeDefs([noRewards]) });
    const h = makeHarness({
      quests: { q_plain: { state: 'ready_to_submit', stage: 's1', objectives: {} } },
    });
    machine.submit(h.ctx, 'q_plain');
    expect(h.children).toEqual([]);
    expect(h.state.quests['q_plain']?.state).toBe('done');
  });
});

describe('11-4 complete：ready 走 submit，active 强制完成', () => {
  it('complete(ready_to_submit) → 结算奖励后 done', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    const h = makeHarness({ quests: ready() });
    machine.complete(h.ctx, 'q_main');
    expect(h.children).toEqual([REWARDS]);
    expect(h.state.quests['q_main']?.state).toBe('done');
  });

  it('complete(active) → done 且不结算奖励（05 号兼容）', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    const h = makeHarness({
      quests: { q_main: { state: 'active', stage: 's1', objectives: {} } },
    });
    machine.complete(h.ctx, 'q_main');
    expect(h.children).toEqual([]);
    expect(h.state.quests['q_main']?.state).toBe('done');
    expect(h.events).toEqual([
      { type: 'quest_state_changed', quest: 'q_main', from: 'active', to: 'done' },
    ]);
  });

  it('终态 complete → 拒绝', () => {
    const machine = new QuestMachine({ defs: makeDefs([MAIN]) });
    const h = makeHarness({ quests: { q_main: { state: 'done', objectives: {} } } });
    expect(() => machine.complete(h.ctx, 'q_main')).toThrow(EngineError);
  });
});

describe('11-4 指令接线：complete 结算奖励（同事务原子性）', () => {
  it('ready 态 complete → 奖励入账 + done（同一事务补丁）', () => {
    const rt = makeReadyRuntime(MONEY_ONLY, ready());
    const outcome = rt.exec([{ quest: { id: 'q_main', action: 'complete' } }], makeCtx());
    expect(rt.state.quests['q_main']?.state).toBe('done');
    expect(rt.state.player.wallet['silver']).toBe(20);
    expect(outcome.events).toContainEqual({
      type: 'quest_state_changed',
      quest: 'q_main',
      from: 'ready_to_submit',
      to: 'done',
    });
    expect(outcome.patches.some((patch) => patch.path.join('.').startsWith('player.wallet'))).toBe(
      true,
    );
  });

  it('奖励执行失败 → 整批事务回滚，任务保持 ready_to_submit、钱包不变', () => {
    const failing: QuestDef = stageQuest(
      'q_bad',
      [{ id: 's1', objectiveKey: 'quest.bad.s1', completeWhen: 'flag.x' }],
      { rewards: [{ take: { item: 'item_missing' } }] as unknown as QuestDef['rewards'] },
    );
    const rt = makeReadyRuntime(failing, {
      q_bad: { state: 'ready_to_submit', stage: 's1', objectives: {} },
    });
    try {
      rt.exec([{ quest: { id: 'q_bad', action: 'complete' } }], makeCtx());
      expect.unreachable('奖励失败应当抛出');
    } catch (err) {
      expect((err as EngineError).code).toBe('EFFECT_FAILED');
    }
    expect(rt.state.quests['q_bad']?.state).toBe('ready_to_submit');
    expect(rt.state.player.wallet).toEqual({});
  });
});
