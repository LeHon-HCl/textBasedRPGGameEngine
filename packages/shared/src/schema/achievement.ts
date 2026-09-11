import { z } from 'zod';
import { exprSchema, gameIdSchema, textKeySchema } from './common.js';

/**
 * 成就定义（设计 §2.4 AchievementDef；data/achievements.yaml，FR-ACHV）。
 *
 * - 解锁由 AchievementEvaluator 事务后按 refs 增量评估 + 每时段兜底全量（§5.4）；
 * - type=progress 为进度型：progressExpr 求当前值，goal 为目标值
 *   （§5.4 progressOf 返回 {cur, goal} 的两个数据源）；
 * - hidden 型未解锁前仅显示占位（FR-ACHV-04）；group 用于成就图鉴分组。
 */

export const achievementDefSchema = z
  .strictObject({
    id: gameIdSchema,
    nameKey: textKeySchema,
    /** 解锁条件表达式 */
    when: exprSchema,
    /** 解锁获得点数（入 Profile，D7） */
    points: z.number().int().min(0),
    type: z.enum(['normal', 'progress', 'hidden']),
    /** 进度型当前值表达式（type=progress 必填） */
    progressExpr: exprSchema.optional(),
    /** 进度型目标值（type=progress 必填） */
    goal: z.number().int().min(1).optional(),
    /** 成就图鉴分组（FR-ACHV-04） */
    group: z.string().min(1).optional(),
  })
  .refine((a) => a.type !== 'progress' || (a.progressExpr !== undefined && a.goal !== undefined), {
    message: 'type=progress 的成就必须声明 progressExpr 与 goal（FR-ACHV-01）',
    path: ['type'],
  });

export type AchievementDef = z.infer<typeof achievementDefSchema>;
