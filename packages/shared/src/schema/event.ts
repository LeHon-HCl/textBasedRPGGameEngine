import { z } from 'zod';
import { refId } from '../ids.js';
import { exprOrNumberSchema, exprSchema, gameIdSchema } from './common.js';

/**
 * 事件定义（设计 §2.4 EventDef；data/events.yaml 事件池条目，FR-XPLR）。
 *
 * - trigger 三型（FR-XPLR-04）：condition 满足即触发（剧情关键节点）；random
 *   权重随机抽取（冷却/once 限流）；explore 探索发现型（玩家执行探索动作时呈现）；
 * - require 表达式经编译期 refs 抽取进脏标记索引（§4.4，NFR-02 增量评估）；
 * - once: 'loop' 每周目一次 / 'save' 每存档一次（§4.4 prune）；
 * - 评估（collect/prune/select）与互斥归 10 号事件系统，本 schema 只承载声明。
 */

const onceScopeSchema = z.enum(['loop', 'save']);

/** 冷却窗口：天数与时段至少声明其一（§4.4 cooldown_days/slots） */
const cooldownSchema = z
  .strictObject({
    days: exprOrNumberSchema.optional(),
    slots: exprOrNumberSchema.optional(),
  })
  .refine((c) => c.days !== undefined || c.slots !== undefined, {
    message: 'cooldown 需要 days 或 slots 至少其一',
  });

export const eventTriggerSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('condition'),
    /** 触发条件（condition 型必填） */
    require: exprSchema,
    once: onceScopeSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('random'),
    /** 抽取权重（Rng.weighted，DD-09） */
    weight: z.number().positive(),
    require: exprSchema.optional(),
    cooldown: cooldownSchema.optional(),
    once: onceScopeSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('explore'),
    weight: z.number().positive(),
    require: exprSchema.optional(),
    cooldown: cooldownSchema.optional(),
    once: onceScopeSchema.optional(),
  }),
]);

export type EventTrigger = z.infer<typeof eventTriggerSchema>;

export const eventDefSchema = z.strictObject({
  id: gameIdSchema,
  /** 触发地点范围：区域 + 可选地点（§4.4 PoolIndex key = `${area}/${location ?? '*'}`） */
  where: z.strictObject({
    area: refId('area'),
    location: refId('location').optional(),
  }),
  /** 静态时间窗口：时段名 / 星期名（游戏在时间配置中定义，FR-TIME-01） */
  when: z.strictObject({
    slots: z.array(z.string().min(1)).optional(),
    weekdays: z.array(z.string().min(1)).optional(),
  }),
  trigger: eventTriggerSchema,
  /** condition 型按 priority 降序入选（§4.4 select） */
  priority: z.number().int().optional(),
  /** 互斥组：同组同时至多触发一个（FR-XPLR-05） */
  mutexGroup: z.string().min(1).optional(),
  /** 内容分级标签（FR-CGRD-02） */
  tags: z.array(gameIdSchema).optional(),
  /** 事件场景（子会话入口，§4.2） */
  scene: refId('scene'),
});

export type EventDef = z.infer<typeof eventDefSchema>;
