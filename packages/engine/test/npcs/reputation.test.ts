import { describe, expect, it } from 'vitest';
import type { FactionThreshold } from '@game/shared';
import { applyReputationChange } from '../../src/npcs/reputation.js';

/**
 * 12 任务 6：阵营声誉波段机制（§4.6；FR-NPCR-04）。
 *
 * 纯函数：clamp（全局 reputationBounds）→ 波段阈值二分 → from/to/changed
 * 供指令层决定 emit `reputation_band_changed`；无阈值表 / 空表不产事件。
 */

/** town 式三段波段（乱序声明验证内部排序） */
const THRESHOLDS: readonly FactionThreshold[] = [
  { id: 'honored', at: 50, nameKey: 'f.honored' },
  { id: 'hostile', at: -50, nameKey: 'f.hostile' },
  { id: 'neutral', at: 0, nameKey: 'f.neutral' },
];

describe('12-6 applyReputationChange：波段切换矩阵', () => {
  it.each([
    { current: 0, amount: 60, value: 60, from: 'neutral', to: 'honored', changed: true },
    { current: -40, amount: 10, value: -30, from: 'hostile', to: 'hostile', changed: false },
    { current: -60, amount: 60, value: 0, from: undefined, to: 'neutral', changed: true },
    { current: 60, amount: -200, value: -140, from: 'honored', to: undefined, changed: true },
    { current: 40, amount: 10, value: 50, from: 'neutral', to: 'honored', changed: true },
  ])(
    'current=$current amount=$amount → value=$value $from→$to（changed=$changed）',
    ({ current, amount, value, from, to, changed }) => {
      expect(applyReputationChange(THRESHOLDS, undefined, current, amount)).toEqual({
        value,
        from,
        to,
        changed,
      });
    },
  );

  it('低于全部阈值起算：from=undefined，进入首档即 changed', () => {
    expect(applyReputationChange(THRESHOLDS, undefined, -80, 40)).toEqual({
      value: -40,
      from: undefined,
      to: 'hostile',
      changed: true,
    });
  });

  it('注入 bounds 时 clamp 生效（FactionDef 无 min/max）', () => {
    expect(applyReputationChange(THRESHOLDS, { min: -100, max: 100 }, 90, 500)).toMatchObject({
      value: 100,
      to: 'honored',
      changed: false,
    });
    expect(applyReputationChange(THRESHOLDS, { min: -100, max: 100 }, 90, -500)).toMatchObject({
      value: -100,
      to: undefined,
      changed: true,
    });
  });

  it('无阈值表：只改数值，from/to 均 undefined 且不产事件', () => {
    expect(applyReputationChange(undefined, undefined, 10, 5)).toEqual({
      value: 15,
      from: undefined,
      to: undefined,
      changed: false,
    });
  });

  it('空阈值表：数值照改，不产事件', () => {
    expect(applyReputationChange([], undefined, 0, 100)).toEqual({
      value: 100,
      from: undefined,
      to: undefined,
      changed: false,
    });
  });
});
