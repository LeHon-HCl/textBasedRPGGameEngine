import { EffectRegistry } from '../registry.js';
import type { BuiltinDefContext, EffectRegistryOptions, ErasedEffectDef } from '../types.js';
import { createFlowDefs } from './flow.js';
import { createAdversarialDefs } from './adversarial.js';
import { createShopDefs } from './shop.js';
import { createItemDefs } from './items.js';
import { createNpcDefs } from './npcs.js';
import { createRelationDefs } from './relations.js';
import { createStateDefs } from './state.js';
import { createSystemDefs } from './system.js';
import { createCallDef } from './system.js';
import { createEventDefs } from '../../events/instruction.js';

/**
 * 内置指令装配（设计 §3.3 内置指令注册表，FR-NARR-03）。
 *
 * - `createBuiltinEffectDefs`：内置指令定义全集（id 固定，§3.3 表格）。
 *   call 自 05 任务 A3 登记；状态类自 B1 登记；物品类自 B2 登记；关系类自
 *   B3 登记；流程类自 B4 登记；系统类（call 除外）自 B5 登记、对抗类与
 *   set_body 自 B6 登记——至此全量 25 个固定 id 齐备（指令矩阵测试守护）；
 *   17 号新增 `shop`（经济）与 `meet`（NPC 相识标记，relations 内），
 *   指令矩阵的固定 id 断言随之扩展到 27；
 * - `createBuiltinEffectRegistry`：构造装配内置指令的注册表（05 号正式
 *   EffectExecutor）。目录与配置（物品 / NPC / 阵营 / 身体 / 任务目录、
 *   容量、判定解析器）经 options 注入后由各指令读取。
 */

/** 组装内置指令全集（lookup 延迟绑定：call 转发在执行期才解析目标） */
export function createBuiltinEffectDefs(ctx: BuiltinDefContext): ErasedEffectDef[] {
  return [
    createCallDef(ctx),
    ...createSystemDefs(ctx.options),
    ...createStateDefs(),
    ...createItemDefs(ctx.options),
    ...createRelationDefs(ctx.options),
    ...createFlowDefs(),
    ...createAdversarialDefs(ctx.options),
    ...createShopDefs(),
    ...createNpcDefs(ctx.options),
    ...createEventDefs(ctx.options),
  ];
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
