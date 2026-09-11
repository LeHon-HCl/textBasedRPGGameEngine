import { z } from 'zod';
import { refId } from '../ids.js';
import { gameIdSchema, exprSchema, mediaRefSchema, textKeySchema } from './common.js';
import { effectListSchema } from './effects.js';

/**
 * 场景定义（设计 §2.4 SceneDef；DD-02：一场景一文件 data/scenes/<areaId>/<sceneId>.yaml）。
 *
 * - 文本一律键引用（D4）；段落宏（if/first/again/random，FR-NARR-04）由 08 号
 *   叙事运行时在 renderList 惰性展开，schema 层先承载「键 + 显示条件」最小面；
 * - 选项 = 显示条件/置灰条件/一次性/内容标签/效果序列/跳转（FR-NARR-02）；
 * - goto 与 effects[].goto 的悬空引用由加载器 crossRef 检查（§3.4 步骤 4，不在此阻断）。
 */

/** 叙事段落：文本键 + 可选显示条件（条件不满足的段落不进入渲染列表） */
export const segmentSchema = z.strictObject({
  key: textKeySchema,
  showIf: exprSchema.optional(),
});

export type SegmentDef = z.infer<typeof segmentSchema>;

/** 选项（FR-NARR-02）：条件分支、一次性隐藏、效果序列与跳转 */
export const choiceSchema = z.strictObject({
  id: gameIdSchema,
  textKey: textKeySchema,
  /** 显示条件：不满足则整个选项不出现 */
  showIf: exprSchema.optional(),
  /** 置灰条件：选项可见但不可用（FR-NARR-02） */
  disabledIf: exprSchema.optional(),
  disabledReasonKey: textKeySchema.optional(),
  /** 一次性选项：选过即隐藏，已选记录存 world.flags（§4.2，键 __choice.<scene>.<choice>） */
  once: z.boolean().optional(),
  /** 内容分级标签（FR-CGRD-02：选项可打标签） */
  tags: z.array(gameIdSchema).optional(),
  /** 效果序列（§3.3 指令联合） */
  effects: effectListSchema.optional(),
  /** 跳转目标场景（纯跳转便捷字段；复杂分支写在 effects 里） */
  goto: refId('scene').optional(),
});

export type ChoiceDef = z.infer<typeof choiceSchema>;

/** 场景级媒体绑定（FR-NARR-01：背景图 + BGM，DD-05） */
export const sceneMediaSchema = z.strictObject({
  bg: mediaRefSchema.optional(),
  bgm: mediaRefSchema.optional(),
});

export const sceneDefSchema = z.strictObject({
  id: gameIdSchema,
  /** 所属区域（与目录 <areaId>/ 不一致时加载器 warning，§3.4） */
  area: refId('area'),
  /** 进入条件（FR-XPLR-04 条件型入口） */
  entry: z.strictObject({ require: exprSchema }).optional(),
  segments: z.array(segmentSchema),
  choices: z.array(choiceSchema),
  media: sceneMediaSchema.optional(),
  /** 内容分级标签（FR-CGRD-02） */
  tags: z.array(gameIdSchema).optional(),
});

export type SceneDef = z.infer<typeof sceneDefSchema>;
