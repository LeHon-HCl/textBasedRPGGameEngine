import { EngineError } from '@game/shared';
import type { GameId, QuestDef } from '@game/shared';
import { canTransition, transitionVias } from './transitions.js';
import type { QuestContext, QuestStateEnum } from './types.js';

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

  /**
   * 接取任务（available/undiscovered → active，§4.5；FR-QUEST-04）。
   *
   * 校验顺序（状态门优先，避免无谓求值）：
   * 1. 状态门：当前态须能迁移到 active（undiscovered / available），否则拒绝；
   * 2. conflicts：任一互斥任务处于 active / ready_to_submit → 拒绝（进行中互斥）；
   * 3. requires：任一前置任务未 done → 拒绝；
   * 4. acceptIf：表达式为假 → 拒绝。
   *
   * 副作用：写入 active + 首阶段 + startedDay + 空 objectives；emit
   * `quest_state_changed`。拒绝抛 `EFFECT_FAILED{op:'quest', quest, detail}`
   * （原因可读，UI 错误卡片直接展示）。无目录时仅跳过 2–4 步（05 号兼容）。
   */
  accept(ctx: QuestContext, questId: GameId): void {
    const def = this.#defs.get(questId);
    const current = ctx.quests[questId];
    const from: QuestStateEnum = current?.state ?? 'undiscovered';
    // 表驱动状态门：仅 accept 触发方式允许迁入 active（active→active 虽合法但
    // 属 stage 触发，不构成「可接取」）
    if (!transitionVias(from, 'active').includes('accept')) {
      throw this.#reject(`任务 '${questId}' 当前状态 ${from}，不可接取`, questId);
    }
    if (def !== undefined) {
      for (const conflict of def.conflicts ?? []) {
        const state = ctx.quests[conflict]?.state;
        if (state === 'active' || state === 'ready_to_submit') {
          throw this.#reject(
            `任务 '${questId}' 与进行中的互斥任务 '${conflict}'（${state}）冲突，不可接取`,
            questId,
          );
        }
      }
      for (const required of def.requires ?? []) {
        if (ctx.quests[required]?.state !== 'done') {
          throw this.#reject(
            `任务 '${questId}' 的前置任务 '${required}' 尚未完成，不可接取`,
            questId,
          );
        }
      }
      if (def.acceptIf !== undefined && !ctx.evalCondition(def.acceptIf)) {
        throw this.#reject(
          `任务 '${questId}' 接取条件不满足（acceptIf: ${def.acceptIf}）`,
          questId,
        );
      }
    }
    const stage = def?.stages[0]?.id;
    ctx.quests[questId] = {
      state: 'active',
      objectives: {},
      startedDay: ctx.state.world.time.day,
      ...(stage !== undefined ? { stage } : {}),
    };
    ctx.emit({ type: 'quest_state_changed', quest: questId, from, to: 'active' });
  }

  /** 任务级拒绝（EFFECT_FAILED；where.op='quest' + quest 定位 + detail 可读原因） */
  #reject(detail: string, quest: GameId): EngineError {
    return new EngineError({
      code: 'EFFECT_FAILED',
      where: { op: 'quest', quest, detail },
      messageKey: 'error.effects.instructionFailed',
    });
  }
}
