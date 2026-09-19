import { describe, expect, it } from 'vitest';
import { EngineError, createRng, type Rng } from '@game/shared';
import { computeTurnOrder } from '../../src/battle/turn-queue.js';
import { validateAction } from '../../src/battle/actions.js';
import { BattleSession } from '../../src/battle/session.js';
import type { BattleUnit } from '../../src/battle/types.js';

/**
 * W1 测试（16 号子任务 2、3）：行动序纯函数 + 玩家行动校验 + 防御语义。
 * 与 session.test.ts 的分工：本文件覆盖**单元面**（纯函数与校验器），
 * 会话集成路径只在防御语义与「非法行动不消耗回合」两处回归。
 */

function unit(uid: string, side: BattleUnit['side'], overrides?: Partial<BattleUnit>): BattleUnit {
  return {
    uid,
    side,
    nameKey: `battle.unit.${uid}`,
    hp: 30,
    maxHp: 30,
    attrs: { spd: 10 },
    statuses: [],
    skills: [{ id: 'slash', params: { mult: 1 } }],
    ...overrides,
  };
}

/** 固定序列 Rng（int 供洗牌；其余抛错暴露越界使用） */
function seqRng(ints: number[]): Rng {
  const queue = [...ints];
  return {
    next: () => {
      throw new Error('not used');
    },
    int: () => {
      const value = queue.shift();
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
      throw new Error('not used');
    },
    getState: () => 0,
    setState: () => {},
    fork: () => seqRng(queue),
  } as Rng;
}

describe('computeTurnOrder（W1 子任务 2：spd 降序 + 平局 Rng）', () => {
  it('spd 降序；无平局不消耗 Rng', () => {
    const order = computeTurnOrder(
      [
        unit('a', 'player', { attrs: { spd: 3 } }),
        unit('b', 'enemy', { attrs: { spd: 9 } }),
        unit('c', 'enemy', { attrs: { spd: 5 } }),
      ],
      seqRng([]),
    );
    expect(order).toEqual(['b', 'c', 'a']);
  });

  it('平局组洗牌：int=0 → 换位（Rng 决定，确定性可复现）', () => {
    const order = computeTurnOrder([unit('a', 'player'), unit('b', 'enemy')], seqRng([0]));
    expect(order).toEqual(['b', 'a']);
  });

  it('多组平局各自洗牌，组间仍按 spd 降序拼接', () => {
    const order = computeTurnOrder(
      [
        unit('lo1', 'player', { attrs: { spd: 1 } }),
        unit('lo2', 'enemy', { attrs: { spd: 1 } }),
        unit('hi1', 'player', { attrs: { spd: 7 } }),
        unit('hi2', 'enemy', { attrs: { spd: 7 } }),
      ],
      seqRng([1, 0]), // hi 组保持原序，lo 组换位
    );
    expect(order).toEqual(['hi1', 'hi2', 'lo2', 'lo1']);
  });

  it('已倒下单位不参与；spd 缺省按 0 垫底', () => {
    const order = computeTurnOrder(
      [
        unit('dead', 'enemy', { hp: 0 }),
        unit('nospeed', 'player', { attrs: {} }),
        unit('fast', 'enemy', { attrs: { spd: 2 } }),
      ],
      seqRng([]),
    );
    expect(order).toEqual(['fast', 'nospeed']);
  });
});

describe('validateAction（W1 子任务 3：合法性在消耗回合之前）', () => {
  const hero = unit('hero', 'player');
  const slime = unit('slime', 'enemy');
  const ally = unit('ally', 'ally');
  const dead = unit('dead', 'enemy', { hp: 0 });

  it('未持有技能 → 拒绝', () => {
    expect(
      validateAction({ kind: 'skill', skillId: 'fireball', targetUid: 'slime' }, hero, [
        hero,
        slime,
      ]),
    ).toMatch(/未持有技能/);
  });

  it('目标不存在 / 已倒下 / 本方一侧 → 拒绝', () => {
    expect(
      validateAction({ kind: 'skill', skillId: 'slash', targetUid: 'ghost' }, hero, [hero, slime]),
    ).toMatch(/不在可攻击侧/);
    expect(
      validateAction({ kind: 'skill', skillId: 'slash', targetUid: 'dead' }, hero, [
        hero,
        slime,
        dead,
      ]),
    ).toMatch(/不在可攻击侧/);
    expect(
      validateAction({ kind: 'skill', skillId: 'slash', targetUid: 'ally' }, hero, [
        hero,
        slime,
        ally,
      ]),
    ).toMatch(/不在可攻击侧/);
  });

  it('敌方视角：玩家/ally 都是对方阵营（可选中）；敌方同侧不可选中', () => {
    const biter = unit('slime', 'enemy', { skills: [{ id: 'bite' }] });
    const mate = unit('mate', 'enemy');
    // 对敌方而言 player/ally 都是对方面——ally 可被选中（语义：ally 在玩家侧）
    expect(
      validateAction({ kind: 'skill', skillId: 'bite', targetUid: 'ally' }, biter, [
        hero,
        biter,
        ally,
      ]),
    ).toBeUndefined();
    expect(
      validateAction({ kind: 'skill', skillId: 'bite', targetUid: 'hero' }, biter, [
        hero,
        biter,
        ally,
      ]),
    ).toBeUndefined();
    // 敌方同侧不可选中
    expect(
      validateAction({ kind: 'skill', skillId: 'bite', targetUid: 'mate' }, biter, [
        hero,
        biter,
        mate,
      ]),
    ).toMatch(/不在可攻击侧/);
  });

  it('item：hasItem 缝持有 → 合法；未持有 → 拒绝；缝缺省 → 拒绝（显性化）', () => {
    const ctx = { hasItem: (id: string) => id === 'bun' };
    expect(
      validateAction({ kind: 'item', itemId: 'bun' }, hero, [hero, slime], ctx),
    ).toBeUndefined();
    expect(validateAction({ kind: 'item', itemId: 'sword' }, hero, [hero, slime], ctx)).toMatch(
      /不持有物品/,
    );
    expect(validateAction({ kind: 'item', itemId: 'bun' }, hero, [hero, slime])).toMatch(
      /未注入物品持有检查缝/,
    );
  });

  it('defend / flee 恒合法；无目标技能（自身增益）合法', () => {
    expect(validateAction({ kind: 'defend' }, hero, [hero, slime])).toBeUndefined();
    expect(validateAction({ kind: 'flee' }, hero, [hero, slime])).toBeUndefined();
    expect(
      validateAction({ kind: 'skill', skillId: 'slash' }, hero, [hero, slime]),
    ).toBeUndefined();
  });
});

describe('defend 语义与非法行动回归（会话集成，W1）', () => {
  function makeSession(enemies: BattleUnit[], player?: BattleUnit): BattleSession {
    return new BattleSession(
      { player: player ?? unit('hero', 'player'), enemies },
      {
        rng: seqRng([1, 1, 1, 1]),
        aiResolve: () => ({ kind: 'defend' }),
        executeAction: () => ({}),
      },
    );
  }

  it('defend 置位 defending，下一轮开始时清除', () => {
    const session = makeSession([unit('slime', 'enemy')]);
    session.beginTurn(); // hero
    session.playerAction({ kind: 'defend' });
    expect(session.units().find((entry) => entry.uid === 'hero')?.defending).toBe(true);
    session.beginTurn(); // slime（敌方桩 defend）→ 本轮耗尽
    session.beginTurn(); // 队列耗尽 → 新一轮（hero）
    // 新一轮开始：上一轮防御态清除
    expect(session.units().find((entry) => entry.uid === 'hero')?.defending).toBe(false);
  });

  it('非法行动（未持有技能）抛 EFFECT_FAILED 且不消耗回合', () => {
    const session = makeSession([unit('slime', 'enemy')]);
    session.beginTurn();
    expect(() => session.playerAction({ kind: 'skill', skillId: 'fireball' })).toThrowError(
      EngineError,
    );
    expect(session.phase()).toBe('await_player'); // 相位未动
    // 合法行动照常进行
    session.playerAction({ kind: 'skill', skillId: 'slash', targetUid: 'slime' });
    expect(session.phase()).toBe('turn_order');
  });

  it('validation 缝：未注入 hasItem 时 item 行动被拒绝', () => {
    const session = makeSession([unit('slime', 'enemy')]);
    session.beginTurn();
    expect(() => session.playerAction({ kind: 'item', itemId: 'warm_bun' })).toThrowError(
      EngineError,
    );
  });

  it('Rng 完整性：真实种子下平局洗牌可复现（DD-09 冒烟）', () => {
    const a = unit('a', 'player');
    const b = unit('b', 'enemy');
    const first = computeTurnOrder([a, b], createRng(2026));
    const second = computeTurnOrder([a, b], createRng(2026));
    expect(first).toEqual(second);
  });
});
