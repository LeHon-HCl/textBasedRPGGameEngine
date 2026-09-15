import { z } from 'zod';
import { refId } from '../ids.js';
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
  /**
   * 地图点击该地点时进入的场景（FR-XPLR-02「世界地图与导航」的落地字段）。
   *
   * 语义：地点 → 入口场景的**导航映射**。省略时由加载器按「本区域内、非事件
   * 场景（非 ev_ 前缀）、恰好命中一个场景」自动推导；推导不出时加载期报错，
   * 要求作者显式声明（避免运行期「点了没反应」）。
   *
   * 约束（加载期校验）：必须指向**同区域**的普通场景（不得跨区域、不得为事件场景）。
   * 跨区域移动应由叙事 `goto` / 事件承载，不开地图直通口子。
   */
  entryScene: refId('scene').optional(),
});

export type LocationDef = z.infer<typeof locationDefSchema>;

/** 区域定义（设计 §2.4 AreaDef）：{@link AreaDef} 的校验器 */
export const areaDefSchema = z.strictObject({
  id: gameIdSchema,
  nameKey: textKeySchema,
  /** locationId → 地点定义（§2.4 locations{id→{...}}） */
  locations: z.record(gameIdSchema, locationDefSchema),
  /** 区域级背景/BGM 绑定（FR-MEDIA-02；场景绑定的回落层，形态与场景一致） */
  media: mediaBindingSchema.optional(),
});

export type AreaDef = z.infer<typeof areaDefSchema>;
