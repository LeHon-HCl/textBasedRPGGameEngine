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

/** 立绘差分的单条变体：条件命中 → 该资产（按声明顺序取首个命中，FR-MEDIA-03） */
export const spriteVariantSchema = z.strictObject({
  /** 差分选择条件（普通表达式：好感阶段/身体部位/服装驱动，§5.10） */
  when: exprSchema,
  /** 命中时使用的立绘资产 id */
  asset: mediaRefSchema,
});

export type SpriteVariantDef = z.infer<typeof spriteVariantSchema>;

/**
 * 立绘声明（FR-MEDIA-03）：基图 + 条件差分。
 *
 * 兼容旧形态（§2.4 原始 `sprites[]` 为纯资产 id 数组）：字符串条目 = 无差分的
 * 单张立绘；对象条目承载「基图 + 有序变体」——求值取首个命中者，均不命中回落
 * base（省略 base 且无命中 = 该条目不产出立绘）。
 */
export const spriteDeclSchema = z.union([
  mediaRefSchema,
  z.strictObject({
    /** 基图资产 id（无变体命中时的回落目标） */
    base: mediaRefSchema.optional(),
    /** 变体表（至少一条；按声明顺序取首个条件命中者） */
    variants: z.array(spriteVariantSchema).min(1),
  }),
]);

export type SpriteDecl = z.infer<typeof spriteDeclSchema>;

export const npcDefSchema = z.strictObject({
  id: gameIdSchema,
  nameKey: textKeySchema,
  /** 立绘（含条件差分，FR-NPCR-01/FR-MEDIA-03/DD-05） */
  sprites: z.array(spriteDeclSchema).optional(),
  /** 日程表（缺省 = 不参与日程解析） */
  schedule: z.array(scheduleEntrySchema).optional(),
  /** 好感系统（缺省 = 该 NPC 无好感） */
  favor: favorDefSchema.optional(),
});

export type NpcDef = z.infer<typeof npcDefSchema>;
