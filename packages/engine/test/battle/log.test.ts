import { describe, expect, it } from 'vitest';
import { projectBattleLog } from '../../src/battle/log.js';
import type { BattleLogEntry } from '../../src/battle/types.js';

/**
 * 战斗日志回看投影（16 号 W5 子任务 9，FR-CMBT-10「逐条战斗日志（可回看）」）。
 *
 * BattleLogEntry 的类型与存储面在 W0（types.ts + session 内部缓冲）已落；
 * 本文件补**回看投影**：按相位分组（UI 回看按阶段折叠展示），组序 = 相位出现
 * 序（非枚举序），组内保持原始条目序。纯函数、确定性（不消耗随机）。
 */

const e = (
  key: string,
  phase: BattleLogEntry['phase'],
  vars?: BattleLogEntry['vars'],
): BattleLogEntry => ({
  key: key as BattleLogEntry['key'],
  ...(vars !== undefined ? { vars } : {}),
  phase,
});

describe('projectBattleLog：按相位分组的回看投影', () => {
  it('组序 = 相位出现序（非枚举序）；组内保持原始条目序', () => {
    const log = [
      e('battle.log.setup', 'setup'),
      e('battle.log.damage', 'resolving', { amount: 5 }),
      e('battle.log.damage', 'resolving', { amount: 3 }),
      e('battle.log.status_expired', 'turn_order'),
      e('battle.log.damage', 'resolving', { amount: 1 }),
      e('battle.log.victory', 'victory'),
    ];
    const view = projectBattleLog(log);
    expect(view.map((group) => group.phase)).toEqual([
      'setup',
      'resolving',
      'turn_order',
      'victory',
    ]);
    expect(view[1]?.entries.map((entry) => entry.vars?.['amount'])).toEqual([5, 3, 1]);
  });

  it('空日志 → 空投影', () => {
    expect(projectBattleLog([])).toEqual([]);
  });

  it('同一相位离散出现 → 合并为一个组（首次出现位置定组序）', () => {
    const log = [e('a', 'resolving'), e('b', 'round_end'), e('c', 'resolving')];
    const view = projectBattleLog(log);
    expect(view.map((group) => group.phase)).toEqual(['resolving', 'round_end']);
    expect(view[0]?.entries).toHaveLength(2);
  });

  it('投影为只读快照：改写返回值不影响入参', () => {
    const log = [e('battle.log.setup', 'setup')] as BattleLogEntry[];
    const view = projectBattleLog(log);
    (view[0]?.entries as unknown as BattleLogEntry[]).length = 0;
    expect(log).toHaveLength(1);
  });
});
