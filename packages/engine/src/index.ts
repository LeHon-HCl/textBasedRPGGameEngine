/**
 * @game/engine 公开 API 唯一出口（导出约定，设计 §10.4 / NFR-13）。
 *
 * 约定：
 * - 包外只允许从包名 `@game/engine` 导入，禁止深入包内文件路径；
 * - 各子系统（state / runtime / effects / loader / i18n / narrative / ...）
 *   的公开类型与函数先在自身目录中定义，再经此处统一 re-export；
 * - 子系统之间禁止横向 import（DD-06），只允许「事务 + EngineEvent +
 *   时间管线编排」三种交互方式（设计 §1.2 R5）；
 * - engine 只依赖 shared，禁止 React 与 DOM API（设计 §1.2 R2，lint 强制）；
 * - 公开 API 文档化并遵循语义化版本（NFR-13）。
 */
export {};
