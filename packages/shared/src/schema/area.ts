import { z } from 'zod';
import { exprSchema, gameIdSchema, mediaBindingSchema, textKeySchema } from './common.js';

/**
 * 区域定义（设计 §2.4 AreaDef；data/areas/<areaId>.yaml）。
 *
 * 三级拓扑「区域 → 地点 → 场景」中的区域层（FR-XPLR-01）：
 * 地点带名称键、解锁条件、移动时段消耗与地图坐标（FR-XPLR-02 地图 UI 数据源）。
 *
 * media 为区域级背景/BGM 绑定（FR-MEDIA-02「场景/区域可绑定」）：作为场景
 * 绑定的**回落层**——场景未声明对应项时取区域值（解析次序见 24 号 SceneRunner）。
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
  /** 区域级背景/BGM 绑定（FR-MEDIA-02；场景绑定的回落层，形态与场景一致） */
  media: mediaBindingSchema.optional(),
});

export type AreaDef = z.infer<typeof areaDefSchema>;
