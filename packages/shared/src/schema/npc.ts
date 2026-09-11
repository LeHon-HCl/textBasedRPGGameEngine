import { z } from 'zod';
import { refId } from '../ids.js';
import { exprSchema, gameIdSchema, mediaRefSchema, textKeySchema } from './common.js';

/**
 * NPC 定义（设计 §2.4 NpcDef；data/npcs/<npcId>.yaml，FR-NPCR）。
 *
 * - 日程按声明顺序取第一个匹配项（slots+weekdays+showIf，§4.6 resolveNpcLocation），
 *   无匹配 = 不在场；location 引用地点（refKind='location'）；
 * - favor 好感区间 + 阈值分段（min ≤ max 为硬约束）：favor 指令 clamp 后按阈值表
 *   二分更新 stage，阶段变化 emit FavorStageChanged（FR-NPCR-02）。
 */

/** 日程时间窗（时段名 / 星期名由游戏时间配置定义，FR-TIME-01） */
export const scheduleWindowSchema = z.strictObject({
  slots: z.array(z.string().min(1)).optional(),
  weekdays: z.array(z.string().min(1)).optional(),
});

export const scheduleEntrySchema = z.strictObject({
  at: scheduleWindowSchema,
  location: refId('location'),
  /** 出场条件（周目/flag 感知，FR-TIME-04） */
  showIf: exprSchema.optional(),
});

export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

/** 好感阶段阈值：at 为进入该阶段的最小好感值 */
export const favorStageSchema = z.strictObject({
  id: gameIdSchema,
  at: z.number(),
  nameKey: textKeySchema,
});

export type FavorStage = z.infer<typeof favorStageSchema>;

export const favorDefSchema = z
  .strictObject({
    min: z.number(),
    max: z.number(),
    stages: z.array(favorStageSchema),
  })
  .refine((f) => f.min <= f.max, { message: 'favor 必须 min ≤ max', path: ['min'] });

export type FavorDef = z.infer<typeof favorDefSchema>;

export const npcDefSchema = z.strictObject({
  id: gameIdSchema,
  nameKey: textKeySchema,
  /** 立绘资产引用（含差分基图，差分条件归媒体层，FR-NPCR-01/DD-05） */
  sprites: z.array(mediaRefSchema).optional(),
  /** 日程表（缺省 = 不参与日程解析） */
  schedule: z.array(scheduleEntrySchema).optional(),
  /** 好感系统（缺省 = 该 NPC 无好感） */
  favor: favorDefSchema.optional(),
});

export type NpcDef = z.infer<typeof npcDefSchema>;
