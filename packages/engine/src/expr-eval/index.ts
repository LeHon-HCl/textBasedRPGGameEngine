/**
 * expr-eval 子系统出口（表达式语言与求值器，设计 §3.2；03 号模块）。
 *
 * 经 `@game/engine` 根出口对外发布（§10.4 导出约定）；子系统内部仅此文件
 * 对外暴露实现，横向子系统不得深入本目录路径（DD-06）。
 * 类型（ExprNode / CompiledExpr / ExprScope / EvalContext / ExprFunctionDef 等）
 * 的唯一来源是 `@game/shared`（设计 §10.4），此处不重复导出。
 */
export { parseExpr } from './parse.js';
export { compileExpr, exprCompileError } from './compile.js';
export type { CompileOptions } from './compile.js';
export { EXPR_ROOTS } from './paths.js';
