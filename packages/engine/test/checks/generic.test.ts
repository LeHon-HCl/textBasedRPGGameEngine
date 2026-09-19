import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import type { Rng } from '@game/shared';
import { genericRule } from '../../src/checks/generic.js';

/**
 * generic 规则单测（15 号 commit 6，detail-design §5.1）：
 * `roll = rng.int(1,100)`，`success = roll + value ≥ difficultyValue`。
 * 随机面用队列 Rng 桩（与 coc.test.ts 同款，int 只消费一次）。
 */

function queueRng(intResults: number[]): Rng {
  const queue = [...intResults];
  return {
    next: () => {
      throw new Error('generic 规则只应经 int() 投骰');
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
      throw new Error('generic 规则不应调用 pick');
    },
    weighted: () => {
      throw new Error('generic 规则不应调用 weighted');
    },
    chance: () => {
      throw new Error('generic 规则不应调用 chance');
    },
    getState: () => 0,
    setState: () => {},
    fork: () => queueRng(queue),
  } as Rng;
}

describe('generic 规则（15 号 commit 6）', () => {
  it('roll + value ≥ difficultyValue → success / normal', () => {
    // roll 40 + value 35 = 75 ≥ 70
    const result = genericRule.resolve(
      { rule: 'generic', value: 35, difficultyValue: 70 },
      queueRng([40]),
    );
    expect(result.outcome).toBe('success');
    expect(result.level).toBe('normal');
    expect(result.rolls).toEqual([40]);
    expect(result.detail).toMatchObject({ roll: 40, value: 35, difficultyValue: 70, margin: 5 });
  });

  it('roll + value < difficultyValue → fail', () => {
    const result = genericRule.resolve(
      { rule: 'generic', value: 35, difficultyValue: 70 },
      queueRng([30]),
    );
    expect(result.outcome).toBe('fail');
    expect(result.level).toBe('fail');
    expect(result.detail).toMatchObject({ margin: -5 });
  });

  it('恰好等于 difficultyValue → success（≥ 边界）', () => {
    const result = genericRule.resolve(
      { rule: 'generic', value: 50, difficultyValue: 100 },
      queueRng([50]),
    );
    expect(result.outcome).toBe('success');
    expect(result.detail).toMatchObject({ margin: 0 });
  });

  it('difficultyValue 缺失 → EFFECT_FAILED 显性化（不静默按 0 处理）', () => {
    expect(() => genericRule.resolve({ rule: 'generic', value: 50 }, queueRng([1]))).toThrowError(
      EngineError,
    );
  });
});
