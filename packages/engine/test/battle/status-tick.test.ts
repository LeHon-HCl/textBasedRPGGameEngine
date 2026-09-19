import { describe, expect, it } from 'vitest';
import { tickStatuses } from '../../src/battle/status-tick.js';
import type { BattleUnit, BattleLogEntry } from '../../src/battle/types.js';

/**
 * 战斗内状态 tick（16 号 W5 子任务 7，设计 §5.2「tick 在 round_end」/ FR-STAT-03）。
 *
 * 裁定（2026-09-19，#28）：**tick 挂「新回合开始」**（beginTurn 惰性重开队列处，
 * 每轮一次）——StatusInstance.remaining 按回合递减（FR-STAT-03 回合制时长），
 * 逐行动 tick 会让高速单位双倍速衰减；round_end 相位仍是单次行动收敛点，
 * W5 钩子触发点在新一轮重算处。
 *
 * 语义（复用 shared StatusInstance，FR-STAT-03）：
 * - `remaining` 递减 1/轮；归零 = 到期移除 + 到期日志；
 * - `remaining` 缺省 = 永久（不递减、不过期）；
 * - `stacks` 不因 tick 变化（叠层发生在再施加时，归 W2 应用面）；
 * - 到期顺序与单位/状态声明序一致（确定性，无随机）。
 */

function unit(
  uid: string,
  statuses: BattleUnit['statuses'],
  overrides?: Partial<BattleUnit>,
): BattleUnit {
  return {
    uid,
    side: 'player',
    nameKey: `actors.${uid}`,
    hp: 10,
    maxHp: 10,
    attrs: { spd: 5 },
    statuses,
    skills: [{ id: 'strike' }],
    ...overrides,
  };
}

describe('tickStatuses：新回合开始的状态衰减', () => {
  it('remaining 递减 1/轮（未到期）', () => {
    const u = unit('u1', [{ id: 'poison', remaining: 3 }]);
    tickStatuses([u]);
    expect(u.statuses).toEqual([{ id: 'poison', remaining: 2 }]);
  });

  it('归零 = 到期移除 + 到期日志（i18n 键 + 变量）', () => {
    const u = unit('u1', [{ id: 'poison', remaining: 1 }]);
    const log = tickStatuses([u]);
    expect(u.statuses).toEqual([]);
    expect(log).toEqual([
      {
        key: 'battle.log.status_expired',
        vars: { target: 'actors.u1', status: 'poison' },
        phase: 'turn_order',
      },
    ]);
  });

  it('remaining 缺省 = 永久（不递减、不过期、无日志）', () => {
    const u = unit('u1', [{ id: 'blessing' }]);
    const log = tickStatuses([u]);
    expect(u.statuses).toEqual([{ id: 'blessing' }]);
    expect(log).toEqual([]);
  });

  it('多实例混合：永久保留、到期移除、未到期递减（一次 tick 全处理）', () => {
    const u = unit('u1', [
      { id: 'blessing' },
      { id: 'poison', remaining: 1 },
      { id: 'slow', remaining: 5 },
    ]);
    const log = tickStatuses([u]);
    expect(u.statuses).toEqual([{ id: 'blessing' }, { id: 'slow', remaining: 4 }]);
    expect(log).toHaveLength(1);
    expect(log[0]?.vars).toMatchObject({ status: 'poison' });
  });

  it('多单位按声明序处理（确定性：无随机、顺序稳定）', () => {
    const a = unit('a', [{ id: 'poison', remaining: 1 }]);
    const b = unit('b', [{ id: 'burn', remaining: 1 }]);
    const log = tickStatuses([a, b]);
    expect(log.map((entry) => (entry.vars as { target: string }).target)).toEqual([
      'actors.a',
      'actors.b',
    ]);
  });

  it('stacks 不因 tick 变化（叠层归再施加面，W2）', () => {
    const u = unit('u1', [{ id: 'poison', remaining: 3, stacks: 2 }]);
    tickStatuses([u]);
    expect(u.statuses).toEqual([{ id: 'poison', remaining: 2, stacks: 2 }]);
  });

  it('到期日志的 phase 盖章 = 触发时刻相位（新回合重算前 = turn_order）', () => {
    const u = unit('u1', [{ id: 'poison', remaining: 1 }]);
    const log: readonly BattleLogEntry[] = tickStatuses([u]);
    expect(log.every((entry) => entry.phase === 'turn_order')).toBe(true);
  });

  it('空状态/空单位表 = 无日志（tick 幂等安全）', () => {
    expect(tickStatuses([unit('u1', [])])).toEqual([]);
    expect(tickStatuses([])).toEqual([]);
  });
});
