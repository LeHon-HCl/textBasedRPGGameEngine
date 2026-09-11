import { z } from 'zod';
import { exprSchema, gameIdSchema, textKeySchema } from './common.js';

/**
 * 结局定义（设计 §2.4 EndingDef；data/endings.yaml，FR-LOOP-02/FR-GAL-02）。
 *
 * - reachWhen 达成后经 ending 指令 / loop_transition 进入周目转场（§5.5）；
 * - nextLoop=true 标记进入下一周目；final 标记终局（二者由游戏语义自定）；
 * - 结局 id 入 Profile.endings 跨存档收集（FR-GAL-02）；id 不在 RefKind 引用面内，
 *   迁移改写经 Profile 域的 redirects 处理（FR-MIGR-06）。
 */

export const endingGalleryInfoSchema = z.strictObject({
  /** 图鉴标题键（缺省复用 nameKey） */
  titleKey: textKeySchema.optional(),
  /** 未达成时的提示文本键（FR-GAL-02 占位与提示） */
  hintKey: textKeySchema.optional(),
});

export type EndingGalleryInfo = z.infer<typeof endingGalleryInfoSchema>;

export const endingDefSchema = z.strictObject({
  id: gameIdSchema,
  /** 结局名（图鉴/转场展示） */
  nameKey: textKeySchema,
  /** 达成条件表达式 */
  reachWhen: exprSchema,
  /** 结局正文文本键 */
  textKey: textKeySchema,
  /** 达成后进入下一周目（缺省 = 普通结局回主菜单语义由游戏定） */
  nextLoop: z.boolean().optional(),
  /** 终局标记（图鉴 special 展示策略由游戏定） */
  final: z.boolean().optional(),
  galleryInfo: endingGalleryInfoSchema.optional(),
});

export type EndingDef = z.infer<typeof endingDefSchema>;
