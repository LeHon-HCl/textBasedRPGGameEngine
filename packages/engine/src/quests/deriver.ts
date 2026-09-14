import { createRng } from '@game/shared';
import type { CompiledExpr, ExprFunctionRegistry, Rng } from '@game/shared';
import { buildExprScope, DEFAULT_META_VIEW, defaultTimeView } from '../state/index.js';
import type { GameState } from '../state/index.js';
import type { TransactionDeriveContext, TransactionDeriver } from '../runtime/index.js';
import {
  compileExpr,
  createBuiltinFunctionRegistry,
  evalExpr,
  truthy,
} from '../expr-eval/index.js';
import type { QuestMachine } from './quest-machine.js';
import type { QuestContext } from './types.js';

/**
 * 任务状态机的事务后置派生接线（§4.5；11 任务 3）。
 *
 * 把 {@link QuestMachine.evaluateTouched} 注册为 GameRuntime 的
 * {@link TransactionDeriver}：每次事务提交前，以事务触碰路径为脏标记评估受影响
 * 任务——只对 refs 命中的任务求值（不轮询，NFR-02）。
 *
 * 装配示例：
 * ```ts
 * const machine = new QuestMachine({ defs, questRefs: definition.poolIndex.questRefs });
 * new GameRuntime({ ...opts, derivers: [createQuestDeriver(machine)] });
 * ```
 */

/** 条件表达式求值器（原文 + 只读状态 → 真值化） */
export type QuestConditionEvaluator = (source: string, state: Readonly<GameState>) => boolean;

/** 派生器与缺省求值器选项 */
export interface QuestDeriverOptions {
  /** 表达式函数注册表（缺省 = 内置 20 函数；应与运行时的注册表同源） */
  readonly functionRegistry?: ExprFunctionRegistry;
  /** 条件求值器（缺省 = {@link createQuestConditionEvaluator}） */
  readonly evaluator?: QuestConditionEvaluator;
  /** 缺省求值器的随机源（条件应无随机；缺省固定种子 0 保证确定性） */
  readonly rng?: Rng;
}

/**
 * 缺省条件求值器：compileExpr 缓存 + buildExprScope 投影 + evalExpr 真值化。
 *
 * - 编译缓存按表达式原文复用（同一条件多次求值只编译一次）；
 * - time 视图使用缺省投影；09 号 TimeConfig 校准场景由宿主以自定义
 *   `evaluator` 覆盖（同 GameRuntime.timeViewProvider 口径）；
 * - 条件应为纯表达式；rng 仅满足求值器签名（缺省固定种子，不消耗）。
 */
export function createQuestConditionEvaluator(
  options: Pick<QuestDeriverOptions, 'functionRegistry' | 'rng'> = {},
): QuestConditionEvaluator {
  const registry = options.functionRegistry ?? createBuiltinFunctionRegistry();
  const rng = options.rng ?? createRng(0);
  const cache = new Map<string, CompiledExpr>();
  return (source, state) => {
    let expr = cache.get(source);
    if (expr === undefined) {
      expr = compileExpr(source, registry);
      cache.set(source, expr);
    }
    const view = state as GameState;
    const scope = buildExprScope(view, {
      time: defaultTimeView(view.world.time),
      meta: DEFAULT_META_VIEW,
    });
    return truthy(evalExpr(expr, { state: scope, rng, registry }));
  };
}

/**
 * 构造任务派生器（GameRuntimeOptions.derivers 成员）。
 *
 * 每次事务后仅调用 `evaluateTouched`（按 touched 脏标记）；不调用全量
 * failWhen 扫描——时间截止由管线步骤 7 的 `__quest.deadline` 承担（避免轮询）。
 */
export function createQuestDeriver(
  machine: QuestMachine,
  options: QuestDeriverOptions = {},
): TransactionDeriver {
  const evaluator =
    options.evaluator ??
    createQuestConditionEvaluator({
      ...(options.functionRegistry !== undefined
        ? { functionRegistry: options.functionRegistry }
        : {}),
      ...(options.rng !== undefined ? { rng: options.rng } : {}),
    });
  return {
    afterTransaction(dctx: TransactionDeriveContext): void {
      const ctx: QuestContext = {
        quests: dctx.draft.quests,
        state: dctx.draft as unknown as Readonly<GameState>,
        evalCondition: (source) => evaluator(source, dctx.draft as unknown as GameState),
        child: (effects) => {
          dctx.child(effects);
        },
        emit: (event) => {
          dctx.emit(event);
        },
      };
      machine.evaluateTouched(ctx, dctx.touched);
    },
  };
}
