import type { Clock, CompiledExpr, GameId, NpcDef, Rng } from '@game/shared';
import { createRng } from '@game/shared';
import {
  compileExpr,
  createBuiltinFunctionRegistry,
  evalExpr,
  truthy,
} from '../expr-eval/index.js';
import { buildExprScope, defaultTimeView } from '../state/index.js';
import type { GameState } from '../state/index.js';

/**
 * NPC 日程解析（设计 §4.6；FR-NPCR-01；12 任务 1）。
 *
 * 纯数据机制，不解释「日程」语义（引擎中立性）：按声明顺序取第一个匹配的
 * schedule 项，匹配条件 = slots ∧ weekdays ∧ showIf 全部成立（未声明的维度
 * 视为通配）；无匹配（含无日程声明）→ null（不在场）。
 *
 * 时段 / 星期口径与表达式 `time.slot` / `time.weekday` 一致
 * （{@link createTimeViewProvider} 校准命名，缺省 defaultTimeView 数值串）。
 * showIf 缺省以内置函数注册表对当前 state 投影求值；宿主需要 x.* 脚本函数时
 * 经 {@link NpcScheduleQuery.evaluate} 注入运行时注册表同源求值器。
 */

/** 日程匹配的时点视图与条件求值注入面 */
export interface NpcScheduleQuery {
  /**
   * 当前时段 id（TimeConfig.slots[slotIndex].id）。缺省 = defaultTimeView(clock).slot
   * （数值字符串），即未接入时间配置时的 04 号缺省投影口径。
   */
  readonly slot?: string;
  /** 当前星期序字符串（1 起，startWeekday 校准）。缺省 = defaultTimeView(clock).weekday */
  readonly weekday?: string;
  /**
   * showIf 条件求值器（原文 → 布尔）。缺省 = 内置 20 函数 + buildExprScope 投影；
   * 求值器抛错沿调用栈上抛（EXPR_COMPILE / EVAL_ERROR，DD-01 不静默）。
   */
  readonly evaluate?: (source: string) => boolean;
}

/** 缺省求值器持有的内置函数注册表（不消耗随机序列；条件应为纯表达式） */
const DEFAULT_FN_REGISTRY = createBuiltinFunctionRegistry();

/** 缺省求值器的确定性随机源（仅满足 evalExpr 签名，条件求值不消耗随机） */
const DEFAULT_RNG: Rng = createRng(0);

/** showIf 编译缓存（同一日程表达式多次解析只编译一次） */
const COMPILE_CACHE = new Map<string, CompiledExpr>();

/** 缺省 showIf 求值（内置注册表 + 当前状态投影 + 时钟校准的 time 视图） */
function defaultEvaluate(source: string, clock: Clock, state: GameState): boolean {
  let expr = COMPILE_CACHE.get(source);
  if (expr === undefined) {
    expr = compileExpr(source, DEFAULT_FN_REGISTRY);
    COMPILE_CACHE.set(source, expr);
  }
  // time 视图以入参 clock 校准（state.world.time 可为事务 draft 内的同刻时钟）；
  // NPC 日程缓存投影随 scope 透出，供 showIf 内的 npc.<id>.at 条件读取。
  const scope = buildExprScope(state, { time: defaultTimeView(clock) });
  return truthy(evalExpr(expr, { state: scope, rng: DEFAULT_RNG, registry: DEFAULT_FN_REGISTRY }));
}

/**
 * 解析 NPC 当前所在地点（§4.6 `resolveNpcLocation`）。
 *
 * - 声明顺序：返回第一个 slots ∧ weekdays ∧ showIf 全匹配项的 location；
 * - 通配：schedule 项未声明 slots / weekdays 即不限制该维度；
 * - 缺席：def.schedule 缺省、空表或全表不匹配 → null（不在场，缓存中不落条目）；
 * - 无副作用：只读 def/clock/state（含事务 draft），showIf 不应有副作用（纯表达式，
 *   随机类函数不得出现——由加载期纯度核对拦截）。
 *
 * @throws EngineError `EXPR_COMPILE` —— showIf 非法（未知 root / 形态错误）；
 * @throws EngineError `EVAL_ERROR` —— showIf 求值期错误（封闭域缺 key / 类型不符）。
 */
export function resolveNpcLocation(
  def: NpcDef,
  clock: Clock,
  state: GameState,
  query: NpcScheduleQuery = {},
): GameId | null {
  const schedule = def.schedule;
  if (schedule === undefined || schedule.length === 0) return null;
  const slot = query.slot ?? defaultTimeView(clock).slot;
  const weekday = query.weekday ?? defaultTimeView(clock).weekday;
  const evaluate =
    query.evaluate ?? ((source: string): boolean => defaultEvaluate(source, clock, state));
  for (const entry of schedule) {
    const slots = entry.at.slots;
    if (slots !== undefined && !slots.includes(slot)) continue;
    const weekdays = entry.at.weekdays;
    if (weekdays !== undefined && !weekdays.includes(weekday)) continue;
    if (entry.showIf !== undefined && !evaluate(entry.showIf)) continue;
    return entry.location;
  }
  return null;
}
