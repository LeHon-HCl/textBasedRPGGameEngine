import { z } from 'zod';
import { refId } from '../ids.js';
import { gameIdSchema, semverSchema, textKeySchema } from './common.js';

/**
 * 游戏包清单（设计 §2.4 Manifest，包根 manifest.yaml）。
 *
 * - 版本三元组 gameVersion / schemaVersion / minEngineVersion（FR-MIGR-01，DD-07：
 *   全包单一 schemaVersion 递增，不按数据域拆分）；
 * - mainLang + langs（FR-L10N-02 语言包结构：locales/<lang>/ 与键命名空间目录镜像）；
 * - contentTags 声明游戏使用的内容分级标签集合（FR-CGRD-01，标签定义在 content-tags.yaml）；
 * - contentWarning：首启内容向导的警告页文案键（FR-CGRD-04；§2.4 字段表漏列，
 *   2026-09-14 勘误补齐——§6.5 首启向导明确引用该键）；
 * - redirects：旧 ID → 新 ID 映射（FR-MIGR-05），迁移器按 refId(kind) 元数据定向改写（§5.7）；
 * - credits：署名与许可声明（FR-MEDIA-07）。
 */
export const manifestSchema = z
  .strictObject({
    /** 游戏包主键 */
    gameId: gameIdSchema,
    /** 入口场景（FR-NARR-01 新游戏起点） */
    entryScene: refId('scene'),
    /** 主语言（BCP-47，如 'zh-CN'），缺失译文回退目标（FR-L10N-06） */
    mainLang: z.string().min(1),
    /** 支持语言列表（FR-L10N-02） */
    langs: z.array(z.string().min(1)).min(1),
    /** 游戏使用的内容分级标签 id 集合（FR-CGRD-01） */
    contentTags: z.array(gameIdSchema),
    /**
     * 首启内容警告页文案键（FR-CGRD-04，§6.5 首启向导；可选——缺省不展示警告页）。
     * 指向 locales 中的文本键（含游戏整体分级描述与提示语）。
     */
    contentWarning: textKeySchema.optional(),
    /** 游戏版本（FR-MIGR-01） */
    gameVersion: semverSchema,
    /** 全包单一 schema 版本（FR-MIGR-01、DD-07） */
    schemaVersion: z.number().int().min(1),
    /** 最低引擎版本：低于此版本的引擎拒绝加载（FR-MIGR-02） */
    minEngineVersion: semverSchema,
    /** 旧 ID → 新 ID 映射（FR-MIGR-05），键与值均为历史合法 GameId */
    redirects: z.record(gameIdSchema, gameIdSchema),
    /** 署名与许可声明（FR-MEDIA-07） */
    credits: z.string().min(1),
  })
  .refine((m) => m.langs.includes(m.mainLang), {
    message: 'mainLang 必须包含在 langs 中（FR-L10N-02 主语言即回退语言）',
    path: ['mainLang'],
  });

/** 游戏包清单类型（§2.4） */
export type Manifest = z.infer<typeof manifestSchema>;
