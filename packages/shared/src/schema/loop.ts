import { z } from 'zod';
import { refId } from '../ids.js';
import { exprSchema } from './common.js';

/**
 * 周目配置（设计 §2.4 LoopConfig；data/loops.yaml，FR-LOOP）。
 *
 * - 按类别声明继承/重置策略（§5.5：先整体 reset，再逐类 apply inherit）；
 *   未声明的类别缺省 reset；
 * - policy 五形态：'inherit' 全继承 | 'reset' 全重置 | {keepRatio} 表达式例外
 *   （如保留金币 10%）| {whitelist} 仅保留清单 | {blacklist} 排除清单；
 * - openingScene 为周目转场后的开局场景（FR-LOOP-03）。
 */

/** 继承/重置的存档类别（§5.5 清单，FR-LOOP-04） */
export const loopCategorySchema = z.enum([
  'attrs',
  'skills',
  'items',
  'outfit',
  'body',
  'favor',
  'factions',
  'flags',
  'quests',
  'seen',
  'time',
]);

export type LoopCategory = z.infer<typeof loopCategorySchema>;

/** 单类别的周目继承策略（设计 §2.4 / §5.5）：{@link LoopPolicy} 的校验器 */
export const loopPolicySchema = z.union([
  z.literal('inherit'),
  z.literal('reset'),
  /** 保留比例表达式（求值 ∈ [0,1]，如 'wallet.town_silver * 0.1'） */
  z.strictObject({ keepRatio: exprSchema }),
  /** 白名单例外：仅继承清单内的条目 */
  z.strictObject({ whitelist: z.array(z.string()) }),
  /** 黑名单例外：继承时排除清单内条目 */
  z.strictObject({ blacklist: z.array(z.string()) }),
]);

export type LoopPolicy = z.infer<typeof loopPolicySchema>;

/** 周目配置（设计 §2.4 LoopConfig / §5.5）：{@link LoopConfig} 的校验器 */
export const loopConfigSchema = z.strictObject({
  /** 周目转场后的开局场景 */
  openingScene: refId('scene'),
  /** 继承策略表（类别 → policy；partialRecord：未声明类别不强制出现） */
  inherit: z.partialRecord(loopCategorySchema, loopPolicySchema).optional(),
  /** 重置策略表（与 inherit 互补声明例外） */
  reset: z.partialRecord(loopCategorySchema, loopPolicySchema).optional(),
});

export type LoopConfig = z.infer<typeof loopConfigSchema>;
