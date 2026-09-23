import type { EffectData, Rng, TimeConfig } from '@game/shared';
import { EngineError } from '@game/shared';
import { advanceClock } from './clock.js';
import type { GameRuntime } from '../runtime/index.js';
import type { ExecOutcome } from '../runtime/index.js';

/**
 * 推进管线编排器（设计 §4.3 固定次序，DD-10；09 任务 3/4/6）。
 *
 * 一次 `advance(slots)` = **一个 runtime.exec 事务** = 一个 undo 点（FR-READ-03
 * 回滚粒度与玩家感知一致）：各步骤产出的效果指令合并进同一次 exec，任一步骤
 * 失败整批回滚。次序固定且不可插入中间——依赖模块（13/14/12/10/11 号）只能以
 * {@link TimePipelineOptions} 的槽位钩子注入，作者钩子（子任务 6）只允许
 * before_rollover / day_rollover 前后缀两个位置。
 *
 * 时钟写入本身也是事务内的一条内部指令（`__time.advance`，引擎内部面，不面向
 * 作者；data/time.yaml 缺失时游戏包经 InMemory 装配仍须注入 timeConfig）。
 */

/** 步骤钩子上下文：预计算的推进参数与跨边界旗标（免得步骤各自重算） */
export interface TimeStepContext {
  /** 宿主运行时（步骤如需求值/子事务可复用其公开面） */
  readonly runtime: GameRuntime;
  /** 事务随机源（DD-09：与 runtime 同一序列） */
  readonly rng: Rng;
  /** 本次推进的时段数 */
  readonly slots: number;
  /** 本次推进是否跨天（before_rollover / day_rollover 的门控依据） */
  readonly crossedDay: boolean;
  /** 本次推进是否跨周 */
  readonly crossedWeek: boolean;
  /** 本次推进是否跨月 */
  readonly crossedMonth: boolean;
}

/**
 * 步骤钩子：返回本步骤要执行的效果指令列表（进同一次事务）。
 * 钩子只收集数据不执行——执行统一由 runtime.exec 原子完成；需要直接写状态的
 * 步骤（如日程缓存重建）由归属模块注册内部指令完成。
 */
export type TimeStepProvider = (ctx: TimeStepContext) => EffectData[];

/** 推进管线选项（§1.3 显式依赖注入）：未注入的步骤槽位 = 空实现 */
export interface TimePipelineOptions {
  /** 宿主运行时（事务入口） */
  runtime: GameRuntime;
  /** 时段制日历（data/time.yaml 或宿主缺省；与 __time.advance 指令共用） */
  config: TimeConfig;
  /** 步骤 2：状态效果 tick（到期结算/周期触发，FR-STAT-03；归属模块挂载） */
  statusTick?: TimeStepProvider;
  /** 步骤 3：临时身体回退（§4.8 revertAfter；14 号挂载） */
  bodyRevert?: TimeStepProvider;
  /** 步骤 5：NPC 日程移动（§4.6；12 号挂载） */
  npcSchedule?: TimeStepProvider;
  /**
   * 步骤 4.5：商店补货（§5.3；17 号挂载，**每次推进都调用**——条目级
   * `restock` 周期（时段数）由 `__shop.restock` 依 `world.shopRestock`
   * 计时自判，故钩子须每时段评估而非仅跨天）。
   */
  shopRestock?: TimeStepProvider;
  /** 步骤 6：事件池评估（§4.4；10 号挂载） */
  eventEval?: TimeStepProvider;
  /** 步骤 7：任务截止/到期检查（§4.5 failWhen；11 号挂载） */
  questDeadline?: TimeStepProvider;
  /** 作者钩子前后缀（子任务 6）：before_rollover（步骤 0）/ day_rollover（步骤 4） */
  hooks?: TimeHooks;
}

/**
 * 作者钩子（§4.3 / DD-10）：只允许推进管线的**前后缀**两个槽位，不可插入
 * 步骤中间。跨天门控：仅当本次推进跨天时调用（「若本次将跨天」）。
 * 钩子效果与全部引擎步骤合并进同一次事务（一个 undo 点，子任务 4 契约）。
 */
export interface TimeHooks {
  /** 步骤 0：时钟推进前（跨天时）——房租预扣、跨天预警等作者逻辑 */
  beforeRollover?: TimeStepProvider;
  /** 步骤 4：状态 tick / 身体回退后、NPC 日程前（跨天时）——日结算（房租/惩罚/总结） */
  dayRollover?: TimeStepProvider;
}

/** 事务定位（EFFECT_FAILED where 携带 pipeline: 'time' 供诊断定位） */
const EXEC_WHERE = { pipeline: 'time' } as const;

/**
 * 时间推进管线（§4.3）。引擎持有的编排器：宿主（叙事运行时的
 * advanceTime 跳转消费方 / 移动行动 / 调试快进）统一经 advance() 推进时间。
 */
export class TimePipeline {
  readonly #runtime: GameRuntime;
  readonly #config: TimeConfig;
  readonly #statusTick: TimeStepProvider | undefined;
  readonly #bodyRevert: TimeStepProvider | undefined;
  readonly #npcSchedule: TimeStepProvider | undefined;
  readonly #shopRestock: TimeStepProvider | undefined;
  readonly #eventEval: TimeStepProvider | undefined;
  readonly #questDeadline: TimeStepProvider | undefined;
  readonly #hooks: TimeHooks | undefined;

  constructor(options: TimePipelineOptions) {
    this.#runtime = options.runtime;
    this.#config = options.config;
    this.#statusTick = options.statusTick;
    this.#bodyRevert = options.bodyRevert;
    this.#npcSchedule = options.npcSchedule;
    this.#shopRestock = options.shopRestock;
    this.#eventEval = options.eventEval;
    this.#questDeadline = options.questDeadline;
    this.#hooks = options.hooks;
  }

  /**
   * 推进 N 个时段（§4.3 固定次序）。
   *
   * - slots=0 直接短路（无事务、无钩子调用）；
   * - 跨边界旗标在事务前用推进纯函数预计算（时钟只在步骤 1 变更，预计算
   *   与事务内写入共用同一口径）；
   * - 返回本次事务的 ExecOutcome（jumps/events/patches 供宿主消费与调试）。
   */
  advance(slots: number): ExecOutcome {
    if (!Number.isInteger(slots) || slots < 0) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { pipeline: 'time', slots: String(slots) },
        messageKey: 'error.time.invalidAdvance',
      });
    }
    if (slots === 0) {
      return { jumps: [], events: [], patches: [] };
    }
    const plan = advanceClock(this.#runtime.state.world.time, this.#config, slots);
    const ctx: TimeStepContext = {
      runtime: this.#runtime,
      rng: this.#runtime.rng,
      slots,
      crossedDay: plan.crossedDay,
      crossedWeek: plan.crossedWeek,
      crossedMonth: plan.crossedMonth,
    };
    const effects: EffectData[] = [];
    // 步骤 0：before_rollover 作者钩子（跨天时；时钟推进前缀）
    if (plan.crossedDay) this.#collect(effects, this.#hooks?.beforeRollover, ctx);
    // 步骤 1：时钟推进（内部指令；钩子之外的位置对作者封闭）
    effects.push(this.#advanceInstruction(slots));
    // 步骤 2：状态效果 tick
    this.#collect(effects, this.#statusTick, ctx);
    // 步骤 3：临时身体回退
    this.#collect(effects, this.#bodyRevert, ctx);
    // 步骤 4：day_rollover 作者钩子（跨天时；日结算：房租/惩罚/总结）
    if (plan.crossedDay) this.#collect(effects, this.#hooks?.dayRollover, ctx);
    // 步骤 4.5：商店补货（每时段评估；条目级计时自判）
    this.#collect(effects, this.#shopRestock, ctx);
    // 步骤 5：NPC 日程移动
    this.#collect(effects, this.#npcSchedule, ctx);
    // 步骤 6：事件池评估
    this.#collect(effects, this.#eventEval, ctx);
    // 步骤 7：任务截止/到期检查
    this.#collect(effects, this.#questDeadline, ctx);
    return this.#runtime.exec(effects, { source: 'hook', where: { ...EXEC_WHERE }, rng: ctx.rng });
  }

  /** 调用步骤钩子并合并其效果（钩子未注入 = 空实现） */
  #collect(
    effects: EffectData[],
    provider: TimeStepProvider | undefined,
    ctx: TimeStepContext,
  ): void {
    if (provider === undefined) return;
    effects.push(...provider(ctx));
  }

  /** 内部时钟指令装配（§4.3 步骤 1；作者不可达，见 system.ts TSDoc） */
  #advanceInstruction(slots: number): EffectData {
    return { '__time.advance': { slots } } as unknown as EffectData;
  }
}
