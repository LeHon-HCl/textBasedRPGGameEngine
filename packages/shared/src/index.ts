/**
 * @game/shared 公开 API 唯一出口（导出约定，设计 §10.4）。
 *
 * 约定：
 * - 包外只允许从包名 `@game/shared` 导入，禁止深入包内文件路径；
 * - 各模块（ids / errors / expr / rng / schema/ / validation/）的公开类型与函数
 *   先在自身文件中定义，再经此处统一 re-export；
 * - shared 是类型与规则的单一来源（D3）：零运行时依赖，不 import 任何其他包；
 * - 公开 API 遵循语义化版本；schema 变更必须伴随版本与迁移方案（NFR-12）。
 */
export {};
