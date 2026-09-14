import { createRng } from '@game/shared';
import type { CompiledExpr, ExprFunctionRegistry, NpcDef, Rng, TimeConfig } from '@game/shared';
import {
  compileExpr,
  createBuiltinFunctionRegistry,
  evalExpr,
  truthy,
} from '../expr-eval/index.js';
import { buildExprScope, defaultTimeView } from '../state/index.js';
import type { GameState } from '../state/index.js';
import { createTimeViewProvider } from '../time/calendar.js';
import type { TimeViewProvider } from '../state/index.js';
import type { TransactionDeriveContext, TransactionDeriver } from '../runtime/index.js';
import { resolveNpcLocations, sameNpcLocationCache } from './schedule.js';

/**
 * NPC 日程缓存的事务后置派生器（§4.6；12 任务 2）。
 *
 * `world.npcLocationCache` 是可重建缓存：时间推进由管线步骤 5 重建；**非时间
 * 事务**（flag / 声望 / 属性等条件变更，showIf 结果随之改变）由本派生器在事务
 * 提交前按最新 draft 重算，保证 `npc.<id>.at` 的 O(1) 查询面不陈旧——不轮询、
 * 不做增量 refs（NPC 日程规模小，全量重建成本低于索引维护）。
 *
 * 装配示例：
 * ```ts
 * new GameRuntime({ ..., derivers: [createNpcScheduleDeriver({ npcs, config })] })
 * ```
 * 无变化时不写回（避免每事务产生冗余补丁）。
 */

/** 日程派生器选项 */
export interface NpcScheduleDeriverOptions {
  /** NPC 目录（数据源；空目录 = 缓存清空） */
  readonly npcs: ReadonlyMap<string, NpcDef>;
  /** 时段制日历（slot/weekday 校准；缺省 = defaultTimeView 数值串口径） */
  readonly config?: TimeConfig;
  /** 表达式函数注册表（showIf 求值；缺省 = 内置 20 函数，宿主应传运行时同源） */
  readonly functionRegistry?: ExprFunctionRegistry;
  /** 求值随机源（条件应为纯表达式；缺省固定种子 0 保证确定性） */
  readonly rng?: Rng;
}

/**
 * 构造日程缓存派生器（GameRuntimeOptions.derivers 成员）。
 * showIf 经 buildExprScope（含 npcLocationCache 投影）与注入注册表求值；
 * 求值错误沿事务上抛（失败整批回滚，不静默）。
 */
export function createNpcScheduleDeriver(options: NpcScheduleDeriverOptions): TransactionDeriver {
  const registry = options.functionRegistry ?? createBuiltinFunctionRegistry();
  const rng = options.rng ?? createRng(0);
  const viewOf: TimeViewProvider | undefined =
    options.config !== undefined ? createTimeViewProvider(options.config) : undefined;
  // showIf 原文 → 已编译表达式（同一日程表达式跨事务只编译一次）
  const cache = new Map<string, CompiledExpr>();

  return {
    afterTransaction(dctx: TransactionDeriveContext): void {
      const draft = dctx.draft;
      const state = draft as unknown as GameState;
      const clock = draft.world.time;
      const view = viewOf !== undefined ? viewOf(clock) : defaultTimeView(clock);
      const evaluate = (source: string): boolean => {
        let expr = cache.get(source);
        if (expr === undefined) {
          expr = compileExpr(source, registry);
          cache.set(source, expr);
        }
        const scope = buildExprScope(state, { time: view });
        return truthy(evalExpr(expr, { state: scope, rng, registry }));
      };
      const next = resolveNpcLocations(options.npcs, clock, state, {
        slot: view.slot,
        weekday: view.weekday,
        evaluate,
      });
      if (!sameNpcLocationCache(draft.world.npcLocationCache, next)) {
        draft.world.npcLocationCache = next;
      }
    },
  };
}
