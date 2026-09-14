import type { GameId, QuestDef } from '@game/shared';
import { canTransition } from './transitions.js';
import type { QuestStateEnum } from './types.js';

/**
 * 任务状态机（设计 §4.5；11 号模块）。
 *
 * 与 runtime 解耦的纯状态机：不持有 GameState/runtime，全部操作经
 * {@link QuestContext} 在调用方提供的事务 draft 上完成（DD-06 状态/流程分界，
 * §1.2 R5）。迁移合法性统一由 {@link canTransition} 的规则表裁决。
 *
 * 依赖注入面：
 * - `defs`：任务目录（QuestDef.stages 阶段序 / acceptIf / failWhen /
 *   requires / conflicts 的唯一来源）；
 * - `questRefs`：加载器 compile 步骤产出的 refs 反查表（`VarRef.path → 任务 id`），
 *   供 evaluateTouched 判定「本次事务触碰了哪些任务的条件」——不轮询的数据基础
 *   （§4.5「与事件系统同一机制」）。
 */
export interface QuestMachineOptions {
  /** 任务目录（缺省空表：接取/推进仍可用，仅不做目录级校验） */
  readonly defs: ReadonlyMap<GameId, QuestDef>;
  /** refs 反查表（compile 步骤 poolIndex.questRefs；缺省 = 不参与触碰评估） */
  readonly questRefs?: ReadonlyMap<string, ReadonlySet<GameId>>;
}

export class QuestMachine {
  readonly #defs: ReadonlyMap<GameId, QuestDef>;

  constructor(options: QuestMachineOptions) {
    this.#defs = options.defs;
  }

  /** 任务目录（只读视图；宿主装配 introspection 用） */
  get defs(): ReadonlyMap<GameId, QuestDef> {
    return this.#defs;
  }

  /** 六态迁移合法性（规则表查询；供调用方在写入前自检） */
  canTransition(from: QuestStateEnum, to: QuestStateEnum): boolean {
    return canTransition(from, to);
  }
}
