import { z } from 'zod';
import { effectListSchema } from './effects.js';
import { exprSchema, gameIdSchema, mediaRefSchema, textKeySchema } from './common.js';

/**
 * 物品定义（设计 §2.4 ItemDef；data/items/<itemId>.yaml，FR-ITEM）。
 *
 * - type 四类（FR-ITEM-01：普通/消耗品/装备/服装）；关键道具以独立 key 标记
 *   （背包分区，FR-ITEM-02、§3.1 bag 注释），不复用 type（两正交维度）；
 * - garment：多层服装声明（部位 × 层 1 内 2 中 3 外 × 遮挡度开放字段，
 *   语义由游戏自用、引擎不解释，FR-ITEM-04）；
 * - type='equip' 必带 equipSlot、type='garment' 必带 garment（加载前置校验前移到 schema）。
 */

export const itemTypeSchema = z.enum(['normal', 'consumable', 'equip', 'garment']);

export type ItemType = z.infer<typeof itemTypeSchema>;

export const garmentDefSchema = z.strictObject({
  /** 服装部位（body.yaml parts 的键） */
  part: gameIdSchema,
  /** 层级：1 内 / 2 中 / 3 外（§4.7 Outfit） */
  layer: z.number().int().min(1).max(3),
  /** 遮挡度等开放数据字段（数值语义由游戏自用，引擎不解释，FR-ITEM-04） */
  coverage: z.number().min(0).optional(),
});

export type GarmentDef = z.infer<typeof garmentDefSchema>;

export const itemDefSchema = z
  .strictObject({
    id: gameIdSchema,
    nameKey: textKeySchema,
    /** 描述文本键（FR-ITEM-01） */
    descKey: textKeySchema.optional(),
    /** 图标资产引用（FR-ITEM-01） */
    icon: mediaRefSchema.optional(),
    type: itemTypeSchema,
    /** 最大堆叠数量（缺省 = 不可堆叠，FR-ITEM-02） */
    stack: z.number().int().min(1).optional(),
    /** 使用效果与使用条件（consumable 常用，FR-ITEM-01） */
    useEffect: z
      .strictObject({ effects: effectListSchema, require: exprSchema.optional() })
      .optional(),
    /** 装备栏位（equip 类型必填） */
    equipSlot: gameIdSchema.optional(),
    /**
     * 装备属性修正（FR-ITEM-03，§4.7 equipMods）：attrId → 修正表达式（加算）。
     * 派生属性重算时并入：修正值叠加在基础值（数值属性）或派生公式值之上，
     * 结果写入 derived 缓存；面板明细经引擎 equipModDetails 投影（13 号）。
     */
    equipMods: z.record(gameIdSchema, exprSchema).optional(),
    /** 服装声明（garment 类型必填） */
    garment: garmentDefSchema.optional(),
    /** 基准价（商店定价表达式的常用输入，FR-ECON-02） */
    price: z.number().int().min(0).optional(),
    /** 关键道具标记：独立分区、不可丢弃出售（FR-ITEM-02） */
    key: z.boolean().optional(),
  })
  .refine((item) => item.type !== 'equip' || item.equipSlot !== undefined, {
    message: 'type=equip 的物品必须声明 equipSlot（FR-ITEM-03）',
    path: ['equipSlot'],
  })
  .refine((item) => item.type !== 'garment' || item.garment !== undefined, {
    message: 'type=garment 的物品必须声明 garment（FR-ITEM-04）',
    path: ['garment'],
  });

export type ItemDef = z.infer<typeof itemDefSchema>;
