import { z } from 'zod';
import { exprSchema, gameIdSchema, textKeySchema } from './common.js';

/**
 * 统计页定义（设计 §2.4 StatsPageDef；stats-page.yaml，FR-STAP-01）。
 *
 * 条目取值二选一：expr（求值表达式，数值类图表）或 key（纯文本键）；
 * style 提示渲染形态（条形/雷达/文字，runtime-ui 纯 SVG 组件，§6.4）。
 */

export const statsEntryStyleSchema = z.enum(['bar', 'radar', 'text']);

export type StatsEntryStyle = z.infer<typeof statsEntryStyleSchema>;

const entryCommon = {
  /** 显示条件（求值为假则隐藏条目） */
  showIf: exprSchema.optional(),
  style: statsEntryStyleSchema.optional(),
};

/** 统计条目（设计 §2.4 StatsPageDef / §6.4）：表达式或文本键 + 样式 */
export const statsEntrySchema = z.union([
  z.strictObject({ expr: exprSchema, ...entryCommon }),
  z.strictObject({ key: textKeySchema, ...entryCommon }),
]);

export type StatsEntry = z.infer<typeof statsEntrySchema>;

/** 统计分组（设计 §2.4）：条目集合 + 分组标题键 */
export const statsGroupSchema = z.strictObject({
  id: gameIdSchema,
  nameKey: textKeySchema,
  entries: z.array(statsEntrySchema).min(1),
});

export type StatsGroup = z.infer<typeof statsGroupSchema>;

/** 统计页定义（设计 §2.4 StatsPageDef / §6.4）：{@link StatsPageDef} 的校验器 */
export const statsPageDefSchema = z.strictObject({
  groups: z.array(statsGroupSchema).min(1),
});

export type StatsPageDef = z.infer<typeof statsPageDefSchema>;
