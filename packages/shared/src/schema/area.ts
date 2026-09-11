import { z } from 'zod';
import { exprSchema, gameIdSchema, textKeySchema } from './common.js';

/**
 * 区域定义（设计 §2.4 AreaDef；data/areas/<areaId>.yaml）。
 *
 * 三级拓扑「区域 → 地点 → 场景」中的区域层（FR-XPLR-01）：
 * 地点带名称键、解锁条件、移动时段消耗与地图坐标（FR-XPLR-02 地图 UI 数据源）。
 */

export const locationDefSchema = z.strictObject({
  nameKey: textKeySchema,
  /** 解锁条件（不满足时地图显示为未知/提示，FR-XPLR-02） */
  unlockIf: exprSchema.optional(),
  /** 移动消耗时段数（FR-XPLR-02 move_cost_slots） */
  moveCost: z.number().int().min(0),
  /** 地图坐标 [x, y]（地图 UI 渲染用） */
  mapPos: z.tuple([z.number(), z.number()]),
});

export type LocationDef = z.infer<typeof locationDefSchema>;

export const areaDefSchema = z.strictObject({
  id: gameIdSchema,
  nameKey: textKeySchema,
  /** locationId → 地点定义（§2.4 locations{id→{...}}） */
  locations: z.record(gameIdSchema, locationDefSchema),
});

export type AreaDef = z.infer<typeof areaDefSchema>;
