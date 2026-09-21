import type { AchievementDef, GameId, CompiledExpr } from '@game/shared';
import { EngineError } from '@game/shared';
import { compileExpr, evalExpr, truthy } from '../expr-eval/index.js';
import { buildExprScope } from '../state/index.js';
import { buildStatePrefixIndex, touchedMatchesPrefix } from '../state/ref-paths.js';
import type { GameState } from '../state/index.js';
import type { ExprFunctionRegistry, Rng } from '@game/shared';
import type { AchievementProgress, AchievementUnlocked } from './types.js';

/**
 * 成就评估器（detail-design §5.4，18 号 A 线；FR-ACHV-01/02/04）。
 *
 * 与任务系统同一套脏标记机制（§4.5「与事件系统同一机制」）：
 * - {@link AchievementEvaluator.evaluateTouched}：事务后按 TouchReport 增量评估
 *   （条件 refs → 状态路径前缀命中才求值，不轮询）；
 * - {@link AchievementEvaluator.all}：**全量评估**（时间管线每时段兜底 +
 *   新档 bootstrap 后的首评；§5.4「增量 + 每时段兜底全量」）；
 * - 已解锁集合由**宿主注入**（Profile 在宿主侧，DD-04）——评估器不持有
 *   Profile，只回答「以当前状态看，哪些成就达成且尚未解锁」。
 *
 * 解锁判定为**单调**：解锁后即使条件回退（如数值下降）也不撤销——已解锁集合
 * 由宿主提供，评估器只做差集。
 */

export interface AchievementEvaluatorOptions {
  /** 成就目录（加载器发布面） */
  readonly achievements: ReadonlyMap<GameId, AchievementDef>;
  /**
   * 成就条件 refs 反查表（`表达式路径 → 依赖它的成就 id 集`；与 11 号任务
   * 同一机制，来源为 `GameDefinition.poolIndex.achievementRefs`）。
   */
  readonly refs: ReadonlyMap<string, ReadonlySet<GameId>>;
  /** 表达式函数注册表（与运行时同一实例） */
  readonly functionRegistry: ExprFunctionRegistry;
  /** 求值随机源（成就条件一般无随机；DD-09 口径统一） */
  readonly rng: Rng;
}

export class AchievementEvaluator {
  readonly #defs: ReadonlyMap<GameId, AchievementDef>;
  readonly #conditionPrefixes: ReadonlyMap<GameId, readonly string[]>;
  readonly #registry: ExprFunctionRegistry;
  readonly #rng: Rng;
  /** 表达式编译缓存（原文 → CompiledExpr；条件在加载期已编译，此处按需取用） */
  readonly #compiled = new Map<string, CompiledExpr>();

  constructor(options: AchievementEvaluatorOptions) {
    this.#defs = options.achievements;
    this.#registry = options.functionRegistry;
    this.#rng = options.rng;
    this.#conditionPrefixes = buildStatePrefixIndex(options.refs);
  }

  /** 成就目录（只读视图） */
  get defs(): ReadonlyMap<GameId, AchievementDef> {
    return this.#defs;
  }

  /**
   * 增量评估（事务后）：仅评估条件依赖命中 touched 前缀的成就。
   * `touched` 为空数组时短路（零条件求值——行为级证明不轮询）。
   */
  evaluateTouched(
    state: GameState,
    touched: readonly string[],
    unlocked: ReadonlySet<GameId>,
  ): AchievementUnlocked[] {
    if (touched.length === 0) return [];
    const result: AchievementUnlocked[] = [];
    for (const [id, prefixes] of this.#conditionPrefixes) {
      if (unlocked.has(id)) continue;
      if (!prefixes.some((prefix) => touchedMatchesPrefix(prefix, touched))) continue;
      const entry = this.#evaluateOne(state, id);
      if (entry !== null) result.push(entry);
    }
    return result;
  }

  /**
   * 全量评估（每时段兜底 + 新档首评）：遍历全部成就。
   * 用于「条件依赖的路径未进 refs 索引」（如 x.* 脚本函数内部读取）的兜底。
   */
  all(state: GameState, unlocked: ReadonlySet<GameId>): AchievementUnlocked[] {
    const result: AchievementUnlocked[] = [];
    for (const id of this.#defs.keys()) {
      if (unlocked.has(id)) continue;
      const entry = this.#evaluateOne(state, id);
      if (entry !== null) result.push(entry);
    }
    return result;
  }

  /**
   * 进度投影（FR-ACHV-01 progress 型；UI 进度条数据源）。
   * 非 progress 型返回 null（调用方据此不渲染进度条）。
   */
  progressOf(state: GameState, id: GameId): AchievementProgress | null {
    const def = this.#defs.get(id);
    if (def === undefined || def.type !== 'progress') return null;
    if (def.progressExpr === undefined || def.goal === undefined) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { op: 'achievement', achievement: id, detail: 'progress 型缺 progressExpr/goal' },
        messageKey: 'error.internal',
      });
    }
    const cur = this.#evalNumber(state, def.progressExpr, id);
    return { id, cur: Math.min(cur, def.goal), goal: def.goal, unlocked: cur >= def.goal };
  }

  /**
   * 图鉴投影（FR-ACHV-04）：返回全部成就的展示条目。
   * - hidden 型未解锁 → `nameKey`/`when` 不下发，仅 `hidden: true` 占位
   *   （不暴露存在性以外信息）；
   * - 其余类型全量下发（含未解锁——图鉴需要展示目标）。
   */
  gallery(state: GameState, unlocked: ReadonlySet<GameId>): readonly AchievementGalleryEntry[] {
    const entries: AchievementGalleryEntry[] = [];
    for (const [id, def] of this.#defs) {
      const isUnlocked = unlocked.has(id);
      if (def.type === 'hidden' && !isUnlocked) {
        entries.push({ id, hidden: true, unlocked: false, points: def.points });
        continue;
      }
      entries.push({
        id,
        hidden: false,
        unlocked: isUnlocked,
        points: def.points,
        nameKey: def.nameKey,
        ...(def.group !== undefined ? { group: def.group } : {}),
        ...(def.type === 'progress' ? { progress: this.progressOf(state, id) ?? undefined } : {}),
      });
    }
    return entries;
  }

  /** 收集率（FR-ACHV-04：已解锁 / 总数，含隐藏项在分母内） */
  collectionRate(unlocked: ReadonlySet<GameId>): { unlocked: number; total: number; rate: number } {
    const total = this.#defs.size;
    const count = [...this.#defs.keys()].filter((id) => unlocked.has(id)).length;
    return { unlocked: count, total, rate: total === 0 ? 0 : count / total };
  }

  /** 单成就评估：达成返回解锁载荷（含 progress 型终态快照），否则 null */
  #evaluateOne(state: GameState, id: GameId): AchievementUnlocked | null {
    const def = this.#defs.get(id);
    if (def === undefined) return null;
    const compiled = this.#compile(def.when);
    const value = evalExpr(compiled, {
      state: buildExprScope(state),
      rng: this.#rng,
      registry: this.#registry,
    });
    if (!truthy(value)) return null;
    const payload: AchievementUnlocked = { id, points: def.points };
    if (def.type === 'progress' && def.goal !== undefined) {
      const cur = Math.min(this.#evalNumber(state, def.progressExpr as string, id), def.goal);
      return { ...payload, progress: { cur, goal: def.goal } };
    }
    return payload;
  }

  #evalNumber(state: GameState, source: string, id: GameId): number {
    const compiled = this.#compile(source);
    const value = evalExpr(compiled, {
      state: buildExprScope(state),
      rng: this.#rng,
      registry: this.#registry,
    });
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EngineError({
        code: 'EVAL_ERROR',
        where: {
          op: 'achievement',
          achievement: id,
          expr: source,
          detail: `进度表达式求值结果为非有限数值（${String(value)}）`,
        },
        messageKey: 'error.expr.evalError',
      });
    }
    return value;
  }

  #compile(source: string): CompiledExpr {
    const cached = this.#compiled.get(source);
    if (cached !== undefined) return cached;
    // 加载期已编译全部成就条件（管线 walk）；此处缓存未命中说明是宿主动态构造，
    // 走 compileExpr 编译（与运行时同款，保持单一编译入口）
    const compiled = compileExpr(source, this.#registry);
    this.#compiled.set(source, compiled);
    return compiled;
  }
}

/** 图鉴条目（FR-ACHV-04；UI 成就图鉴的展示面） */
export interface AchievementGalleryEntry {
  readonly id: GameId;
  /** 隐藏型未解锁 = true（仅此信息可见） */
  readonly hidden: boolean;
  readonly unlocked: boolean;
  readonly points: number;
  /** hidden 且未解锁时不下发 */
  readonly nameKey?: string;
  readonly group?: string;
  readonly progress?: AchievementProgress;
}
