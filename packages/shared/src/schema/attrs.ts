import { z } from 'zod';
import { gameIdSchema, exprSchema, textKeySchema } from './common.js';

/**
 * 属性定义（设计 §2.4 AttrDefs，data/attrs.yaml）。
 *
 * 三形态（FR-STAT-01）：
 * - numeric：数值型（min/max/初始值/是否对玩家可见）；
 * - level：等级型（离散等级表 + 初始档位下标；GameState 统一以 number 存值，§3.1）；
 * - derived：派生型（公式表达式，FR-STAT-05；循环依赖在加载期报错）。
 * 等级名是玩家可见文本，一律文本键（D4）。
 */

const numericAttrDefSchema = z
  .strictObject({
    min: z.number(),
    max: z.number(),
    init: z.number(),
    /** false = 仅内部计算，不进状态面板（FR-STAT-01） */
    show: z.boolean(),
  })
  .refine((d) => d.min <= d.max, { message: 'numeric 属性必须 min ≤ max', path: ['min'] })
  .refine((d) => d.init >= d.min && d.init <= d.max, {
    message: 'numeric 属性初始值必须落在 [min, max] 内',
    path: ['init'],
  });

const levelAttrDefSchema = z
  .strictObject({
    /** 离散等级表（升序展示名，文本键） */
    levels: z.array(textKeySchema).min(1),
    /** 初始档位下标（0 起） */
    init: z.number().int().min(0),
  })
  .refine((d) => d.init < d.levels.length, {
    message: 'level 属性初始档位下标必须小于 levels.length',
    path: ['init'],
  });

const derivedAttrDefSchema = z.strictObject({
  /** 派生公式（如 '10 + attr.con * 3'，FR-STAT-05） */
  formula: exprSchema,
});

export const attrDefsSchema = z.strictObject({
  numeric: z.record(gameIdSchema, numericAttrDefSchema),
  level: z.record(gameIdSchema, levelAttrDefSchema),
  derived: z.record(gameIdSchema, derivedAttrDefSchema),
});

export type AttrDefs = z.infer<typeof attrDefsSchema>;
export type NumericAttrDef = z.infer<typeof numericAttrDefSchema>;
export type LevelAttrDef = z.infer<typeof levelAttrDefSchema>;
export type DerivedAttrDef = z.infer<typeof derivedAttrDefSchema>;
