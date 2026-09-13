import type { Clock, GameId, TextKey, TimeConfig } from '@game/shared';
import { dayOfMonth, weekdayIndex } from './clock.js';
import type { TimeViewProvider } from '../state/index.js';

/**
 * 日历 UI 投影（FR-TIME-05，§4.3「Clock + TimeConfig 纯函数投影，无状态」；
 * 09 任务 7）与 TimeViewProvider 的 TimeConfig 校准注入。
 *
 * 投影只做「时钟 + 配置 → 视图」的数据变换，不持有状态、不触时间推进——
 * runtime-ui 日历面板（25 号）与本模块求值视图共用同一实现（单一口径）。
 */

/** 日历视图（FR-TIME-05：第几周 / 星期几 / 时段 / 几号，名称键交由语言包解析） */
export interface CalendarView {
  /** 总天数（1 起，新档当日为 1） */
  readonly day: number;
  /** 周数（0 起） */
  readonly week: number;
  /** 星期序（1 起，∈ [1, config.weekdays.length]） */
  readonly weekdayIndex: number;
  /** 星期名文本键（config.weekdays[weekdayIndex - 1].nameKey） */
  readonly weekdayNameKey: TextKey;
  /** 当前时段 id */
  readonly slotId: GameId;
  /** 当前时段名文本键 */
  readonly slotNameKey: TextKey;
  /** 月历（仅 config.months 启用时产出）：循环月序 / 月名键 / 月内日序 */
  readonly month?: { readonly index: number; readonly nameKey: TextKey; readonly day: number };
}

/**
 * 日历投影纯函数：Clock + TimeConfig → 今日/星期/时段视图。
 * Clock.week 缺省（新档未推进）时按 day 推导；month 仅配置启用时产出。
 */
export function projectCalendar(clock: Clock, config: TimeConfig): CalendarView {
  const weekday = weekdayIndex(clock.day, config);
  const slot = config.slots[clock.slotIndex % config.slots.length];
  const monthDefs = config.months;
  const week = clock.week ?? Math.floor((config.startWeekday - 1 + clock.day - 1) / config.weekdays.length);
  return {
    day: clock.day,
    week,
    weekdayIndex: weekday,
    weekdayNameKey:
      config.weekdays[weekday - 1]?.nameKey ?? (`time.weekday.${weekday}` as TextKey),
    slotId: (slot?.id ?? `slot_${clock.slotIndex}`) as GameId,
    slotNameKey: slot?.nameKey ?? (`time.slot.${clock.slotIndex}` as TextKey),
    ...(monthDefs !== undefined
      ? {
          month: {
            index: clock.month ?? 0,
            nameKey: monthDefs[(clock.month ?? 0) % monthDefs.length]?.nameKey as TextKey,
            day: dayOfMonth(clock.day, config),
          },
        }
      : {}),
  };
}

/**
 * TimeViewProvider 的 TimeConfig 校准实现（§3.1 缝，04 号预留的注入点）：
 * - `time.slot` = 当前时段 id（作者表达式 `time.slot == "slot_morning"`，
 *   替代 04 号缺省投影的数值串）；
 * - `time.weekday` = 星期序字符串（1 起，startWeekday 校准）。
 * 宿主装配：`new GameRuntime({ ..., timeViewProvider: createTimeViewProvider(def.time ?? DEFAULT_TIME_CONFIG) })`。
 */
export function createTimeViewProvider(config: TimeConfig): TimeViewProvider {
  return (clock: Clock) => ({
    day: clock.day,
    weekday: String(weekdayIndex(clock.day, config)),
    slot: (config.slots[clock.slotIndex % config.slots.length]?.id ??
      `slot_${clock.slotIndex}`) as GameId,
  });
}
