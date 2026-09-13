import { describe, expect, it } from 'vitest';
import type { TimeConfig } from '@game/shared';
import { createTimeViewProvider, projectCalendar } from '../../src/time/calendar.js';
import { defaultTimeView } from '../../src/state/index.js';

/**
 * 09 任务 7：日历 UI 投影纯函数（FR-TIME-05，§4.3「Clock + TimeConfig 投影，
 * 无状态」）+ TimeViewProvider 的 TimeConfig 校准注入。
 */

function makeConfig(withMonths = true): TimeConfig {
  const config: TimeConfig = {
    slots: [
      { id: 'slot_morning', nameKey: 'time.slot.morning' },
      { id: 'slot_noon', nameKey: 'time.slot.noon' },
      { id: 'slot_evening', nameKey: 'time.slot.evening' },
      { id: 'slot_night', nameKey: 'time.slot.night' },
    ],
    weekdays: Array.from({ length: 7 }, (_, i) => ({ nameKey: `time.weekday.${i + 1}` })),
    startWeekday: 1,
  };
  if (withMonths) {
    config.months = [
      { length: 30, nameKey: 'time.month.spring' },
      { length: 30, nameKey: 'time.month.summer' },
    ];
  }
  return config;
}

describe('09-7 projectCalendar：今日/星期/时段视图', () => {
  it('第 2 周第 3 天早晨：day/week/星期/时段全量投影', () => {
    const view = projectCalendar({ day: 10, slotIndex: 0, week: 1 }, makeConfig());
    expect(view).toEqual({
      day: 10,
      week: 1,
      weekdayIndex: 3,
      weekdayNameKey: 'time.weekday.3',
      slotId: 'slot_morning',
      slotNameKey: 'time.slot.morning',
      month: { index: 0, nameKey: 'time.month.spring', day: 10 },
    });
  });

  it('启用月历：跨月后的月内日序（day 31 = 第二月 1 号）', () => {
    const view = projectCalendar({ day: 31, slotIndex: 2, week: 4, month: 1 }, makeConfig());
    expect(view.month).toEqual({ index: 1, nameKey: 'time.month.summer', day: 1 });
    expect(view.weekdayIndex).toBe(3); // 31 % 7 = 3
  });

  it('未启用月历：month 缺省（纯时段制日历）', () => {
    const view = projectCalendar({ day: 5, slotIndex: 3, week: 0 }, makeConfig(false));
    expect(view.month).toBeUndefined();
    expect(view.slotNameKey).toBe('time.slot.night');
  });

  it('纯函数：入参 Clock 不被变异', () => {
    const clock = { day: 3, slotIndex: 1, week: 0, month: 0 };
    projectCalendar(clock, makeConfig());
    expect(clock).toEqual({ day: 3, slotIndex: 1, week: 0, month: 0 });
  });
});

describe('09-7 createTimeViewProvider：TimeConfig 校准注入', () => {
  it('weekday = 星期序字符串、slot = 时段 id（表达式 time.slot == "slot_noon" 可比较）', () => {
    const provider = createTimeViewProvider(makeConfig());
    expect(provider({ day: 9, slotIndex: 1, week: 1, month: 0 })).toEqual({
      day: 9,
      weekday: '2',
      slot: 'slot_noon',
    });
  });

  it('startWeekday 校准星期序（第 1 天 = 星期 3）', () => {
    const provider = createTimeViewProvider(makeConfigWithStartWeekday3());
    expect(provider({ day: 1, slotIndex: 0 })).toEqual({ day: 1, weekday: '3', slot: 'slot_morning' });
  });

  it('与缺省投影对照：缺省 slot 为数值串，校准后为时段 id（注入覆盖的价值）', () => {
    const clock = { day: 1, slotIndex: 1 };
    expect(defaultTimeView(clock).slot).toBe('1');
    expect(createTimeViewProvider(makeConfig())(clock).slot).toBe('slot_noon');
  });
});

function makeConfigWithStartWeekday3(): TimeConfig {
  return { ...makeConfig(false), startWeekday: 3 };
}
