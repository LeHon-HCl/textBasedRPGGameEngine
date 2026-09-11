import { z } from 'zod';
import { gameIdSchema, textKeySchema } from './common.js';

/**
 * 阵营定义（设计 §2.4 FactionDef；data/factions.yaml，FR-NPCR-04）。
 *
 * - reputation 指令 + faction.<id> 变量域；init 为新档初始声望；
 * - thresholds 阈值表驱动 ReputationBandChanged 事件（商店定价引用声望即普通表达式）。
 */

/** 声望波段阈值：at 为进入该波段的最小声望值 */
export const factionThresholdSchema = z.strictObject({
  id: gameIdSchema,
  at: z.number(),
  nameKey: textKeySchema,
});

export type FactionThreshold = z.infer<typeof factionThresholdSchema>;

export const factionDefSchema = z.strictObject({
  id: gameIdSchema,
  nameKey: textKeySchema,
  /** 新档初始声望 */
  init: z.number(),
  /** 声望波段阈值表（缺省 = 无波段事件） */
  thresholds: z.array(factionThresholdSchema).optional(),
});

export type FactionDef = z.infer<typeof factionDefSchema>;
