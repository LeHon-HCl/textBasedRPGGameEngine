import { z } from 'zod';
import { refId } from '../ids.js';
import { effectListSchema } from './effects.js';
import { exprSchema, gameIdSchema, textKeySchema } from './common.js';

/**
 * 任务定义（设计 §2.4 QuestDef；data/quests/<questId>.yaml，FR-QUEST）。
 *
 * - 阶段状态机由 completeWhen 表达式驱动（§4.5，事务后按 refs 触碰增量评估）；
 * - rewards 为效果指令序列（§3.3），在 submit 的 child 事务中原子执行；
 * - requires/conflicts 引用其他任务（refKind='quest'），accept 时校验（FR-QUEST-04）。
 */

export const questStageSchema = z.strictObject({
  id: gameIdSchema,
  /** 目标文本键（任务日志展示，FR-QUEST-03） */
  objectiveKey: textKeySchema,
  /** 阶段完成条件（驱动状态机推进/进入下一阶段） */
  completeWhen: exprSchema,
});

export type QuestStage = z.infer<typeof questStageSchema>;

/** 任务定义（设计 §2.4 QuestDef / §4.5）：阶段目标与失败条件，{@link QuestDef} 的校验器 */
export const questDefSchema = z.strictObject({
  id: gameIdSchema,
  /** 发布者 NPC（任务日志 giver 指引用） */
  giver: refId('npc').optional(),
  /** 接取条件（accept 校验之一，FR-QUEST-04） */
  acceptIf: exprSchema.optional(),
  stages: z.array(questStageSchema).min(1),
  /** 完成奖励效果序列（缺省 = 无奖励） */
  rewards: effectListSchema.optional(),
  /** 失败条件（含时间截止，FR-QUEST-01） */
  failWhen: exprSchema.optional(),
  /** 互斥任务（对方 active/ready 时拒绝接取） */
  conflicts: z.array(refId('quest')).optional(),
  /** 前置任务 */
  requires: z.array(refId('quest')).optional(),
});

export type QuestDef = z.infer<typeof questDefSchema>;
