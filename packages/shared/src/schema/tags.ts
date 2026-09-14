import { z } from 'zod';
import { gameIdSchema, textKeySchema } from './common.js';

/**
 * 内容分级标签定义（设计 §2.4 ContentTagsDef；data/content-tags.yaml，FR-CGRD-01）。
 *
 * 标签语义与游戏整体分级声明由作者定义并自负内容责任；manifest.contentTags 声明
 * 游戏使用的标签集合，场景/事件/选项等以 id 引用（加载期校验已声明，FR-CGRD-02）；
 * 玩家开关 defaultOn 决定过滤初始态（§5.8 ContentFilter）。
 */

export const contentTagDefSchema = z.strictObject({
  id: gameIdSchema,
  nameKey: textKeySchema,
  /** 玩家设置的默认开启态（true = 默认显示该类内容） */
  defaultOn: z.boolean(),
});

export type ContentTagDef = z.infer<typeof contentTagDefSchema>;

/** 内容分级标签定义（设计 §2.4 / §5.8）：{@link ContentTagsDef} 的校验器 */
export const contentTagsDefSchema = z.strictObject({
  tags: z.array(contentTagDefSchema),
});

export type ContentTagsDef = z.infer<typeof contentTagsDefSchema>;
