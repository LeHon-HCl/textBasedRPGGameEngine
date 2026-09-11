import { effectParamSchemas } from '@game/shared';
import { eraseDef } from '../types.js';
import type { EffectInstructionDef, ErasedEffectDef, TouchReport } from '../types.js';
import type { JumpTarget } from '../../runtime/index.js';

/**
 * 流程类内置指令（设计 §3.3「goto / back / ending / loop_transition | 流程跳转 |
 * 仅产生 jumps，不改状态」；05 任务 B4）。
 *
 * - **状态层 / 流程层分界**（§3.3 设计要点）：四条指令的目标在解析期由参数
 *   静态可知，经 def.jumps 声明汇入 ExecOutcome.jumps，由叙事运行时（§4.2）
 *   消费——execute 阶段零状态写入、零事件（分界测试断言 state 原对象不变、
 *   patches 与 events 皆空）；
 * - `back` 仅产 `{type: 'back'}` 目标，实际回退点由叙事运行时的回滚栈解释；
 * - `loop_transition` 仅产 `{type: 'loopTransition'}` 目标，周目切换归 19 号。
 */

const NO_TOUCH: TouchReport = { reads: [], writes: [] };

/** 流程类指令全集（id 固定，§3.3 表格；执行体恒为无副作用空操作） */
export function createFlowDefs(): ErasedEffectDef[] {
  const gotoDef: EffectInstructionDef<string> = {
    id: 'goto',
    schema: effectParamSchemas.goto,
    touch: (): TouchReport => NO_TOUCH,
    execute: () => {},
    jumps: (scene): readonly JumpTarget[] => [{ type: 'scene', scene }],
  };

  const backDef: EffectInstructionDef<null> = {
    id: 'back',
    schema: effectParamSchemas.back,
    touch: (): TouchReport => NO_TOUCH,
    execute: () => {},
    jumps: (): readonly JumpTarget[] => [{ type: 'back' }],
  };

  const endingDef: EffectInstructionDef<string> = {
    id: 'ending',
    schema: effectParamSchemas.ending,
    touch: (): TouchReport => NO_TOUCH,
    execute: () => {},
    jumps: (ending): readonly JumpTarget[] => [{ type: 'ending', ending }],
  };

  const loopTransitionDef: EffectInstructionDef<null> = {
    id: 'loop_transition',
    schema: effectParamSchemas.loop_transition,
    touch: (): TouchReport => NO_TOUCH,
    execute: () => {},
    jumps: (): readonly JumpTarget[] => [{ type: 'loopTransition' }],
  };

  return [eraseDef(gotoDef), eraseDef(backDef), eraseDef(endingDef), eraseDef(loopTransitionDef)];
}
