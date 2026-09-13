import { z } from 'zod';
import { gameIdSchema, textKeySchema } from './common.js';

/**
 * 时间配置（设计 §4.3 TimeConfig；data/time.yaml，09 号模块）。
 *
 * 时段制日历的作者声明面（FR-TIME-01 可配置时段制）：
 * - slots：时段列表与顺序由游戏定义（早/午/晚/夜或更细粒度），id 是表达式
 *   `time.slot` 的比较键（引擎内唯一）；
 * - weekdays / startWeekday：星期可改名，startWeekday 声明第 1 天是星期几
 *   （1 起算，∈ [1, weekdays.length]，跨字段 refine）；
 * - months：可选启用月历（月长可不等长；缺省 = 无月概念，Clock.month 不递进）。
 * 星期名 / 月名均为 TextKey（FR-L10N 文案走语言包，不在配置内联）。
 */

/** 时段定义（§4.3 SlotDef）：顺序即推进序 */
export const timeSlotDefSchema = z.strictObject({
  id: gameIdSchema,
  nameKey: textKeySchema,
});

export type TimeSlotDef = z.infer<typeof timeSlotDefSchema>;

/** 星期定义（§4.3 WeekdayDef）：位置序（1 起）由数组下标承载 */
export const weekdayDefSchema = z.strictObject({
  nameKey: textKeySchema,
});

export type WeekdayDef = z.infer<typeof weekdayDefSchema>;

/** 月定义（§4.3 months[] 条目）：月长（天）不等长允许 */
export const monthDefSchema = z.strictObject({
  length: z.number().int().min(1),
  nameKey: textKeySchema,
});

export type MonthDef = z.infer<typeof monthDefSchema>;

/** 跨字段 refine：slot id 全局唯一（表达式比较键） */
const uniqueSlotIds = (slots: readonly TimeSlotDef[]): boolean =>
  new Set(slots.map((slot) => slot.id)).size === slots.length;

export const timeConfigSchema = z
  .strictObject({
    slots: z.array(timeSlotDefSchema).min(1),
    weekdays: z.array(weekdayDefSchema).min(1),
    /** 第 1 天对应的星期序（1 起算；≤ weekdays.length） */
    startWeekday: z.number().int().min(1),
    /** 月历（可选启用；缺省 = 不启用月递进） */
    months: z.array(monthDefSchema).min(1).optional(),
  })
  .refine((config) => config.startWeekday <= config.weekdays.length, {
    message: 'startWeekday 必须落在 weekdays 数量范围内（1 起算）',
  })
  .refine((config) => uniqueSlotIds(config.slots), {
    message: 'slot id 重复（时段 id 是表达式 time.slot 的比较键，必须唯一）',
  });

export type TimeConfig = z.infer<typeof timeConfigSchema>;
