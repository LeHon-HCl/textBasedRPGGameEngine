import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '@game/shared';
import type { QuestDef, QuestState } from '@game/shared';
import { newGameState } from '../../src/state/new-game.js';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import { createBuiltinEffectRegistry } from '../../src/effects/index.js';
import { QuestMachine } from '../../src/quests/quest-machine.js';
import { createQuestDeriver } from '../../src/quests/deriver.js';
import { BASE_VERSIONS, makeCtx } from '../effects/fixtures.js';
import { makeDefs, makeHarness, stageQuest } from './fixtures.js';

/**
 * 11 任务 8：表驱动汇总（§4.5 完成定义）。
 *
 * 三维矩阵一次锁定：
 * 1. 接取校验矩阵：状态门 / acceptIf / requires / conflicts 的各组合；
 * 2. 全迁移路径：undiscovered → active →（阶段推进）→ ready_to_submit → done，
 *    经真实 runtime（指令 + 派生器）串联；
 * 3. 奖励原子性：合法奖励结算 vs 含失败项的奖励整批回滚。
 */

const THREE_STAGE: QuestDef = stageQuest(
  'q_chain',
  [
    { id: 's1', objectiveKey: 'quest.chain.s1', completeWhen: 'flag.step1' },
    { id: 's2', objectiveKey: 'quest.chain.s2', completeWhen: 'flag.step2' },
    { id: 's3', objectiveKey: 'quest.chain.s3', completeWhen: 'flag.step3' },
  ],
  { rewards: [{ money: { gold: 5 } }] as unknown as QuestDef['rewards'] },
);

const REFS = new Map<string, ReadonlySet<string>>([
  ['flag.step1', new Set(['q_chain'])],
  ['flag.step2', new Set(['q_chain'])],
  ['flag.step3', new Set(['q_chain'])],
]);

describe('11-8 接取校验矩阵（表驱动）', () => {
  const GUARD: QuestDef = stageQuest(
    'q_guard',
    [{ id: 's1', objectiveKey: 'quest.guard.s1', completeWhen: 'flag.x' }],
    { acceptIf: 'flag.ok', requires: ['q_pre'], conflicts: ['q_rival'] },
  );
  const PRE: QuestDef = stageQuest('q_pre', [
    { id: 'p1', objectiveKey: 'quest.pre.p1', completeWhen: 'flag.p' },
  ]);
  const RIVAL: QuestDef = stageQuest('q_rival', [
    { id: 'r1', objectiveKey: 'quest.rival.r1', completeWhen: 'flag.r' },
  ]);

  interface Case {
    name: string;
    quests: Record<string, QuestState>;
    conditions: Record<string, boolean>;
    outcome: 'active' | string; // 字符串 = 拒绝消息片段
  }

  const cases: readonly Case[] = [
    {
      name: '全条件满足',
      quests: { q_pre: { state: 'done', objectives: {} } },
      conditions: { 'flag.ok': true },
      outcome: 'active',
    },
    {
      name: 'acceptIf 假',
      quests: { q_pre: { state: 'done', objectives: {} } },
      conditions: { 'flag.ok': false },
      outcome: 'acceptIf',
    },
    { name: 'requires 未完成', quests: {}, conditions: { 'flag.ok': true }, outcome: '前置任务' },
    {
      name: 'requires failed',
      quests: { q_pre: { state: 'failed', objectives: {} } },
      conditions: { 'flag.ok': true },
      outcome: '前置任务',
    },
    {
      name: 'conflicts active',
      quests: {
        q_pre: { state: 'done', objectives: {} },
        q_rival: { state: 'active', objectives: {} },
      },
      conditions: { 'flag.ok': true },
      outcome: '互斥',
    },
    {
      name: 'conflicts done 不冲突',
      quests: {
        q_pre: { state: 'done', objectives: {} },
        q_rival: { state: 'done', objectives: {} },
      },
      conditions: { 'flag.ok': true },
      outcome: 'active',
    },
  ];

  for (const entry of cases) {
    it(`${entry.name} → ${entry.outcome}`, () => {
      const machine = new QuestMachine({ defs: makeDefs([GUARD, PRE, RIVAL]) });
      const h = makeHarness({ quests: entry.quests, conditions: entry.conditions });
      if (entry.outcome === 'active') {
        machine.accept(h.ctx, 'q_guard');
        expect(h.state.quests['q_guard']?.state).toBe('active');
      } else {
        try {
          machine.accept(h.ctx, 'q_guard');
          expect.unreachable('应当拒绝');
        } catch (err) {
          expect((err as EngineError).message).toContain(entry.outcome);
        }
      }
    });
  }
});

describe('11-8 全迁移路径（runtime 串联）', () => {
  it('accept → 阶段推进 → ready_to_submit → submit(done + 奖励)', () => {
    const state = newGameState({ versions: BASE_VERSIONS, attrs: { hp: 10 } }, createRng(1));
    const defs = makeDefs([THREE_STAGE]);
    const machine = new QuestMachine({ defs, questRefs: REFS });
    const rt = new GameRuntime({
      state,
      rng: createRng(1),
      effectExecutor: createBuiltinEffectRegistry({ quests: defs }),
      derivers: [createQuestDeriver(machine)],
    });

    const seen: string[] = [];
    rt.on('quest_stage', (event) => seen.push(`${event.from}->${event.to}`));
    rt.on('quest_state_changed', (event) => seen.push(`${event.from}=>${event.to}`));

    rt.exec([{ quest: { id: 'q_chain', action: 'accept' } }], makeCtx());
    expect(rt.state.quests['q_chain']?.stage).toBe('s1');

    rt.exec([{ flag: { name: 'step1' } }], makeCtx());
    expect(rt.state.quests['q_chain']?.stage).toBe('s2');

    rt.exec([{ flag: { name: 'step2' } }], makeCtx());
    expect(rt.state.quests['q_chain']?.stage).toBe('s3');

    rt.exec([{ flag: { name: 'step3' } }], makeCtx());
    expect(rt.state.quests['q_chain']?.state).toBe('ready_to_submit');

    rt.exec([{ quest: { id: 'q_chain', action: 'complete' } }], makeCtx());
    expect(rt.state.quests['q_chain']?.state).toBe('done');
    expect(rt.state.player.wallet['gold']).toBe(5);

    expect(seen).toEqual([
      'undiscovered=>active',
      's1->s2',
      's2->s3',
      'active=>ready_to_submit',
      'ready_to_submit=>done',
    ]);
  });
});

describe('11-8 奖励原子性（表驱动）', () => {
  interface RewardCase {
    name: string;
    rewards: QuestDef['rewards'];
    expectDone: boolean;
  }

  const cases: readonly RewardCase[] = [
    {
      name: '货币奖励成功',
      rewards: [{ money: { gold: 5 } }] as unknown as QuestDef['rewards'],
      expectDone: true,
    },
    {
      name: '物品缺失导致失败',
      rewards: [{ take: { item: 'item_none' } }] as unknown as QuestDef['rewards'],
      expectDone: false,
    },
  ];

  for (const entry of cases) {
    it(`${entry.name} → ${entry.expectDone ? 'done' : '回滚保持 ready_to_submit'}`, () => {
      const def: QuestDef = stageQuest(
        'q_reward',
        [{ id: 's1', objectiveKey: 'quest.reward.s1', completeWhen: 'flag.x' }],
        { rewards: entry.rewards },
      );
      const state = newGameState({ versions: BASE_VERSIONS, attrs: { hp: 10 } }, createRng(1));
      state.quests['q_reward'] = { state: 'ready_to_submit', stage: 's1', objectives: {} };
      const rt = new GameRuntime({
        state,
        rng: createRng(1),
        effectExecutor: createBuiltinEffectRegistry({ quests: makeDefs([def]) }),
      });
      if (entry.expectDone) {
        rt.exec([{ quest: { id: 'q_reward', action: 'complete' } }], makeCtx());
        expect(rt.state.quests['q_reward']?.state).toBe('done');
      } else {
        expect(() =>
          rt.exec([{ quest: { id: 'q_reward', action: 'complete' } }], makeCtx()),
        ).toThrow(EngineError);
        expect(rt.state.quests['q_reward']?.state).toBe('ready_to_submit');
      }
    });
  }
});
