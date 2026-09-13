import type { Clock, TimeConfig } from '@game/shared';

/**
 * Clock 推进纯函数（设计 §4.3 步骤 1「时钟推进」，09 任务 2；FR-TIME-01/02）。
 *
 * 全部为无副作用纯函数：时间子系统的核心计算面，管线编排器与日历投影共用
 * 同一口径（week/month 的推导公式只在本文件出现一次）。
 */

/** 推进结果：新时钟 + 跨边界旗标（管线钩子门控依据，§4.3 步骤 0/4） */
export interface ClockAdvanceResult {
  /** 推进后的时钟（新对象；入参不被变异） */
  readonly clock: Clock;
  /** 本次推进跨过天边界（新增 day ≥ 1） */
  readonly crossedDay: boolean;
  /** 本次推进跨过周边界（星期序回绕到第 1 天） */
  readonly crossedWeek: boolean;
  /** 本次推进跨过月边界（未启用月历时恒 false） */
  readonly crossedMonth: boolean;
}

/**
 * 星期序投影（1 起）：day 1 对应 startWeekday，之后按 weekdays.length 循环。
 * day=0（新档允许）按模归一到最后一星期，避免负余数。
 */
export function weekdayIndex(day: number, config: TimeConfig): number {
  const offset = (config.startWeekday - 1 + day - 1) % config.weekdays.length;
  return ((offset % config.weekdays.length) + config.weekdays.length) % config.weekdays.length + 1;
}

/** 周数（0 起）：day 1 所在周为第 0 周，星期序回绕即入下周 */
function weekNumber(day: number, config: TimeConfig): number {
  return Math.floor((config.startWeekday - 1 + day - 1) / config.weekdays.length);
}

/** 绝对月计数（0 起）：把「循环圈数 × 月数 + 圈内月序」拉直，跨月判定用 */
function absoluteMonth(day: number, config: TimeConfig): number {
  const months = config.months;
  if (months === undefined) return 0;
  const cycle = months.reduce((sum, month) => sum + month.length, 0);
  const cycleIndex = Math.floor((day - 1) / cycle);
  let remaining = (day - 1) % cycle;
  let monthIndex = 0;
  for (let i = 0; i < months.length; i++) {
    const length = months[i]?.length ?? 0;
    if (remaining < length) {
      monthIndex = i;
      break;
    }
    remaining -= length;
  }
  return cycleIndex * months.length + monthIndex;
}

/** 月内天序（1 起）：day 在当前月内的日期（日历 UI 的「几号」） */
export function dayOfMonth(day: number, config: TimeConfig): number {
  const months = config.months;
  if (months === undefined) return day;
  const cycle = months.reduce((sum, month) => sum + month.length, 0);
  let remaining = (day - 1) % cycle;
  for (const month of months) {
    if (remaining < month.length) return remaining + 1;
    remaining -= month.length;
  }
  return remaining + 1;
}

/**
 * 时钟推进（§4.3 步骤 1）：slots 个时段后的 Clock 与跨边界旗标。
 *
 * - 口径：slotIndex 连加后按 slots.length 回绕，回绕次数即跨天数；
 * - week：恒启用（星期为必选配置），weekNumber 跨越即 crossedWeek；
 * - month：仅 config.months 启用时写入 Clock.month（循环内月序 0 起）；
 *   未启用时保持 undefined 且不判跨月；
 * - slots=0 时原样返回（管线对 0 推进直接短路，本函数仍保证语义自洽）；
 * - 入参 Clock 缺省 week/month 亦可（新档初始时钟只有 day/slotIndex），
 *   推进后按上进口径补齐。
 */
export function advanceClock(clock: Clock, config: TimeConfig, slots: number): ClockAdvanceResult {
  const slotCount = config.slots.length;
  const total = clock.slotIndex + slots;
  const extraDays = Math.floor(total / slotCount);
  const next: Clock = {
    day: clock.day + extraDays,
    slotIndex: total % slotCount,
    week: weekNumber(clock.day + extraDays, config),
  };
  if (config.months !== undefined) {
    // Clock.month 存循环内月序（0 起，日历/表达式用）；绝对月计数只用于跨月判定
    next.month = absoluteMonth(next.day, config) % config.months.length;
  }
  return {
    clock: next,
    crossedDay: extraDays > 0,
    crossedWeek: next.week > weekNumber(clock.day, config),
    crossedMonth:
      config.months !== undefined && absoluteMonth(next.day, config) > absoluteMonth(clock.day, config),
  };
}

/**
 * 缺省日历（游戏包未提供 data/time.yaml 时的宿主缺省）：
 * 4 时段（早/午/晚/夜）× 7 天 × 周日起算，不启用月历。
 * 名称键走引擎缺省文案键命名空间（ui.time.*，FR-L10N 引擎自身多语言）。
 */
export const DEFAULT_TIME_CONFIG: TimeConfig = {
  slots: [
    { id: 'slot_morning', nameKey: 'ui.time.slot.morning' },
    { id: 'slot_noon', nameKey: 'ui.time.slot.noon' },
    { id: 'slot_evening', nameKey: 'ui.time.slot.evening' },
    { id: 'slot_night', nameKey: 'ui.time.slot.night' },
  ],
  weekdays: Array.from({ length: 7 }, (_, i) => ({ nameKey: `ui.time.weekday.${i + 1}` })),
  startWeekday: 1,
};
