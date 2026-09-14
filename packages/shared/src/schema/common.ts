import { z } from 'zod';
import { GAME_ID_PATTERN, refId } from '../ids.js';

/**
 * Schema 体系共用基础校验器（设计 §2.1 / §2.4）。
 *
 * 各数据域 schema 由此取GameId/文本键/表达式等基础构件，保证规则只有一份：
 * - gameIdSchema 复用 ids.ts 的 GAME_ID_PATTERN（[a-z][a-z0-9_]*）；
 * - textKeySchema 标注 refKind='text'（RefKind 全集见 §2.1），加载器 crossRef
 *   据此建文本键引用索引（§3.4 步骤 4、dangling-text-key 规则）；
 * - exprSchema 只做「非空字符串」结构校验，编译期校验归 03 号表达式求值器（DD-01）。
 */

/** GameId 主键：仅 [a-z][a-z0-9_]*（规则唯一来源：ids.ts GAME_ID_PATTERN，§2.1） */
export const gameIdSchema = z.string().regex(GAME_ID_PATTERN);

/** 文本键（D4：数据与文本分离）：命名空间路径，如 'npc.raven.greet'；refKind='text' */
export const textKeySchema = z.string().min(1).meta({ refKind: 'text' });

/** 表达式原文（ExprSource，§2.3）：编译后为 CompiledExpr；语法校验在加载期编译时执行 */
export const exprSchema = z.string().min(1);

/** 媒体资产引用（RefKind 'media'，DD-05）：存在性校验归加载器 crossRef（§3.4 步骤 4） */
export const mediaRefSchema = refId('media');

/**
 * 背景/BGM 绑定（FR-MEDIA-02，DD-05）：场景与区域共用同一形态。
 * 区域级为场景级的**回落层**（场景未声明对应项时取区域值，24 号解析器）。
 * 定义放 common 保证「绑定语义只有一份」——两处独立定义迟早漂移。
 */
export const mediaBindingSchema = z.strictObject({
  bg: mediaRefSchema.optional(),
  bgm: mediaRefSchema.optional(),
});

/** 语义化版本号（FR-MIGR-01 三层版本记录）：major.minor.patch，可带 prerelease/build 后缀 */
export const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+)?(?:\+[0-9A-Za-z-]+)?$/);

/** 表达式或数值字面量：效果参数、冷却时长等「运行期才求值」的字段复用（§3.3） */
export const exprOrNumberSchema = z.union([exprSchema, z.number()]);
