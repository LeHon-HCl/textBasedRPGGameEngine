import type { EffectData } from '@game/shared';
import type { HookContext, HookHandler, HookName } from './types.js';

/**
 * 钩子触发适配层（设计 §5.9，23 号 B 线；2026-09-25 四类挂点裁定）。
 *
 * 四类挂点分布在四个子系统（time / loop / battle / persistence），本文件的
 * 职责是把「引擎侧的触发点」翻译成「脚本侧的统一形态」：
 *
 * | 挂点 | 触发时机 | 引擎侧接入面 |
 * |---|---|---|
 * | `before_rollover` / `slot_advance` / `day_rollover` | 时间管线步骤 0 / 1.5 / 4 | `TimeHooks` 三槽（本文件构造 provider） |
 * | `loop_transition` | 周目切换**后**（新状态已就位） | `runLoopTransition` 返回前调用 |
 * | `battle_round_end` | **整回合结束**（全部单位行动完、下一轮前） | `BattleSession` 回合边界回调 |
 * | `load_complete` | **全部恢复完成后**（迁移 → 周目恢复 → 状态就位） | `SaveService.load` 返回前调用 |
 *
 * 设计要点：
 * - 本模块**只做形态转换**（引擎事件 → HookContext + 收集效果），不持有
 *   HookRegistry（运行期注入，避免加载期/运行期耦合）；
 * - 时间钩子返回 `EffectData[]` 供管线合并进同一次事务（TimeStepProvider 契约）；
 * - 非时间钩子的效果由调用方（宿主）经 ScriptHost.transaction 提交——本文件
 *   的 `collectHookEffects` 同时承担两种出口。
 */

/** 钩子触发器的运行期依赖（宿主装配时注入） */
export interface HookTriggerDeps {
  /**
   * 触发钩子（收集效果；由宿主注入 HookRegistry.fire 的包装）。
   * 返回 handler 链累计的效果指令（按注册序拼接）。
   */
  readonly fire: (hook: HookName, ctx: HookContext) => readonly EffectData[];
}

/**
 * 收集某钩子的全部效果（按注册序拼接，供时间管线合并进同一事务）。
 *
 * 与 `HookRegistry.fire` 的差异：本函数**不执行**事务，只返回效果——时间管线
 * 的契约是「钩子只收集数据，执行由 runtime.exec 统一完成」（一次推进 = 一个
 * undo 点）。非时间钩子的调用方可直接用返回值调 `ScriptHost.transaction`。
 */
export function collectHookEffects(
  deps: HookTriggerDeps,
  hook: HookName,
  ctx: Omit<HookContext, 'hook'>,
): readonly EffectData[] {
  return deps.fire(hook, { hook, ...ctx });
}

/**
 * 为时间管线构造三个钩子 provider（`TimeHooks` 的槽位适配）。
 *
 * 注意与既有 TimeStepProvider 的关系：管线契约是「provider 返回效果列表」——
 * 本函数返回的 provider 正是把脚本钩子的效果透传给管线（进同一次事务）。
 */
export function createScriptTimeHooks(deps: HookTriggerDeps): {
  beforeRollover: (ctx: { slots: number; crossedDay: boolean; crossedWeek: boolean; crossedMonth: boolean }) => EffectData[];
  slotAdvance: (ctx: { slots: number; crossedDay: boolean; crossedWeek: boolean; crossedMonth: boolean }) => EffectData[];
  dayRollover: (ctx: { slots: number; crossedDay: boolean; crossedWeek: boolean; crossedMonth: boolean }) => EffectData[];
} {
  const provider = (hook: HookName) => (ctx: {
    slots: number;
    crossedDay: boolean;
    crossedWeek: boolean;
    crossedMonth: boolean;
  }): EffectData[] => [
    ...collectHookEffects(deps, hook, {
      time: {
        slots: ctx.slots,
        crossedDay: ctx.crossedDay,
        crossedWeek: ctx.crossedWeek,
        crossedMonth: ctx.crossedMonth,
      },
    }),
  ];
  return {
    beforeRollover: provider('before_rollover'),
    slotAdvance: provider('slot_advance'),
    dayRollover: provider('day_rollover'),
  };
}

/**
 * 战斗回合结束钩子的触发入口（`BattleSession` 在整回合边界调用）。
 *
 * 语义（裁定）：**整回合结束**——全部单位行动完、下一轮开始之前，每轮一次。
 * 与状态 tick（新回合开始）相邻互补：tick 管状态衰减，本钩子管事件（统计/增援/
 * 回合末判定）。
 *
 * @param round 当前回合序号（从 1 起；即刚结束的那一轮）
 */
export function fireBattleRoundEnd(
  deps: HookTriggerDeps,
  round: number,
): readonly EffectData[] {
  return collectHookEffects(deps, 'battle_round_end', { round });
}

/**
 * 周目切换完成钩子的触发入口（`runLoopTransition` 末尾调用）。
 *
 * 语义（裁定）：**切换后**——新状态已就位，脚本可初始化周目专属数据。
 *
 * @param loop 切换后的周目序号
 */
export function fireLoopTransition(
  deps: HookTriggerDeps,
  loop: number,
): readonly EffectData[] {
  return collectHookEffects(deps, 'loop_transition', { loop });
}

/**
 * 读档完成钩子的触发入口（`SaveService.load` 末尾调用）。
 *
 * 语义（裁定）：**全部恢复完成后**（迁移 → 周目恢复 → 状态就位，DD-10 末环）
 * ——脚本据此重建自己的缓存/派生数据。
 */
export function fireLoadComplete(deps: HookTriggerDeps): readonly EffectData[] {
  return collectHookEffects(deps, 'load_complete', {});
}

/** 钩子处理器注册的便捷类型（宿主装配面） */
export type { HookHandler };
