import { z } from 'zod';
import { refId } from '../ids.js';
import {
  exprOrNumberSchema,
  exprSchema,
  gameIdSchema,
  mediaRefSchema,
  textKeySchema,
} from './common.js';

/**
 * 效果指令结构化 schema（设计 §3.3 内置指令注册表的数据侧投影，DD-08）。
 *
 * - 每个内置指令一个键（25 个固定 id），单键对象即一条指令；作者扩展统一用
 *   `{call: {fn: 'x.<script>.<name>', with: {...}}}` 调用（DD-08）；
 * - 本层只做「宽松结构校验」：指令键存在、参数形态合理、引用字段携带 refId(kind)
 *   元数据；**参数级校验在加载期由指令注册表 schema 执行（设计 §3.4/§3.3）**——
 *   effectParamSchemas 即注册表参数 schema 的数据侧基准，05 号模块的
 *   EffectInstructionDef.schema 必须与其兼容；
 * - 表达式字段一律为 string（ExprSource，§2.3），编译期校验归 03 号求值器；
 * - check / battle 的分支子效果递归引用 EffectData（§3.3 child 事务）：递归类型环
 *   按 zod v4 约定以手写 interface 打破，schema 与手写类型的一致性由声明处
 *   赋值检查与本模块解析测试双向守护。
 */

/** 变量/flag 值：表达式原文或字面量（string 同时承接表达式与字符串字面量，宽松语义） */
const exprOrLiteralSchema = z.union([exprSchema, z.number(), z.boolean()]);

// —— 状态类（§3.3：set/add、flag、money、set_body、favor/reputation） ————————

const setParams = z.strictObject({
  /** 变量/属性/flag 路径（如 'attr.hp'、'world.rent_due'），编译期按白名单校验 */
  key: z.string().min(1),
  value: exprOrLiteralSchema,
});

const addParams = z.strictObject({ key: z.string().min(1), amount: exprOrNumberSchema });

const flagParams = z.strictObject({
  name: z.string().min(1),
  value: z.boolean().optional(),
});

/** 多货币增减：currency → 金额（可为负，§3.3「可负值校验」） */
const moneyParams = z.record(gameIdSchema, exprOrNumberSchema);

const setBodyParams = z.strictObject({
  part: gameIdSchema,
  value: z.string().min(1),
  /** 临时变身回退时长（§4.8：revertAfter {slots|days}） */
  revertAfter: z
    .strictObject({ slots: exprOrNumberSchema.optional(), days: exprOrNumberSchema.optional() })
    .optional(),
});

const favorParams = z.strictObject({ npc: refId('npc'), amount: exprOrNumberSchema });

const reputationParams = z.strictObject({
  faction: refId('faction'),
  amount: exprOrNumberSchema,
});

// —— 物品类（§3.3：give/take、equip/unequip、wear/remove） ———————————————————

const giveParams = z.strictObject({
  item: refId('item'),
  count: exprOrNumberSchema.optional(),
});

const takeParams = z.strictObject({
  item: refId('item'),
  count: exprOrNumberSchema.optional(),
});

const equipParams = z.strictObject({ item: refId('item') });

const unequipParams = z.strictObject({ slot: gameIdSchema });

/** 穿戴：单件（item）或应用换装预设（preset，§4.7 FR-ITEM-05），二者必有其一 */
const wearParams = z
  .strictObject({ item: refId('item').optional(), preset: z.string().min(1).optional() })
  .refine((w) => w.item !== undefined || w.preset !== undefined, {
    message: 'wear 需要 item（穿入单件）或 preset（应用换装预设）之一',
  });

const removeParams = z.strictObject({ item: refId('item') });

// —— 流程与系统类（§3.3：advance_time、quest、跳转、unlock、media、notify、call） —

const advanceTimeParams = z.strictObject({ cost: exprOrNumberSchema });

const questParams = z.strictObject({
  id: refId('quest'),
  /** 接取/推进/完成/失败（§4.5 状态机的效果入口） */
  action: z.enum(['accept', 'advance', 'complete', 'fail']),
  /** advance 时可指定目标阶段（缺省 = 下一阶段） */
  stage: gameIdSchema.optional(),
});

const gotoParams = refId('scene');
const backParams = z.null();
const endingParams = gameIdSchema;
const loopTransitionParams = z.null();

/** 回想/CG/结局/百科/成就标记（§3.3 unlock：seen 域）；gallery 引用场景、cg 引用媒体、achievement 引用成就 */
const unlockParams = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('gallery'), id: refId('scene') }),
  z.strictObject({ kind: z.literal('cg'), id: refId('media') }),
  z.strictObject({ kind: z.literal('ending'), id: gameIdSchema }),
  z.strictObject({ kind: z.literal('codex'), id: gameIdSchema }),
  z.strictObject({ kind: z.literal('achievement'), id: refId('achievement') }),
]);

/** 媒体意图（DD-05）：engine 只产出 intent，播放由 runtime-ui 承担 */
const mediaParams = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('bg'),
    assetId: mediaRefSchema,
    transition: z.enum(['fade', 'cut']).optional(),
  }),
  z.strictObject({
    type: z.literal('cg'),
    assetId: mediaRefSchema,
    transition: z.enum(['fade', 'cut']).optional(),
  }),
  z.strictObject({
    type: z.literal('sprite'),
    assetId: mediaRefSchema,
    transition: z.enum(['fade', 'cut']).optional(),
  }),
  z.strictObject({ type: z.literal('bgm'), assetId: mediaRefSchema }),
  z.strictObject({ type: z.literal('sfx'), assetId: mediaRefSchema }),
]);

/** Toast 通知（FR-UI-07）：文本键 + 插值变量 */
const notifyParams = z.strictObject({
  textKey: textKeySchema,
  vars: z.record(z.string(), exprOrLiteralSchema).optional(),
});

/** 作者扩展调用（DD-08）：fn 必须 'x.<script>.<name>'，存在性校验在脚本注册后（FR-SCR-04） */
const callParams = z.strictObject({
  fn: z.string().min(1),
  with: z.record(z.string(), z.unknown()).optional(),
});

// —— 递归成员（§3.3：check、battle；递归类型环按 zod v4 约定以 interface 锚定） ——

/**
 * 效果序列接口：check/battle 分支子效果的元素类型（递归锚点，延迟展开打破 infer 环）。
 * 有意声明为空接口（纯数组品牌）：类型别名会在展开时重新进入 infer 环，
 * 只有接口的延迟解析能锚定 check/battle ↔ EffectData 的相互递归。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EffectSeq extends Array<EffectData> {}

/** check 指令参数类型契约（§5.1）：类型侧供注册表与编辑器引用，与 checkParams 由赋值检查守护一致 */
export interface CheckEffectParams {
  /** 检定规则 id，缺省 'coc'（§5.1 内置）；'x.<script>.<rule>' 可插拔 */
  rule?: string;
  value: string;
  difficulty?: 'normal' | 'hard' | 'extreme';
  bonusDice?: number | string;
  penaltyDice?: number | string;
  opposedValue?: number | string;
  onSuccess?: EffectData[];
  onFail?: EffectData[];
  onCritical?: EffectData[];
  onFumble?: EffectData[];
}

/** battle 指令参数类型契约（§5.2 jump 类：胜负逃分别路由子效果与跳转） */
export interface BattleEffectParams {
  encounter: string;
  onVictory?: EffectData[];
  onDefeat?: EffectData[];
  onEscape?: EffectData[];
}

/** 子效果序列 schema：运行时经 z.lazy 延迟解析 */
const subEffectListSchema: z.ZodType<EffectSeq> = z.array(z.lazy(() => effectDataSchema));

const checkParams = z.strictObject({
  rule: z.string().min(1).optional(),
  value: exprSchema,
  difficulty: z.enum(['normal', 'hard', 'extreme']).optional(),
  bonusDice: exprOrNumberSchema.optional(),
  penaltyDice: exprOrNumberSchema.optional(),
  opposedValue: exprOrNumberSchema.optional(),
  onSuccess: subEffectListSchema.optional(),
  onFail: subEffectListSchema.optional(),
  onCritical: subEffectListSchema.optional(),
  onFumble: subEffectListSchema.optional(),
});

const battleParams = z.strictObject({
  encounter: z.string().min(1),
  onVictory: subEffectListSchema.optional(),
  onDefeat: subEffectListSchema.optional(),
  onEscape: subEffectListSchema.optional(),
});

/**
 * 指令 id → 参数 schema（宽松结构层的唯一事实源）。
 * 05 号注册表据此实现 EffectInstructionDef.schema（数据加载期与运行期共用），
 * 编辑器 effect-list（§7.5）据此生成参数子表单。
 */
export const effectParamSchemas = {
  set: setParams,
  add: addParams,
  flag: flagParams,
  money: moneyParams,
  give: giveParams,
  take: takeParams,
  equip: equipParams,
  unequip: unequipParams,
  wear: wearParams,
  remove: removeParams,
  set_body: setBodyParams,
  favor: favorParams,
  reputation: reputationParams,
  advance_time: advanceTimeParams,
  quest: questParams,
  check: checkParams,
  battle: battleParams,
  goto: gotoParams,
  back: backParams,
  ending: endingParams,
  loop_transition: loopTransitionParams,
  unlock: unlockParams,
  media: mediaParams,
  notify: notifyParams,
  call: callParams,
} as const;

/** 单条效果指令类型：单键对象联合，键即指令 id（§3.3 EffectData） */
export type EffectData = {
  [K in keyof typeof effectParamSchemas]: { [P in K]: z.output<(typeof effectParamSchemas)[K]> };
}[keyof typeof effectParamSchemas];

/**
 * 内置指令 schema 全集（顺序即 §3.3 注册表清单顺序）；
 * check/battle 以手写接口类型锚定递归（一致性由赋值检查守护）。
 */
export const effectSchemas = [
  z.strictObject({ set: setParams }),
  z.strictObject({ add: addParams }),
  z.strictObject({ flag: flagParams }),
  z.strictObject({ money: moneyParams }),
  z.strictObject({ give: giveParams }),
  z.strictObject({ take: takeParams }),
  z.strictObject({ equip: equipParams }),
  z.strictObject({ unequip: unequipParams }),
  z.strictObject({ wear: wearParams }),
  z.strictObject({ remove: removeParams }),
  z.strictObject({ set_body: setBodyParams }),
  z.strictObject({ favor: favorParams }),
  z.strictObject({ reputation: reputationParams }),
  z.strictObject({ advance_time: advanceTimeParams }),
  z.strictObject({ quest: questParams }),
  z.strictObject({ check: checkParams }) satisfies z.ZodType<{ check: CheckEffectParams }>,
  z.strictObject({ battle: battleParams }) satisfies z.ZodType<{ battle: BattleEffectParams }>,
  z.strictObject({ goto: gotoParams }),
  z.strictObject({ back: backParams }),
  z.strictObject({ ending: endingParams }),
  z.strictObject({ loop_transition: loopTransitionParams }),
  z.strictObject({ unlock: unlockParams }),
  z.strictObject({ media: mediaParams }),
  z.strictObject({ notify: notifyParams }),
  z.strictObject({ call: callParams }),
] as const;

/** 效果指令判别联合 schema：单键对象，键即指令 id */
export const effectDataSchema: z.ZodType<EffectData> = z.union(effectSchemas);

/** 效果指令序列（选项 effects、任务 rewards、Perk effects 等顶层列表用） */
export const effectListSchema = z.array(effectDataSchema);

/** 效果指令序列类型 */
export type EffectList = z.infer<typeof effectListSchema>;
