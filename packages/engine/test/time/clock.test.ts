import { describe, expect, it } from 'vitest';
import { advanceClock, weekdayIndex } from '../../src/time/clock.js';
import type { TimeConfig } from '@game/shared';

/**
 * 09 任务 2：Clock 推进纯函数（§4.3 步骤 1）。
 *
 * 递进口径：slot → day → week → month；跨边界旗标供管线钩子门控
 * （before_rollover / day_rollover 只在跨天时挂载）。月历可循环（无年概念，
 * Clock 无 year 字段——月序取循环内下标，跨月判定用绝对月计数）。
 */

/** 设计 §4.3 独立测试基线：4 时段 × 7 天 × 2 月（30+30） */
function makeConfig(overrides?: Partial<TimeConfig>): TimeConfig {
  return {
    slots: [
      { id: 'slot_morning', nameKey: 'time.slot.morning' },
      { id: 'slot_noon', nameKey: 'time.slot.noon' },
      { id: 'slot_evening', nameKey: 'time.slot.evening' },
      { id: 'slot_night', nameKey: 'time.slot.night' },
    ],
    weekdays: Array.from({ length: 7 }, (_, i) => ({ nameKey: `time.weekday.${i + 1}` })),
    startWeekday: 1,
    months: [
      { length: 30, nameKey: 'time.month.spring' },
      { length: 30, nameKey: 'time.month.summer' },
    ],
    ...overrides,
  };
}

describe('09-2 advanceClock：slot → day 递进', () => {
  it('时段内推进：day/week/month 不变，仅 slotIndex 前移', () => {
    const result = advanceClock(
      { day: 3, slotIndex: 0, week: 0, month: 0 },
      makeConfig(),
      2,
    );
    expect(result.clock).toEqual({ day: 3, slotIndex: 2, week: 0, month: 0 });
    expect(result.crossedDay).toBe(false);
    expect(result.crossedWeek).toBe(false);
    expect(result.crossedMonth).toBe(false);
  });

  it('跨天：slotIndex 回绕，day+1，crossedDay=true', () => {
    const result = advanceClock({ day: 5, slotIndex: 3 }, makeConfig(), 1);
    expect(result.clock).toEqual({ day: 6, slotIndex: 0, week: 0, month: 0 });
    expect(result.crossedDay).toBe(true);
    expect(result.crossedWeek).toBe(false);
  });

  it('一次推进跨多天：+9 时段 = 2 天 + 1 时段', () => {
    const result = advanceClock({ day: 1, slotIndex: 0 }, makeConfig(), 9);
    expect(result.clock).toEqual({ day: 3, slotIndex: 1, week: 0, month: 0 });
    expect(result.crossedDay).toBe(true);
  });

  it('slots=0：原样返回（不产生任何跨边界）', () => {
    const clock = { day: 7, slotIndex: 2, week: 0, month: 0 };
    const result = advanceClock(clock, makeConfig(), 0);
    expect(result.clock).toEqual(clock);
    expect(result.crossedDay).toBe(false);
  });

  it('入参 Clock 不被变异（纯函数）', () => {
    const clock = { day: 1, slotIndex: 3 };
    advanceClock(clock, makeConfig(), 1);
    expect(clock).toEqual({ day: 1, slotIndex: 3 });
  });
});

describe('09-2 advanceClock：跨周边界（startWeekday 校准）', () => {
  it('startWeekday=1：day 7→8 跨周，week 0→1', () => {
    const result = advanceClock({ day: 7, slotIndex: 3 }, makeConfig(), 1);
    expect(result.clock.day).toBe(8);
    expect(result.clock.week).toBe(1);
    expect(result.crossedWeek).toBe(true);
  });

  it('startWeekday=3（第 1 天是星期三）：day 5→6 即跨周', () => {
    const result = advanceClock({ day: 5, slotIndex: 3 }, makeConfig({ startWeekday: 3 }), 1);
    expect(result.clock.day).toBe(6);
    expect(result.clock.week).toBe(1);
    expect(result.crossedWeek).toBe(true);
  });

  it('周内推进不跨周', () => {
    const result = advanceClock({ day: 2, slotIndex: 0 }, makeConfig(), 4);
    expect(result.clock.week).toBe(0);
    expect(result.crossedWeek).toBe(false);
  });
});

describe('09-2 advanceClock：跨月边界（不等长月 + 循环）', () => {
  it('day 30→31：month 0→1，crossedMonth=true', () => {
    const result = advanceClock({ day: 30, slotIndex: 3 }, makeConfig(), 1);
    expect(result.clock.day).toBe(31);
    expect(result.clock.month).toBe(1);
    expect(result.crossedMonth).toBe(true);
  });

  it('day 60→61：循环回 month 0（绝对月计数判定跨月）', () => {
    const result = advanceClock({ day: 60, slotIndex: 3 }, makeConfig(), 1);
    expect(result.clock.day).toBe(61);
    expect(result.clock.month).toBe(0);
    expect(result.crossedMonth).toBe(true);
  });

  it('未启用月历时 month 保持 undefined、不判跨月', () => {
    const { months: _omitted, ...noMonths } = makeConfig();
    const result = advanceClock({ day: 29, slotIndex: 3 }, noMonths, 1);
    expect(result.clock.month).toBeUndefined();
    expect(result.crossedMonth).toBe(false);
  });
});

describe('09-2 weekdayIndex：星期序投影（1 起，startWeekday 校准）', () => {
  it('startWeekday=1：day 1→星期 1，day 8→星期 1', () => {
    expect(weekdayIndex(1, makeConfig())).toBe(1);
    expect(weekdayIndex(8, makeConfig())).toBe(1);
    expect(weekdayIndex(7, makeConfig())).toBe(7);
  });

  it('startWeekday=3：day 1→星期 3，day 5→星期 7，day 6→星期 1', () => {
    const config = makeConfig({ startWeekday: 3 });
    expect(weekdayIndex(1, config)).toBe(3);
    expect(weekdayIndex(5, config)).toBe(7);
    expect(weekdayIndex(6, config)).toBe(1);
  });
});
