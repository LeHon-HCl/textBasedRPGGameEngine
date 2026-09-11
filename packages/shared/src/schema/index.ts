/**
 * Schema 体系统一出口（设计 §2.4：游戏包全部数据域的 Zod schema 单一来源）。
 *
 * - 每个数据域一个文件，导出 Zod schema 并 `z.infer` 出 TS 类型（NFR-12）；
 * - 包外一律经 `@game/shared` 根出口消费，不深入本目录路径（设计 §10.4 导出约定）；
 * - schema 变更遵循「只增不改」（NFR-15），破坏性变更会红 02 号模块的
 *   JSON Schema 快照守护测试，并必须伴随 schemaVersion 与迁移方案（FR-MIGR-01）。
 */

// ---- 基础构件（§2.1 ID 与引用、表达式原文、语义化版本） --------------------
export {
  exprOrNumberSchema,
  exprSchema,
  gameIdSchema,
  mediaRefSchema,
  semverSchema,
  textKeySchema,
} from './common.js';

// ---- Manifest（包根清单） ---------------------------------------------------
export { manifestSchema } from './manifest.js';
export type { Manifest } from './manifest.js';
