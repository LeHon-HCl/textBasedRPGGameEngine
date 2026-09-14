import type { EventDef, TimeConfig } from '@game/shared';
import { EngineError } from '@game/shared';
import type { ExecContext, ExecOutcome } from '../runtime/index.js';
import type { PoolIndex } from '../loader/index.js';
import { buildStatePrefixIndex, touchedMatchesPrefix } from '../state/ref-paths.js';
import { collectCandidates, pruneCandidates, selectCandidates } from './evaluator.js';

/**
 * 事件池（设计 §4.4，10 任务 5/6/9）。
 *
 * 编排 collect → prune → select → dispatch 四步（判定核心在 events/evaluator.ts
 * 纯函数），并承担：
 * - **脏标记增量**（NFR-02）：调用方传 `touched`（事务补丁路径）时，require 只
 *   对 `PoolIndex.dirtyMap` 命中的事件求值；`touched` 缺省 = 全量评估（包加载后
 *   首推口径）；
 * - **dispatch**：入选事件写入 `world.eventCooldowns`（lastDay/lastSlotIndex/
 *   fired）并产出场景跳转——子会话启动由 SceneRunner 的 eventSceneIds 判定；
 * - **debugLog**（FR-DEBG-05）：debug 会话开启时记录三阶段计数与未触发原因。
 *
 * 副作用面（冷却登记与状态读取）经 GameRuntime 的公开事务入口完成，池本身
 * 不持有可变状态（除 debug 环形日志）。
 */

/** 事件未触发原因（FR-DEBG-05 的诊断面） */
export type UntriggeredReason = 'require' | 'explore' | 'prune';

/** 单次评估的 debug 记录（FR-DEBG-05） */
export interface EventDebugEntry {
  /** collect 阶段候选数（作用域 + 窗口过滤后） */
  readonly collected: number;
  /** 本轮实际求值过的 require 原文（脏标记面） */
  readonly evaluated: readonly string[];
  /** 入选事件（含原因） */
  readonly selected: readonly { event: string; reason: string }[];
  /** 未触发事件与原因 */
  readonly untriggered: readonly { event: string; reason: UntriggeredReason }[];
}

/** debug 环形日志容量（仅 debug 会话；保留最近 N 次评估） */
export const EVENT_DEBUG_LOG_CAPACITY = 50;

/** EventPool 构造选项 */
export interface EventPoolOptions {
  /**
   * 宿主运行时（求值面：require 经运行时表达式求值器；冷却登记写运行时状态）。
   * 缺省时仅纯函数据可用（collectCandidates 等直接调用）。
   */
  readonly runtime?: {
    readonly state: {
      readonly world: {
        readonly time: { readonly day: number; readonly slotIndex: number };
        readonly eventCooldowns: Record<
          string,
          { lastDay: number; lastSlotIndex?: number; fired: number }
        >;
      };
    };
    eval(expr: never): unknown;
    evalCondition(expr: never): boolean;
    readonly rng: { next(): number };
  };
  /** 事件池定义（GameDefinition.events） */
  readonly events: readonly EventDef[];
  /** 池索引（GameDefinition.poolIndex；dirtyMap 为脏标记数据面） */
  readonly poolIndex: PoolIndex;
  /** 当前区域（FR-XPLR-01 位置；locate() 可更新） */
  readonly area: string;
  /** 当前地点（缺省 = 区域级） */
  readonly location?: string;
  /** 时段制日历（窗口过滤与 slots 冷却换算） */
  readonly config: TimeConfig;
  /** 内容过滤器（§5.8 应用点 1；结构化最小视图） */
  readonly contentFilter?: { eventAdmissible(event: Pick<EventDef, 'tags'>): boolean };
  /** 调试日志开关（FR-DEBG-05；缺省 false） */
  readonly debugLog?: boolean;
  /**
   * require 的字符串求值器（表达式原文 → 真值）。宿主从运行时求值面适配：
   * `(src) => runtime.evalCondition(runtime.compile(src))`（编译缓存归运行时）。
   */
  readonly evalRequire?: (source: string) => boolean;
}

/**
 * 事件池步骤调用参数：把 collect/prune/select 的运行期依赖拆开传，
 * 避免 EventPool 持有 runtime 引用（宿主在每步装配）。
 */
export interface EventStepInput {
  /** 当前状态切片（冷却读取与登记） */
  readonly state: {
    readonly world: {
      readonly time: { day: number; slotIndex: number };
      readonly eventCooldowns: Record<
        string,
        { lastDay: number; lastSlotIndex?: number; fired: number }
      >;
    };
  };
  /** require 求值（表达式原文 → 真值；由宿主经运行时求值器提供） */
  readonly evalCondition: (source: string) => boolean;
  /** 随机源（DD-09：与运行时同序列） */
  readonly rng: ExecContext['rng'];
  /** 脏标记（事务补丁路径；缺省 = 全量评估） */
  readonly touched?: readonly string[];
}

/** 一次评估的产出（跳转与诊断） */
export interface EventStepResult {
  /** 场景跳转（子会话启动归 SceneRunner eventSceneIds 判定） */
  readonly jumps: ExecOutcome['jumps'];
  /** 冷却登记更新（调用方在事务 draft 上应用；`{...old, ...update}` 语义） */
  readonly cooldownUpdates: readonly CooldownRecord[];
  readonly debug?: EventDebugEntry;
}

/** 冷却登记项（事件 id + 写入 state 的字段形态） */
export interface CooldownRecord {
  readonly eventId: string;
  readonly lastDay: number;
  readonly lastSlotIndex?: number;
  readonly fired: number;
}

/** 事件池构造错误（配置缺失显性化） */
function poolError(detail: string): EngineError {
  return new EngineError({
    code: 'INTERNAL',
    where: { pipeline: 'events', detail },
    messageKey: 'error.events.pool',
  });
}

export class EventPool {
  readonly #events: readonly EventDef[];
  /** 事件 id → 状态路径前缀集（dirtyMap 经 ref-paths 归一化；脏标记匹配用） */
  readonly #conditionPrefixes: ReadonlyMap<string, readonly string[]>;
  readonly #config: TimeConfig;
  readonly #contentFilter: EventPoolOptions['contentFilter'];
  readonly #debugEnabled: boolean;
  readonly #stringEvaluator: ((source: string) => boolean) | undefined;
  readonly #debug: EventDebugEntry[] = [];
  readonly #runtime: EventPoolOptions['runtime'];
  #area: string;
  #location: string | undefined;

  constructor(options: EventPoolOptions) {
    if (options.events.length > 0 && options.poolIndex === undefined) {
      throw poolError('缺少 PoolIndex（dirtyMap 为脏标记评估的数据面）');
    }
    this.#events = options.events;
    this.#conditionPrefixes = buildStatePrefixIndex(options.poolIndex.dirtyMap);
    this.#config = options.config;
    this.#contentFilter = options.contentFilter;
    this.#runtime = options.runtime;
    this.#debugEnabled = options.debugLog === true;
    this.#stringEvaluator = options.evalRequire;
    this.#area = options.area;
    this.#location = options.location;
  }

  /** 更新当前位置（玩家移动/地点切换；FR-XPLR-01/02） */
  locate(area: string, location?: string): void {
    this.#area = area;
    this.#location = location;
  }

  /**
   * 一次评估（collect → prune → select → 冷却登记）。
   *
   * 冷却登记在返回前直接写 `input.state`（宿主的 draft/事务面）；
   * 跳转产出供宿主消费（SceneRunner 入口）。
   */
  evaluate(input: EventStepInput): EventStepResult {
    const { state, evalCondition, rng } = input;
    const clock = { day: state.world.time.day, slotIndex: state.world.time.slotIndex, week: 0 };
    const collected = collectCandidates(this.#events, this.#area, this.#location, {
      config: this.#config,
      clock,
    });
    const coercedState = state as unknown as Parameters<typeof pruneCandidates>[1];
    const pruned = pruneCandidates(collected, coercedState, {
      config: this.#config,
      ...(this.#contentFilter !== undefined ? { contentFilter: this.#contentFilter } : {}),
      ...(lastSlotIndexMap(state) !== undefined ? { lastSlotIndex: lastSlotIndexMap(state) } : {}),
    });

    // 脏标记：命中集决定哪些事件的 require 参与求值（缺省 = 全量，首推口径）
    const evaluated: string[] = [];
    const evalTracked = (source: string): boolean => {
      evaluated.push(source);
      return evalCondition(source);
    };
    const candidates =
      input.touched === undefined
        ? pruned
        : pruned.filter((event) => this.#touchedMatches(event, input.touched ?? []));

    const selected = selectCandidates(
      candidates,
      state as unknown as Parameters<typeof selectCandidates>[1],
      evalTracked,
      rng,
    );
    // 冷却登记以「更新清单」返回，由调用方在事务 draft 上应用（本池不改状态：
    // 运行时 state 为冻结视图，且一次评估 = 一个事务的原子性归宿主）
    const cooldownUpdates: CooldownRecord[] = [];
    const jumps: ExecOutcome['jumps'] = [];
    for (const candidate of selected) {
      const record = state.world.eventCooldowns[candidate.event.id];
      cooldownUpdates.push({
        eventId: candidate.event.id,
        lastDay: clock.day,
        lastSlotIndex: clock.slotIndex,
        fired: (record?.fired ?? 0) + 1,
      });
      jumps.push({ type: 'scene', scene: candidate.event.scene });
    }

    let debug: EventDebugEntry | undefined;
    if (this.#debugEnabled) {
      const selectedIds = new Set(selected.map((candidate) => candidate.event.id));
      const evaluatedSources = new Set(evaluated);
      const untriggered: { event: string; reason: UntriggeredReason }[] = [];
      for (const event of pruned) {
        if (selectedIds.has(event.id)) continue;
        if (event.trigger.type === 'explore') {
          untriggered.push({ event: event.id, reason: 'explore' });
          continue;
        }
        const require = 'require' in event.trigger ? event.trigger.require : undefined;
        if (require !== undefined && evaluatedSources.has(require)) {
          untriggered.push({ event: event.id, reason: 'require' });
        } else if (input.touched !== undefined) {
          // 脏标记未命中：本轮未评估（非 require 假）
          continue;
        }
      }
      for (const event of collected) {
        if (!pruned.includes(event)) untriggered.push({ event: event.id, reason: 'prune' });
      }
      debug = {
        collected: collected.length,
        evaluated,
        selected: selected.map((candidate) => ({
          event: candidate.event.id,
          reason: candidate.reason,
        })),
        untriggered,
      };
      this.#debug.push(debug);
      if (this.#debug.length > EVENT_DEBUG_LOG_CAPACITY) this.#debug.shift();
    }
    return { jumps, cooldownUpdates, ...(debug !== undefined ? { debug } : {}) };
  }

  /**
   * 便捷评估入口（宿主在事务内调用）：以构造时注入的 runtime 为求值/状态面。
   *
   * @param ctx 事务上下文（source/where/rng；`touched` 为事务补丁路径，
   *   缺省 = 全量评估即首推口径）
   */
  step(ctx: { readonly touched?: readonly string[] }): {
    readonly jumps: ExecOutcome['jumps'];
    readonly debug?: EventDebugEntry;
  } {
    const runtime = this.#runtime;
    if (runtime === undefined) {
      throw poolError('未注入 runtime（step 需要求值面与状态面；纯函数请直接调 evaluator）');
    }
    const state = runtime.state as unknown as EventStepInput['state'];
    return this.evaluate({
      state,
      evalCondition: (source) => this.#evalRequire(source),
      rng: runtime.rng as EventStepInput['rng'],
      ...(ctx.touched !== undefined ? { touched: ctx.touched } : {}),
    });
  }

  /** require 求值（经 runtime 的表达式求值面；编译缓存在运行时内部） */
  #evalRequire(source: string): boolean {
    const runtime = this.#runtime;
    if (runtime === undefined) return false;
    // 运行时求值面以 CompiledExpr 为入参；此处经其公开 evalCondition 语义
    // （字符串 → 编译 → 求值）——由宿主注入的 runtime 适配（见 step 装配示例）
    const evaluator = this.#stringEvaluator;
    if (evaluator === undefined) {
      throw poolError('未注入字符串求值器（require 需要 表达式原文 → 真值 的编译面）');
    }
    return evaluator(source);
  }

  /** debug 日志（最近 N 次；未开启 debug 时恒为空数组） */
  debugEntries(): readonly EventDebugEntry[] {
    return [...this.#debug];
  }

  /**
   * 脏标记命中（事件的 require refs 与本次触碰路径有交集，NFR-02）。
   * 无 require 的事件恒真——仍需参与 select（否则「无条件的剧本钩子」会被
   * 脏标记整体跳过），故返回 true（代价是一次常量真值，不涉及表达式求值）。
   */
  #touchedMatches(event: EventDef, touched: readonly string[]): boolean {
    const require = 'require' in event.trigger ? event.trigger.require : undefined;
    if (require === undefined) return true;
    const prefixes = this.#conditionPrefixes.get(event.id);
    if (prefixes === undefined) return false; // 无 refs 记录 → 无脏标记依据（不唤醒求值）
    return prefixes.some((prefix) => touchedMatchesPrefix(prefix, touched));
  }
}

/** 从状态提取「事件 id → 上次触发 slotIndex」（slots 冷却的判定补充面） */
function lastSlotIndexMap(state: EventStepInput['state']): Record<string, number> | undefined {
  const map: Record<string, number> = {};
  let any = false;
  for (const [id, record] of Object.entries(state.world.eventCooldowns)) {
    if (record.lastSlotIndex !== undefined) {
      map[id] = record.lastSlotIndex;
      any = true;
    }
  }
  return any ? map : undefined;
}
