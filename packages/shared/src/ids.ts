import { z } from 'zod';

/**
 * ID 与基础类型（设计 §2.1）。
 *
 * 这些类型是全部模块的类型地基（D3）：
 * - GameId：游戏内容主键，仅 [a-z][a-z0-9_]*，加载期做唯一性校验；
 * - TextKey：文本键（数据与文本分离，D4），如 'npc.raven.greet'；
 * - Lang：语言代码 BCP-47，如 'zh-CN'；
 * - ExprSource：表达式原文，编译后为 CompiledExpr（§2.3，03 号模块）。
 */
/** 游戏内容 ID：场景/物品/NPC/任务/成就等主键。仅 [a-z][a-z0-9_]*，加载期唯一性校验 */
export type GameId = string;

/** 文本键：命名空间路径，如 'npc.raven.greet'（数据与文本分离，D4） */
export type TextKey = string;

/** 语言代码 BCP-47，如 'zh-CN' */
export type Lang = string;

/** 表达式原文（编译后为 CompiledExpr，设计 §2.3） */
export type ExprSource = string;

/**
 * 实体引用标记：schema 元数据用，迁移 redirects 按 kind 定向改写（设计 §5.7，DD-07 配套）。
 */
export type RefKind =
  | 'scene'
  | 'item'
  | 'npc'
  | 'quest'
  | 'achievement'
  | 'faction'
  | 'area'
  | 'location'
  | 'media'
  | 'text';

/**
 * 实体引用字段的 Zod 辅助器（设计 §2.1 约定）。
 *
 * 所有跨存档引用字段在 schema 中以 `refId(RefKind)` 声明：
 * - 内部 = `z.string().meta({ refKind })`，元数据登记进 zod globalRegistry；
 * - 加载器（06 号）据此建引用索引（DANGLING_REF 检查）；
 * - 迁移器（21 号）据此按 kind 定向改写 redirects。
 */
export function refId<T extends RefKind>(kind: T): z.ZodString {
  return z.string().meta({ refKind: kind });
}
