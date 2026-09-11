/**
 * effects 子系统出口（效果指令注册表与内置指令，设计 §3.3；05 号模块）。
 *
 * 经 `@game/engine` 根出口对外发布（§10.4 导出约定）；子系统内部仅此文件
 * 对外暴露实现，横向子系统不得深入本目录路径（DD-06）。
 * - 注册表机制（05 任务 A1）：EffectRegistry 实现 04 号 EffectExecutor；
 * - 内置指令（05 任务 A3/B 组）：经 createBuiltinEffectRegistry 装配全量
 *   25 个固定 id（§3.3 表格）；
 * - 判定规则契约（§5.1）：CheckRule / CheckRuleResolver 由 15 号实现注入。
 */
export { EffectRegistry } from './registry.js';
export type {
  BuiltinDefContext,
  CheckRequest,
  CheckResult,
  CheckRule,
  CheckRuleResolver,
  EffectExecuteContext,
  EffectInstructionDef,
  EffectRegistryOptions,
  ErasedEffectDef,
  ReputationBounds,
  TouchReport,
} from './types.js';
