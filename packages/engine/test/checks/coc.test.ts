import { describe, expect, it } from 'vitest';
import type { Rng } from '@game/shared';
import type { CheckRequest } from '../../src/effects/index.js';
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
function resolveWith(
  tens: number,
  units: number,
  req: Partial<Omit<CheckRequest, 'rule'>> & { value: number },
) {
  const result = cocRule.resolve({ rule: 'coc', ...req }, queueRng([tens, units]));
  return result;
}

describe('coc 规则：普通阈值（15 号 commit 1）', () => {
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

  it('skill = 100 时 roll 100 触发大失败（commit 3 升格语义后复核：成败 fail）', () => {
    const result = resolveWith(0, 0, { value: 100 });
    expect(result.outcome).toBe('fail');
    expect(result.level).toBe('fumble');
  });
});

describe('coc 规则：大成功与大失败（15 号 commit 3）', () => {
  it('roll ≤ max(1, ⌊skill/5⌋) → critical，普通难度下成败 success', () => {
    const result = resolveWith(1, 0, { value: 50 }); // roll 10 = ⌊50/5⌋
    expect(result.level).toBe('critical');
    expect(result.outcome).toBe('success');
    expect(result.detail).toMatchObject({ thresholds: { critical: 10 } });
  });

  it('roll = ⌊skill/5⌋ + 1 → 降为 hard（§5.1 表格下 extreme 线与大成功线重合，extreme 等级被 critical 吸收）', () => {
    const result = resolveWith(1, 1, { value: 50 }); // roll 11 > 10
    expect(result.level).toBe('hard');
  });

  it('skill < 5：大成功阈值保底 1（roll = 1 仍可大成功）', () => {
    const result = resolveWith(0, 1, { value: 4 }); // roll 1
    expect(result.level).toBe('critical');
    expect(result.outcome).toBe('success');
  });

  it('大成功无视请求难度档：请求 extreme 时 roll ≤ 大成功线仍 success', () => {
    const result = resolveWith(1, 0, { value: 50, difficulty: 'extreme' }); // roll 10
    expect(result.outcome).toBe('success');
    expect(result.level).toBe('critical');
  });

  it('大失败：roll = 100（skill ≥ 50 亦然）', () => {
    const result = resolveWith(0, 0, { value: 50 });
    expect(result.level).toBe('fumble');
    expect(result.outcome).toBe('fail');
  });

  it('大失败：skill < 50 且 roll ≥ 96', () => {
    const result = resolveWith(9, 6, { value: 49 }); // roll 96
    expect(result.level).toBe('fumble');
  });

  it('skill ≥ 50 时 roll 96–99 只是 fail，不是大失败', () => {
    const result = resolveWith(9, 6, { value: 50 }); // roll 96
    expect(result.level).toBe('fail');
    expect(result.outcome).toBe('fail');
  });

  it('skill < 50 时 roll = 95 不触发大失败（≥ 96 才算）', () => {
    const result = resolveWith(9, 5, { value: 49 }); // roll 95
    expect(result.level).toBe('fail');
  });
});

describe('coc 规则：困难/极难阈值（15 号 commit 2，floor 除法）', () => {
  it('请求 hard：roll ≤ ⌊skill/2⌋ → success / hard', () => {
    // skill 50 → hard 25：roll 25 恰好压线（> extreme 10，故等级是 hard）
    const result = resolveWith(2, 5, { value: 50, difficulty: 'hard' });
    expect(result.outcome).toBe('success');
    expect(result.level).toBe('hard');
    expect(result.detail).toMatchObject({ required: 25, margin: 0 });
  });

  it('请求 hard 但 roll 落进大成功区间：成败 success、等级报 critical（commit 3 升格后复核）', () => {
    const result = resolveWith(1, 0, { value: 50, difficulty: 'hard' }); // roll 10
    expect(result.outcome).toBe('success');
    expect(result.level).toBe('critical');
  });

  it('请求 hard：roll 越过 ⌊skill/2⌋ 但 ≤ skill → 成败为 fail、等级仍 normal', () => {
    const result = resolveWith(3, 0, { value: 50, difficulty: 'hard' }); // roll 30
    expect(result.outcome).toBe('fail');
    expect(result.level).toBe('normal');
    expect(result.detail).toMatchObject({ margin: -5 });
  });

  it('请求 extreme：roll ≤ ⌊skill/5⌋ → success（等级为 critical，见 commit 3 复核）', () => {
    const result = resolveWith(1, 0, { value: 50, difficulty: 'extreme' }); // roll 10
    expect(result.outcome).toBe('success');
    expect(result.level).toBe('critical');
    expect(result.detail).toMatchObject({ required: 10 });
  });

  it('请求 extreme：roll = ⌊skill/5⌋ + 1 → fail', () => {
    const result = resolveWith(1, 1, { value: 50, difficulty: 'extreme' }); // roll 11
    expect(result.outcome).toBe('fail');
  });

  it('floor 除法：skill 49 → hard 24 / extreme 9', () => {
    const hard = resolveWith(2, 4, { value: 49, difficulty: 'hard' }); // roll 24 压线
    expect(hard.outcome).toBe('success');
    const hardMiss = resolveWith(2, 5, { value: 49, difficulty: 'hard' }); // roll 25
    expect(hardMiss.outcome).toBe('fail');
    const extreme = resolveWith(0, 9, { value: 49, difficulty: 'extreme' }); // roll 9 压线
    expect(extreme.outcome).toBe('success');
    const extremeMiss = resolveWith(1, 0, { value: 49, difficulty: 'extreme' }); // roll 10
    expect(extremeMiss.outcome).toBe('fail');
  });

  it('skill < 5：extreme 阈值 floor 到 0，但大成功保底线 1 仍生效（commit 3 复核）；困难照常', () => {
    const extreme = resolveWith(0, 1, { value: 4, difficulty: 'extreme' }); // roll 1 → 大成功
    expect(extreme.outcome).toBe('success');
    expect(extreme.level).toBe('critical');
    const extremeMiss = resolveWith(0, 2, { value: 4, difficulty: 'extreme' }); // roll 2
    expect(extremeMiss.outcome).toBe('fail');
    const hard = resolveWith(0, 2, { value: 4, difficulty: 'hard' }); // roll 2 ≤ 2
    expect(hard.outcome).toBe('success');
    expect(hard.level).toBe('hard');
  });

  it('缺省难度 = normal（roll ≤ skill）', () => {
    const result = resolveWith(4, 0, { value: 40 }); // roll 40
    expect(result.outcome).toBe('success');
    expect(result.detail).toMatchObject({ difficulty: 'normal' });
  });
});
