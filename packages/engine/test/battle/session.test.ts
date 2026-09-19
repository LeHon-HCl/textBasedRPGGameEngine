import { describe, expect, it } from 'vitest';
import { EngineError, type Rng } from '@game/shared';
import { BattleSession, type ActionOutcome } from '../../src/battle/session.js';
import type { BattleUnit, PlayerAction } from '../../src/battle/types.js';

/**
 * W0 骨架测试（16 号子任务 1，detail-design §5.2 状态机图全路径）：
 * 八相位**全路径迁移**断言 + 行动序平局 Rng + 相位违例显性化。
 * 会话级测试——不依赖叙事模块（DD-11）；结算/AI 用桩（真实实现归 W2/W4）。
 */

function unit(uid: string, side: BattleUnit['side'], overrides?: Partial<BattleUnit>): BattleUnit {
  return {
    uid,
    side,
    nameKey: `battle.unit.${uid}`,
    hp: 30,
    maxHp: 30,
    attrs: { spd: 10, atk: 5, def: 2 },
    statuses: [],
    skills: [{ id: 'slash', params: { mult: 1 } }],
    ...overrides,
  };
}

/** 队列 Rng 桩：int 供平局洗牌、chance 供逃跑判定，逐次消费预设 */
function queueRng(ints: number[] = [], chances: boolean[] = []): Rng {
  const intQueue = [...ints];
  const chanceQueue = [...chances];
  return {
    next: () => {
      throw new Error('not used');
    },
    int: () => {
      const value = intQueue.shift();
      if (value === undefined) throw new Error('int queue exhausted');
      return value;
    },
    pick: () => {
      throw new Error('not used');
    },
    weighted: () => {
      throw new Error('not used');
    },
    chance: () => {
      const value = chanceQueue.shift();
      if (value === undefined) throw new Error('chance queue exhausted');
      return value;
    },
    getState: () => 0,
    setState: () => {},
    fork: () => queueRng(intQueue, chanceQueue),
  } as Rng;
}

/** 结算桩：按预设脚本返回伤害与日志（真实管线归 W2） */
function stubExecutor(script: ActionOutcome[] = []) {
  const calls: { action: PlayerAction | { kind: 'skill'; skillId: string }; actorUid: string }[] =
    [];
  return {
    calls,
    execute: (action: PlayerAction, actor: BattleUnit): ActionOutcome => {
      calls.push({ action, actorUid: actor.uid });
      return script.shift() ?? {};
    },
  };
}

interface Setup {
  session: BattleSession;
  executor: ReturnType<typeof stubExecutor>;
}

/** 缺省夹具：hero/slime 同速（int=1 → 洗牌保持原序），脚本可选 */
function makeSession(init?: {
  enemies?: BattleUnit[];
  player?: BattleUnit;
  escapeRate?: number;
  rng?: Rng;
  script?: ActionOutcome[];
}): Setup {
  const executor = stubExecutor(init?.script);
  const session = new BattleSession(
    {
      player: init?.player ?? unit('hero', 'player'),
      enemies: init?.enemies ?? [unit('slime', 'enemy')],
      ...(init?.escapeRate !== undefined ? { escapeRate: init.escapeRate } : {}),
    },
    {
      rng: init?.rng ?? queueRng([1, 1, 1, 1]),
      aiResolve: (enemy) => ({ kind: 'skill', skillId: enemy.skills[0]?.id ?? 'bite' }),
      executeAction: executor.execute,
    },
  );
  return { session, executor };
}

describe('BattleSession 八相位状态机（W0，§5.2 状态机图全路径）', () => {
  it('构造：setup → turn_order（开场日志落在 setup 相位，行动序就绪）', () => {
    const { session } = makeSession();
    expect(session.phase()).toBe('turn_order');
    expect(session.result()).toBeNull();
    expect(session.log()[0]).toMatchObject({ key: 'battle.log.setup', phase: 'setup' });
    expect(session.turnQueue()).toEqual(['hero', 'slime']);
  });

  it('正常交换路径：turn_order → await_player → resolving → round_end → turn_order', () => {
    const { session, executor } = makeSession({
      script: [{ damage: [{ uid: 'slime', amount: 5 }] }],
    });
    const turn = session.beginTurn();
    expect(turn).toEqual({ phase: 'await_player', actorUid: 'hero' });
    expect(session.phase()).toBe('await_player');

    session.playerAction({ kind: 'skill', skillId: 'slash', targetUid: 'slime' });
    // 结算后回到 turn_order，敌方行动入队
    expect(session.phase()).toBe('turn_order');
    expect(session.turnQueue()).toEqual(['slime']);
    expect(executor.calls).toEqual([
      { action: { kind: 'skill', skillId: 'slash', targetUid: 'slime' }, actorUid: 'hero' },
    ]);
    // 敌方回合：turn_order → resolving（AI 桩）→ round_end → turn_order
    const enemyTurn = session.beginTurn();
    expect(enemyTurn).toEqual({ phase: 'resolving', actorUid: 'slime' });
    expect(session.phase()).toBe('turn_order');
    expect(session.turnQueue()).toEqual([]);
  });

  it('victory 路径：玩家击杀全部敌方 → round_end → victory（result 落定）', () => {
    const { session } = makeSession({
      enemies: [unit('slime', 'enemy'), unit('bat', 'enemy', { hp: 1, maxHp: 1 })],
      script: [
        {
          damage: [
            { uid: 'slime', amount: 30 },
            { uid: 'bat', amount: 1 },
          ],
        },
      ],
    });
    session.beginTurn();
    session.playerAction({ kind: 'skill', skillId: 'slash' });
    expect(session.phase()).toBe('victory');
    expect(session.result()).toEqual({ outcome: 'victory' });
    expect(session.log()).toContainEqual(
      expect.objectContaining({ key: 'battle.log.down', phase: 'resolving' }),
    );
  });

  it('defeat 路径：敌方 AI 先手击杀玩家 → resolving → round_end → defeat', () => {
    const executor = stubExecutor([{ damage: [{ uid: 'hero', amount: 30 }] }]);
    const session = new BattleSession(
      {
        player: unit('hero', 'player', { attrs: { spd: 1 } }),
        enemies: [unit('slime', 'enemy')],
      },
      {
        rng: queueRng([], []),
        aiResolve: () => ({ kind: 'skill', skillId: 'bite' }),
        executeAction: executor.execute,
      },
    );
    expect(session.turnQueue()).toEqual(['slime', 'hero']);
    session.beginTurn(); // 敌方先手（spd 高）
    expect(session.phase()).toBe('defeat');
    expect(session.result()).toEqual({ outcome: 'defeat' });
  });

  it('escaped 路径：flee 成功（chance true）→ round_end → escaped', () => {
    const { session } = makeSession({ rng: queueRng([1], [true]) });
    session.beginTurn();
    session.playerAction({ kind: 'flee' });
    expect(session.phase()).toBe('escaped');
    expect(session.result()).toEqual({ outcome: 'escaped' });
  });

  it('flee 失败（chance false）消耗回合：round_end → turn_order，不终局', () => {
    const { session } = makeSession({ rng: queueRng([1], [false]) });
    session.beginTurn();
    session.playerAction({ kind: 'flee' });
    expect(session.phase()).toBe('turn_order');
    expect(session.result()).toBeNull();
    expect(session.log()).toContainEqual(
      expect.objectContaining({ key: 'battle.log.escape_fail' }),
    );
  });

  it('回合中倒下者跳过行动：队列剩余条目剔除死亡单位', () => {
    const { session } = makeSession({
      enemies: [unit('slime', 'enemy', { attrs: { spd: 20 } }), unit('bat', 'enemy')],
      // 回合序：slime（spd 20）先动（桩不出伤害）→ hero → 击杀 bat（spd 10 同组，int=0 保持 hero 在前）
      script: [{}, { damage: [{ uid: 'bat', amount: 30 }] }],
    });
    session.beginTurn(); // slime
    expect(session.phase()).toBe('turn_order');
    expect(session.turnQueue()).toEqual(['hero', 'bat']);
    const heroTurn = session.beginTurn(); // hero（同速组 int=1 保持原序）
    expect(heroTurn).toEqual({ phase: 'await_player', actorUid: 'hero' });
    session.playerAction({ kind: 'skill', skillId: 'slash' });
    // bat 已倒下：本回合队列清空，不残留死者条目
    expect(session.turnQueue()).toEqual([]);
    expect(session.phase()).toBe('turn_order');
  });

  it('行动序 spd 降序；平局组经 Rng 洗牌（确定性可复现）', () => {
    const a = unit('a', 'player', { attrs: { spd: 10 } });
    const b = unit('b', 'enemy', { attrs: { spd: 10 } });
    const c = unit('c', 'enemy', { attrs: { spd: 5 } });
    // int(0,1) = 0 → 平局组 [a, b] 换位为 [b, a]（int=1 才保持原序）
    const executor = stubExecutor();
    const session = new BattleSession(
      { player: a, enemies: [b, c] },
      {
        rng: queueRng([0]),
        aiResolve: () => ({ kind: 'defend' }),
        executeAction: executor.execute,
      },
    );
    expect(session.turnQueue()).toEqual(['b', 'a', 'c']);
  });

  it('相位违例显性化：await_player 外调 playerAction → EFFECT_FAILED', () => {
    const { session } = makeSession();
    expect(() => session.playerAction({ kind: 'defend' })).toThrowError(EngineError);
  });

  it('escapeRate 越界 → 构造期 EFFECT_FAILED', () => {
    expect(() => makeSession({ escapeRate: 1.5 })).toThrowError(EngineError);
    expect(() => makeSession({ escapeRate: -0.1 })).toThrowError(EngineError);
  });
});
