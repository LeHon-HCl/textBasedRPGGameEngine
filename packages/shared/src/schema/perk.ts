import { z } from 'zod';
import { effectListSchema } from './effects.js';
import { gameIdSchema, textKeySchema } from './common.js';

/**
 * 开局增益定义（设计 §2.4 PerkDef；data/perks.yaml，FR-ACHV-06）。
 *
 * - 新游戏流程「选 Perk → ProfileStore.mutate 扣点 → bootstrap.perks 建档」；
 *   effects 在新档初始化时经效果指令执行一次（属性/物品/flag/解锁内容复用 §3.3）；
 * - requires/conflicts 引用其他 Perk 的 id（Perk 不在 RefKind 引用面内，
 *   其存档引用经 bootstrap.perks 全量声明，§5.4）；repeatable 允许多次购买。
 */

export const perkDefSchema = z.strictObject({
  id: gameIdSchema,
  nameKey: textKeySchema,
  descKey: textKeySchema.optional(),
  /** 兑换消耗点数 */
  cost: z.number().int().min(0),
  /** 新档生效的效果序列（至少一条） */
  effects: effectListSchema.min(1),
  /** 前置 Perk */
  requires: z.array(gameIdSchema).optional(),
  /** 互斥 Perk */
  conflicts: z.array(gameIdSchema).optional(),
  /** 可重复购买（缺省 = 单次） */
  repeatable: z.boolean().optional(),
});

export type PerkDef = z.infer<typeof perkDefSchema>;
