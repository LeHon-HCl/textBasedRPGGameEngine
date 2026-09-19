import { z } from 'zod';
import { refId } from '../ids.js';
import { exprSchema, gameIdSchema, mediaRefSchema, textKeySchema } from './common.js';
import { effectListSchema } from './effects.js';
import { exprOrNumberSchema } from './common.js';

/**
 * 战斗数据域（设计 §5.2 回填，16 号；proposal §5.10 FR-CMBT-07/09/12）。
 *
 * 设计缺口回填：§5.2 的 BattleSession 收 `EncounterDef`、`battle` 指令以 id 引用
 * 遭遇，但 §2.4 schema 清单漏列该域——本文件按设计意图补齐数据面（SPEC 冲突
 * 修复性质，PR 审查即确认流程）：
 * - EnemyDef：敌人 = HP/属性快照/技能表/AI 策略/立绘（`data/enemies.yaml` 单文件
 *   数组域）；
 * - EncounterDef：遭遇 = 敌方队伍（FR-CMBT-12 多人，允许重复 id = 多只同种）+
 *   开场/回合/胜负文本键 + 逃跑率覆盖 + 奖励效果序列（`data/encounters.yaml`）；
 * - SkillRef / AiPolicy：§5.2 注释级引用的形态落地（FR-CMBT-09 weighted /
 *   scripted 双策略）。技能的**效果绑定面**（§5.2「技能效果 = 战斗子集指令」）
 *   待 16 号 W2 裁定后 additive 追加（宁加不改）。
 *
 * 引用种类（§2.1）：新增 `enemy` / `encounter` 两个 RefKind——悬空核对归 06 号
 * crossRef（敌人引用缺失 = 内容断裂 = error 级）。
 */

/** 技能引用（§5.2 SkillRef）：id + 结算参数 + 可选附加效果（W2 消费） */
export const skillRefSchema = z.strictObject({
  id: gameIdSchema,
  /** 结算参数（伤害倍率 mult、目标提示等；值可为表达式或数值字面量，§3.3 宽松语义） */
  params: z.record(z.string(), exprOrNumberSchema).optional(),
  /**
   * 附加效果序列（裁定 2026-09-19，#28）：攻击技能经 DamageFn 结算无需声明；
   * 非攻击附加效果（治疗/状态/增益）在此声明战斗子集指令，由 battle 指令
   * 接线层的 applyEffects 缝经 runtime.exec({source:'battle'}) 执行（会话与
   * 执行器不持 GameRuntime——DD-11 不破坏）。缺省未注入缝且声明了 effects →
   * 日志显性化（与 consumeItem 同口径）。engine types.ts 的同名字段归 A 方
   * W2 下个 commit（宁加不改，两侧口径一致）。
   */
  effects: effectListSchema.optional(),
});

export type SkillRefDef = z.infer<typeof skillRefSchema>;

/** AI 可选行动（§5.2 AiActionSpec；与玩家行动同形，无 flee——敌方不逃跑） */
export const aiActionSpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('skill'),
    skillId: gameIdSchema,
    /** 目标 uid（运行时实例；缺省 = 会话/W6 目标选择裁决） */
    targetUid: z.string().min(1).optional(),
  }),
  z.strictObject({
    kind: z.literal('item'),
    itemId: refId('item'),
    targetUid: z.string().min(1).optional(),
  }),
  z.strictObject({ kind: z.literal('defend') }),
]);

export type AiActionSpecDef = z.infer<typeof aiActionSpecSchema>;

/** AI 行动条目：可选 when 条件（普通表达式，§5.10「决策只用会话内状态」） */
const aiEntryShape = {
  when: exprSchema.optional(),
  action: aiActionSpecSchema,
} as const;

/** AI 策略声明（FR-CMBT-09；实现归 16 号 W4 damage/ai.ts） */
export const aiPolicySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('weighted'),
    /** 加权候选表：when 过滤后按 weight 随机 */
    entries: z.array(z.strictObject({ weight: z.number(), ...aiEntryShape })).min(1),
  }),
  z.strictObject({
    kind: z.literal('scripted'),
    /** 表达式序列：取首个 when 满足者 */
    sequence: z.array(z.strictObject(aiEntryShape)).min(1),
  }),
]);

export type AiPolicyDef = z.infer<typeof aiPolicySchema>;

/** 敌人定义（FR-CMBT-07）：HP/属性快照/技能表/AI/立绘 */
export const enemyDefSchema = z.strictObject({
  id: gameIdSchema,
  nameKey: textKeySchema,
  hp: z.number().int().min(1),
  /** 战斗属性快照（atk/def/spd 等；spd 驱动行动序，§5.2） */
  attrs: z.record(gameIdSchema, z.number()),
  skills: z.array(skillRefSchema).min(1),
  /** 缺省 = W4 定义的兜底策略（全技能均权加权） */
  ai: aiPolicySchema.optional(),
  /** 表现层立绘（DD-05；engine 只透传） */
  sprite: mediaRefSchema.optional(),
});

export type EnemyDef = z.infer<typeof enemyDefSchema>;

/** 遭遇定义（FR-CMBT-07/12）：敌方队伍 + 文本键 + 逃跑率 + 奖励 */
export const encounterDefSchema = z.strictObject({
  id: gameIdSchema,
  /** 敌方队伍（enemy 引用；允许重复 = 多只同种敌人） */
  enemies: z.array(refId('enemy')).min(1),
  openingKey: textKeySchema,
  /** 每轮展示的回合文本键（缺省无） */
  roundKey: textKeySchema.optional(),
  victoryKey: textKeySchema,
  defeatKey: textKeySchema,
  escapeKey: textKeySchema.optional(),
  /** 逃跑成功率覆盖（0–1；缺省 0.5，§5.2 可配置） */
  escapeRate: z.number().min(0).max(1).optional(),
  /** 胜利奖励效果序列（FR-CMBT-11；chance 掉落包装器归 W2 效果扩展，先复用现有效果面） */
  rewards: effectListSchema.optional(),
});

export type EncounterDef = z.infer<typeof encounterDefSchema>;
