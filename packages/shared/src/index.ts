/**
 * @game/shared 公开 API 唯一出口（导出约定，设计 §10.4）。
 *
 * 约定：
 * - 包外只允许从包名 `@game/shared` 导入，禁止深入包内文件路径；
 * - 各模块（ids / errors / expr / rng / schema/ / validation/）的公开类型与函数
 *   先在自身文件中定义，再经此处统一 re-export；
 * - shared 是类型与规则的单一来源（D3）：零运行时依赖（仅 zod，设计 §2），
 *   不 import 任何其他包；
 * - 公开 API 遵循语义化版本；schema 变更必须伴随版本与迁移方案（NFR-12）。
 *
 * 公开 API 冻结清单（semver 标注，完成定义第二条）：
 * - 版本策略：0.x 阶段为实验期，任何导出的新增/移除/改名都可能破坏兼容；
 *   1.0 起严格 semver——新增导出为 minor，移除或改名为 major；
 * - 每个导出以 `@since` 标注引入版本，作为冻结基线的判定依据。
 */

// ---- ids（设计 §2.1：ID 与基础类型） --------------------------------------
/** @since 0.1.0 */
export type { ExprSource, GameId, Lang, RefKind, TextKey } from './ids.js';
/** @since 0.1.0 */
export { refId } from './ids.js';
