import { describe, expect, it } from 'vitest';
import type { Rng } from '@game/shared';
import { cocRule } from '../../src/checks/coc.js';

/**
 * coc 规则单测（15 号，detail-design §5.1）。
 *
 * 随机面用**队列 Rng 桩**驱动（按顺序消费 int() 结果），使 d100 的十位/个位
 * 分解完全可断言——固定种子跑真实 mulberry32 无法稳定命中等价端点
 * （roll=100 需 (0,0)，概率 1/100）。完整边界矩阵（skill × roll 端点）见
 * matrix.test.ts；本文件随 15 号 commit 增量覆盖各档位语义。
 */

/** 队列 Rng 桩：int(min,max) 依序返回预设值（越界 = 用例没写对，直接抛错暴露） */
function queueRng(intResults: number[]): Rng {
  const queue = [...intResults];
  return {
    next: () => {
      throw new Error('coc 规则只应经 int() 投骰');
    },
    int: (minIncl, maxIncl) => {
      const value = queue.shift();
      if (value === undefined) throw new Error('队列 Rng 已耗尽：用例预设不足');
      if (value < minIncl || value > maxIncl) {
        throw new Error(`预设骰值 ${value} 越界 [${minIncl}, ${maxIncl}]`);
      }
      return value;
    },
    pick: () => {
      throw new Error('coc 规则不应调用 pick');
    },
    weighted: () => {
      throw new Error('coc 规则不应调用 weighted');
    },
    chance: () => {
      throw new Error('coc 规则不应调用 chance');
    },
    getState: () => 0,
    setState: () => {},
    fork: () => queueRng(queue),
  } as Rng;
}

/** 以「十位, 个位」构造一次 d100（00 → 100），并断言 rolls 投影 */
function resolveWith(tens: number, units: number, req: { value: number } & object = { value: 50 }) {
  const result = cocRule.resolve({ rule: 'coc', ...req }, queueRng([tens, units]));
  return result;
}

describe('coc 规则：普通阈值（15 号 commit 1；困难/极难与升格随后续 commit）', () => {
  it('roll ≤ skill → success / normal，detail 含 skill、roll 与余量', () => {
    const result = resolveWith(3, 7, { value: 50 }); // roll 37
    expect(result.outcome).toBe('success');
    expect(result.level).toBe('normal');
    expect(result.rolls).toEqual([37]);
    expect(result.detail).toMatchObject({ skill: 50, roll: 37, margin: 13 });
  });

  it('roll = skill 命中边界 → success', () => {
    const result = resolveWith(5, 0, { value: 50 }); // roll 50
    expect(result.outcome).toBe('success');
    expect(result.level).toBe('normal');
    expect(result.detail).toMatchObject({ margin: 0 });
  });

  it('roll > skill → fail', () => {
    const result = resolveWith(7, 4, { value: 50 }); // roll 74
    expect(result.outcome).toBe('fail');
    expect(result.level).toBe('fail');
    expect(result.detail).toMatchObject({ margin: -24 });
  });

  it('d100 分解：00 记 100（skill 任何 ≤ 99 的值都失败）', () => {
    const result = resolveWith(0, 0, { value: 99 });
    expect(result.rolls).toEqual([100]);
    expect(result.outcome).toBe('fail');
  });

  it('skill = 100 时 roll 100 仍成功（普通阈值不设大失败语义——随 commit 3 落地后复核）', () => {
    const result = resolveWith(0, 0, { value: 100 });
    expect(result.outcome).toBe('success');
  });
});
