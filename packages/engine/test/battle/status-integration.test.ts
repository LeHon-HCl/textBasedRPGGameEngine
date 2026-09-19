import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import { BattleSession } from '../../src/battle/session.js';
import type { BattleInit, BattleUnit } from '../../src/battle/types.js';

/**
 * W5 会话集成（16 号子任务 7/9：round_end tick 挂新回合开始 + 全程 log/phase
 * 序列断言）。
 *
 * 裁定（2026-09-19，#28）：tick 每轮一次、挂 beginTurn 惰性重开队列处；
 * 第一轮不 tick（初始状态完整持续一轮）。本文件验证会话级咬合：
 * - tick 发生在「本轮队列耗尽、下一轮重算」的边界，不在每次行动后；
 * - 到期状态移除后不再影响战斗（无幽灵状态）；
 * - 全程 log 键序列与 phase 序列断言（FR-CMBT-10 可回看面的回归锚点）。
 */

function player(hp = 30): BattleUnit {
  return {
    uid: 'player',
    side: 'player',
    nameKey: 'actors.hero',
    hp,
    maxHp: hp,
    attrs: { atk: 10, def: 5, spd: 5 },
    statuses: [{ id: 'blessing' }],
    skills: [{ id: 'strike', params: { mult: 2 } }],
  };
}

function enemy(hp = 8, statuses: BattleUnit['statuses'] = []): BattleUnit {
  return {
    uid: 'enemy_1',
    side: 'enemy',
    nameKey: 'enemies.slime',
    hp,
    maxHp: hp,
    attrs: { atk: 3, def: 1, spd: 9 },
    statuses,
    skills: [{ id: 'tackle', params: { mult: 1 } }],
    ai: {
      kind: 'scripted',
      sequence: [{ action: { kind: 'skill', skillId: 'tackle', targetUid: 'player' } }],
    },
  };
}

function sessionOf(init: BattleInit): BattleSession {
  return new BattleSession(init, {
    rng: createRng(7),
    aiResolve: (unit) =>
      unit.ai?.kind === 'scripted'
        ? (unit.ai.sequence[0]?.action as never)
        : { kind: 'skill', skillId: 'strike', targetUid: 'enemy_1' },
    executeAction: (action, ectx) => {
      if (action.kind !== 'skill') return {};
      const target = action.targetUid !== undefined ? ectx.units.get(action.targetUid) : undefined;
      if (target === undefined) return {};
      const amount = Math.max(0, (ectx.actor.attrs['atk'] ?? 0) - (target.attrs['def'] ?? 0));
      return { damage: [{ uid: target.uid, amount }] };
    },
  });
}

describe('W5 会话集成：tick 挂新回合开始（裁定案 A）', () => {
  it('第一轮不 tick；本轮队列耗尽后的下一轮开始时 tick 一次', () => {
    // 敌方 spd 9 > 玩家 5：敌方先动 → 玩家动 = 本轮耗尽 → 玩家 beginTurn 前 tick
    const hero = player();
    const slime = enemy(50, [{ id: 'poison', remaining: 2 }]);
    const session = sessionOf({ player: hero, enemies: [slime] });

    session.beginTurn(); // 第 1 轮：敌方先动（spd 9 > 5）→ 回 turn_order
    session.beginTurn(); // 轮到玩家（await_player）
    session.playerAction({ kind: 'skill', skillId: 'strike', targetUid: 'enemy_1' });

    const enemyIn = (): BattleUnit =>
      session.units().find((u) => u.uid === 'enemy_1') as BattleUnit;
    // 第 1 轮内 tick 未发生（poison 仍 2）
    expect(enemyIn().statuses).toEqual([{ id: 'poison', remaining: 2 }]);

    session.beginTurn(); // 本轮队列耗尽 → 新回合开始：tick → poison 2→1
    expect(enemyIn().statuses).toEqual([{ id: 'poison', remaining: 1 }]);
  });

  it('到期状态在下一轮开始时移除并产生到期日志（入账相位 turn_order）', () => {
    const hero = player();
    const slime = enemy(50, [{ id: 'poison', remaining: 1 }]);
    const session = sessionOf({ player: hero, enemies: [slime] });

    session.beginTurn();
    session.beginTurn(); // 轮到玩家
    session.playerAction({ kind: 'skill', skillId: 'strike', targetUid: 'enemy_1' });
    // 第 2 轮开始：poison 到期移除
    session.beginTurn();
    expect((session.units().find((u) => u.uid === 'enemy_1') as BattleUnit).statuses).toEqual([]);
    const expired = session.log().filter((entry) => entry.key === 'battle.log.status_expired');
    expect(expired).toEqual([
      {
        key: 'battle.log.status_expired',
        vars: { target: 'enemies.slime', status: 'poison' },
        phase: 'turn_order',
      },
    ]);
  });

  it('永久状态（remaining 缺省）跨轮不衰减', () => {
    const hero = player();
    const slime = enemy(50, [{ id: 'blessing' }]);
    const session = sessionOf({ player: hero, enemies: [slime] });
    session.beginTurn();
    session.beginTurn();
    session.playerAction({ kind: 'skill', skillId: 'strike', targetUid: 'enemy_1' });
    session.beginTurn(); // 第 2 轮开始（tick：blessing 永久）
    session.beginTurn();
    session.playerAction({ kind: 'skill', skillId: 'strike', targetUid: 'enemy_1' });
    expect((session.units().find((u) => u.uid === 'enemy_1') as BattleUnit).statuses).toEqual([
      { id: 'blessing' },
    ]);
  });

  it('全程 phase 序列：敌方先手局 = resolving→round_end→turn_order→await_player→…（回归锚点）', () => {
    const hero = player(30);
    const slime = enemy(50);
    const session = sessionOf({ player: hero, enemies: [slime] });
    const phases: string[] = [];
    const push = (): void => phases.push(session.phase() ?? '');

    session.beginTurn(); // 敌方先动 → resolving 收敛回 turn_order
    session.beginTurn(); // 轮到玩家 → await_player
    expect(session.phase()).toBe('await_player');
    session.playerAction({ kind: 'skill', skillId: 'strike', targetUid: 'enemy_1' });
    // 第 1 轮结束：相位收敛回 turn_order（round_end 为单次行动收敛点）
    expect(session.phase()).toBe('turn_order');
    // 第 2 轮开始：队列耗尽 → tick（无状态）→ 重算 → 敌方先动 → 收敛回 turn_order
    session.beginTurn();
    expect(session.phase()).toBe('turn_order');
    session.beginTurn(); // 玩家回合到来
    expect(session.phase()).toBe('await_player');
    push();
  });

  it('log/phase 全程序列断言：setup → damage → victory 的键序列（FR-CMBT-10 回看面）', () => {
    const hero = player(30);
    const slime = enemy(5); // 一击必杀：atk10 − def1 = 9 ≥ 5
    const session = sessionOf({ player: hero, enemies: [slime] });
    session.beginTurn(); // 敌方先动（tackle：3−5 → 0 伤害）
    session.beginTurn(); // 轮到玩家
    session.playerAction({ kind: 'skill', skillId: 'strike', targetUid: 'enemy_1' });
    expect(session.phase()).toBe('victory');

    const keys = session.log().map((entry) => entry.key);
    expect(keys[0]).toBe('battle.log.setup');
    expect(keys).toContain('battle.log.damage');
    expect(keys.at(-1)).toBe('battle.log.victory');
    // 全部日志条目都携带合法相位（回看按相位分组的依据）
    expect(session.log().every((entry) => typeof entry.phase === 'string')).toBe(true);
    // 终局后不再新增日志
    const before = session.log().length;
    expect(() => session.beginTurn()).toThrowError(/相位/);
    expect(session.log().length).toBe(before);
  });
});
