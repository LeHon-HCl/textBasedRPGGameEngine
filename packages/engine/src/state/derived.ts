import { EngineError, createRng } from '@game/shared';
import type { AttrDefs, CompiledExpr, ExprFunctionRegistry, ExprTimeView, Rng } from '@game/shared';
import { compileExpr, createBuiltinFunctionRegistry, evalExpr } from '../expr-eval/index.js';
import type { GameState } from './game-state.js';
import type { MetaView } from './expr-scope.js';
import { buildExprScope } from './expr-scope.js';

/**
 * 派生属性重算（设计 §3.1 派生属性策略，FR-STAT-05；04 任务 A3）。
 *
 * - 触碰域门控：仅 `attr / equip / outfit / body / statuses` 域被触碰时重算
 *   （touchedRoots 与 DERIVED_TRIGGER_DOMAINS 求交集）；其余域的变更不影响
 *   派生结果，直接跳过（NFR-02 性能口径）；
 * - 公式经 03 号 `compileExpr` 编译（作用域注入：buildExprScope 从当前状态
 *   构造 §2.3 白名单视图），求值严格语义（DD-01）：非有限数值结果抛 EVAL_ERROR；
 * - 依赖序（拓扑）：派生公式可经 `attr.<derivedId>` 引用其他派生属性，按
 *   CompiledExpr.refs 建依赖图后 Kahn 排序，保证前序结果可读。循环依赖正常
 *   在加载期排除（FR-STAT-05、shared/validation stat-derived-cycle 规则），
 *   此处保留防御性检查（绕过加载器直调时显性报错）；
 * - `state` 可为已提交状态或 immer draft（事务内重算直接写 draft.player.derived）。
 */

/** 触发派生重算的状态域（§3.1：仅这五个域被触碰时重算） */
export const DERIVED_TRIGGER_DOMAINS: readonly string[] = Object.freeze([
  'attr',
  'equip',
  'outfit',
  'body',
  'statuses',
]);

/** 触碰域标记（touchedRoots 的合法取值） */
export type DerivedTriggerDomain = (typeof DERIVED_TRIGGER_DOMAINS)[number];

/** recomputeDerived 求值环境选项（缺省项见各字段说明） */
export interface DerivedEvalOptions {
  /**
   * 求值上下文随机源（DD-09）：公式含随机函数（rand/randInt/chance）时消耗
   * 该序列。调用方注入运行时 Rng 以保证同种子回放一致；缺省用固定种子
   * （0）的独立 Rng 兜底——无随机公式不受影响，含随机公式可复现但与主序列隔离。
   */
  rng?: Rng;
  /** 函数注册表（缺省 = 内置 20 函数；脚本扩展函数由宿主合并后注入，§3.2） */
  registry?: ExprFunctionRegistry;
  /** time 根求值视图（缺省 = defaultTimeView；09 号注入 TimeConfig 校准） */
  timeView?: ExprTimeView;
  /** meta 根 Profile 投影（缺省 = 空档视图，expr-scope.DEFAULT_META_VIEW） */
  meta?: MetaView;
}

/** 编译后的派生公式条目（拓扑排序的工作单元） */
interface CompiledDerived {
  id: string;
  expr: CompiledExpr;
}

/**
 * 派生属性重算入口（写路径统一走此函数，§3.1）。
 *
 * 就地写 `state.player.derived`；未命中触碰域或无派生定义时为无操作。
 * 每条公式求值前重建作用域视图（buildExprScope 逐次合并 attrs+derived），
 * 拓扑序保证依赖链上的派生值在本条求值时已刷新。
 */
export function recomputeDerived(
  state: GameState,
  touchedRoots: readonly string[],
  attrDefs: AttrDefs,
  options: DerivedEvalOptions = {},
): void {
  const derivedDefs = Object.entries(attrDefs.derived);
  if (derivedDefs.length === 0) return;
  const touched = touchedRoots.some((root) => DERIVED_TRIGGER_DOMAINS.includes(root));
  if (!touched) return;

  const registry = options.registry ?? createBuiltinFunctionRegistry();
  const compiled: CompiledDerived[] = derivedDefs.map(([id, def]) => ({
    id,
    expr: compileExpr(def.formula, registry),
  }));
  const ordered = topologicalOrderByRefs(compiled);

  for (const { id, expr } of ordered) {
    // 每条公式重建视图：前序派生结果立即可读（拓扑序保证无前向依赖）
    const scope = buildExprScope(state, { time: options.timeView, meta: options.meta });
    const rng = options.rng ?? createRng(0);
    const value = evalExpr(expr, { state: scope, rng, registry });
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EngineError({
        code: 'EVAL_ERROR',
        where: {
          attr: id,
          expr: expr.source,
          detail: `派生属性公式结果须为有限 number，实际为 ${describeValue(value)}`,
        },
        messageKey: 'error.state.derivedNonNumeric',
      });
    }
    state.player.derived[id] = value;
  }
}

/**
 * 按 refs 中的 `attr.<derivedId>` 引用对派生公式做 Kahn 拓扑排序。
 * 引用非派生属性（numeric/level）或其他 root 的边不参与排序（求值时直读）。
 */
function topologicalOrderByRefs(compiled: readonly CompiledDerived[]): CompiledDerived[] {
  const derivedIds = new Set(compiled.map((entry) => entry.id));
  const byId = new Map(compiled.map((entry) => [entry.id, entry]));
  // 入度 = 依赖的未求值派生属性数；dependents = 依赖反向边
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const { id, expr } of compiled) {
    const deps = new Set<string>();
    for (const ref of expr.refs) {
      if (ref.root !== 'attr') continue;
      const depId = ref.path.slice('attr.'.length);
      if (derivedIds.has(depId)) deps.add(depId);
    }
    inDegree.set(id, deps.size);
    for (const dep of deps) {
      const list = dependents.get(dep) ?? [];
      list.push(id);
      dependents.set(dep, list);
    }
  }

  const queue: string[] = compiled
    .map((entry) => entry.id)
    .filter((id) => (inDegree.get(id) ?? 0) === 0);
  const ordered: CompiledDerived[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const entry = byId.get(id) as CompiledDerived;
    ordered.push(entry);
    for (const dependent of dependents.get(id) ?? []) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }

  if (ordered.length !== compiled.length) {
    const unresolved = compiled
      .map((entry) => entry.id)
      .filter((id) => (inDegree.get(id) ?? 0) > 0);
    throw new EngineError({
      code: 'EXPR_COMPILE',
      where: {
        attrs: unresolved.join(','),
        detail: '派生属性公式存在循环依赖（FR-STAT-05：循环依赖应在加载期排除，此处为运行期防御）',
      },
      messageKey: 'error.state.derivedCycle',
    });
  }
  return ordered;
}

/** 非有限数值结果的诊断描述（describeType 同口径，eval.ts） */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  return Array.isArray(value) ? 'array' : typeof value;
}
