import { EffectRegistry } from '../registry.js';
import type { BuiltinDefContext, EffectRegistryOptions, ErasedEffectDef } from '../types.js';
import { createCallDef } from './system.js';

/**
 * 内置指令装配（设计 §3.3 内置指令注册表，FR-NARR-03）。
 *
 * - `createBuiltinEffectDefs`：内置指令定义全集（id 固定，§3.3 表格）。
 *   call 自 05 任务 A3 登记；状态类 / 物品类 / 关系类 / 流程类 / 系统类 /
 *   对抗类按任务书 B 组顺序逐批登记，全量 25 个于 05 任务 B6 齐备
 *   （指令矩阵测试守护）；check/battle/set_body 由对抗类一并登记；
 * - `createBuiltinEffectRegistry`：构造装配内置指令的注册表（05 号正式
 *   EffectExecutor）。目录与配置（物品 / NPC / 阵营 / 身体 / 任务目录、
 *   容量、判定解析器）经 options 注入后由各指令读取。
 */

/** 组装内置指令全集（lookup 延迟绑定：call 转发在执行期才解析目标） */
export function createBuiltinEffectDefs(ctx: BuiltinDefContext): ErasedEffectDef[] {
  return [createCallDef(ctx)];
}

/** 构造装配全量内置指令的效果注册表（§3.3；GameRuntime 的 EffectExecutor 注入面） */
export function createBuiltinEffectRegistry(options: EffectRegistryOptions = {}): EffectRegistry {
  // lookup 延迟绑定：call 转发在执行期才解析目标，届时 registry 已完成装配
  const registry: EffectRegistry = new EffectRegistry(
    options,
    createBuiltinEffectDefs({
      lookup: (id: string): ErasedEffectDef | undefined => registry.lookup(id),
      options,
    }),
  );
  return registry;
}
