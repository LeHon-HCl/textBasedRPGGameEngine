import { describe, expect, it } from 'vitest';
import type { FavorDef } from '@game/shared';
import { applyFavorChange } from '../../src/npcs/favor.js';
import { clamp, thresholdFor } from '../../src/npcs/thresholds.js';

/**
 * 12 任务 3：好感阶段机制（§4.6「clamp → 阈值表二分 → FavorStageChanged」）。
 *
 * 纯函数层表驱动：clamp 边界、阈值精确落点、乱序阈值表、阶段回退与缺席语义；
 * 事件发射由指令层（relations.ts）按 changed 判定，本层只算机械结果。
 */

/** raven 式三段阈值（故意乱序声明，验证内部排序二分） */
const FAVOR: FavorDef = {
  min: -100,
  max: 100,
  stages: [
    { id: 'bonded', at: 70, nameKey: 'n.stage.bonded' },
    { id: 'stranger', at: -100, nameKey: 'n.stage.stranger' },
    { id: 'friendly', at: 30, nameKey: 'n.stage.friendly' },
  ],
};

describe('12-3 thresholdFor：阈值表二分（不依赖声明序）', () => {
  it.each([
    [-100, 'stranger'],
    [-99, 'stranger'],
    [29, 'stranger'],
    [30, 'friendly'],
    [69, 'friendly'],
    [70, 'bonded'],
    [100, 'bonded'],
  ] as const)('value=%s → %s（at ≤ value 的最后一档）', (value, expected) => {
    expect(thresholdFor(FAVOR.stages, value)?.id).toBe(expected);
  });

  it('低于全部阈值 → undefined；空表 → undefined', () => {
    expect(thresholdFor(FAVOR.stages, -101)).toBeUndefined();
    expect(thresholdFor([], 0)).toBeUndefined();
  });

  it('输入数组不被排序副作用污染', () => {
    const copy = [...FAVOR.stages];
    thresholdFor(FAVOR.stages, 0);
    expect(FAVOR.stages).toEqual(copy);
  });
});

describe('12-3 applyFavorChange：clamp → 阶段切换', () => {
  it.each([
    { current: 0, amount: 500, favor: 100, stage: 'bonded' },
    { current: 0, amount: -500, favor: -100, stage: 'stranger' },
    { current: 10, amount: 20, favor: 30, stage: 'friendly' },
    { current: 30, amount: -1, favor: 29, stage: 'stranger' },
    { current: 70, amount: -40, favor: 30, stage: 'friendly' },
  ])(
    'current=$current amount=$amount → favor=$favor stage=$stage',
    ({ current, amount, favor, stage }) => {
      const change = applyFavorChange(FAVOR, { favor: current, stage: 'stranger' }, amount);
      expect(change.favor).toBe(favor);
      expect(change.stage).toBe(stage);
    },
  );

  it('阶段切换标记 changed 与 from/to（供事件发射）', () => {
    const up = applyFavorChange(FAVOR, { favor: 0, stage: 'stranger' }, 30);
    expect(up).toMatchObject({ from: 'stranger', to: 'friendly', changed: true });
    const stay = applyFavorChange(FAVOR, { favor: 30, stage: 'friendly' }, 1);
    expect(stay).toMatchObject({ from: 'friendly', to: 'friendly', changed: false });
    const down = applyFavorChange(FAVOR, { favor: 30, stage: 'friendly' }, -40);
    expect(down).toMatchObject({ from: 'friendly', to: 'stranger', changed: true });
  });

  it('无好感定义：不 clamp、不改阶段（仅数值增减）', () => {
    const change = applyFavorChange(undefined, { favor: 5, stage: 'legacy' }, 9999);
    expect(change).toMatchObject({ favor: 10004, stage: 'legacy', changed: false });
  });

  it('有空区间但无阶段表：clamp 生效、阶段保持', () => {
    const change = applyFavorChange({ min: 0, max: 10, stages: [] }, { favor: 5 }, 100);
    expect(change).toMatchObject({ favor: 10, stage: undefined, changed: false });
  });

  it('跌出全部阶段：to=undefined 且 changed=true（若原持阶段）', () => {
    const def: FavorDef = { min: -10, max: 10, stages: [{ id: 'warm', at: 5, nameKey: 'n.warm' }] };
    const change = applyFavorChange(def, { favor: 5, stage: 'warm' }, -10);
    expect(change).toMatchObject({
      favor: -5,
      stage: undefined,
      from: 'warm',
      to: undefined,
      changed: true,
    });
  });
});

describe('12-3 clamp：边界收敛（与内置函数同口径）', () => {
  it.each([
    [150, -100, 100, 100],
    [-150, -100, 100, -100],
    [3, -100, 100, 3],
    [0, 0, 0, 0],
  ] as const)('clamp(%s, %s, %s) = %s', (value, min, max, expected) => {
    expect(clamp(value, min, max)).toBe(expected);
  });
});
