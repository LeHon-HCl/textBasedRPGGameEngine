import { z } from 'zod';
import { gameIdSchema } from './common.js';

/**
 * 身体定义（设计 §2.4 BodyDef；data/body.yaml，FR-BODY）。
 *
 * - 部位模板完全数据驱动（引擎中立，不预设种族/形态语义）：部位 → 取值集 → 默认值；
 * - set_body 指令校验 part/value 必须在本定义内（§4.8，违例 = EFFECT_FAILED）；
 * - pronouns 按 rule=by_part 以指定部位的当前值映射代词形式（FR-BODY-04），
 *   编译为插值变量注入器（§4.8）。
 */

export const bodyPartDefSchema = z
  .strictObject({
    /** 该部位的合法取值集（值仅是数据，语义由游戏表达式与文本赋予） */
    values: z.array(z.string().min(1)).min(1),
    default: z.string().min(1),
  })
  .refine((p) => p.values.includes(p.default), {
    message: 'body 部位默认值必须属于 values',
    path: ['default'],
  });

export type BodyPartDef = z.infer<typeof bodyPartDefSchema>;

/** 代词规则（设计 §2.4 / §4.8）：{@link PronounsDef} 的校验器 */
export const pronounsDefSchema = z.strictObject({
  /** 代词规则（v1 内置 by_part：按部位当前值映射，§4.8） */
  rule: z.enum(['by_part']),
  /** 驱动代词映射的部位 */
  part: gameIdSchema,
  /** 部位取值 → 代词形式数组（[主语, 宾语, 所有格]，FR-BODY-04） */
  map: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)),
});

export type PronounsDef = z.infer<typeof pronounsDefSchema>;

/** 身体定义（设计 §2.4 BodyDef）：部位值域与默认值，{@link BodyDef} 的校验器 */
export const bodyDefSchema = z.strictObject({
  /** bodyPart → 部位定义（FR-BODY-01） */
  parts: z.record(gameIdSchema, bodyPartDefSchema),
  /** 代词规则（缺省 = 游戏不使用代词插值） */
  pronouns: pronounsDefSchema.optional(),
});

export type BodyDef = z.infer<typeof bodyDefSchema>;
