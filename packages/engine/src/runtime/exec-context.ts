import type { CompiledExpr, EffectData, GameId, Rng } from '@game/shared';
import type { Patch, WritableDraft } from 'immer';
import type { GameState } from '../state/index.js';
import type { EngineEvent } from './engine-events.js';

/**
 * 事务执行上下文与产出（设计 §3.1 ExecContext / ExecOutcome / §3.3
 * EffectContext 最小接口；04 任务 B1/B2/B3）。
 *
 * - `ExecContext`：调用方（选项/事件/钩子/脚本）注入的事务来源与定位信息；
 * - `EffectContext`：指令执行器在单条指令生命周期内拿到的能力面（draft 仅本
 *   指令生命周期有效——事务提交后 immer 冻结，越界变更抛错，05 号验证）；
 * - `EffectExecutor`：指令解析的最小接口（05 号注册表实现）；04 号运行时只
 *   消费该接口，测试用桩指令验证管线；
 * - `EffectExecution.jumps`：跳转类指令「不改状态、只产 jumps」的声明面——
 *   目标由指令参数静态可知（goto/back/ending/loop_transition/battle），在
 *   解析期声明；子效果产生的动态跳转经 child() 的 ExecOutcome 合并。
 */

/** 事务来源（§3.1 ExecContext.source；调试面板事务以 debug 来源留痕） */
export type ExecSource = 'choice' | 'event' | 'hook' | 'battle' | 'script' | 'debug';

/** 调用方定位信息（FR-DEBG-07 错误卡片 / EFFECT_FAILED where 的数据源） */
export interface ExecContext {
  source: ExecSource;
  where: {
    scene?: GameId;
    event?: GameId;
    battle?: string;
    instruction?: number;
    /** 时间管线定位（§4.3 编排器事务；09 号） */
    pipeline?: string;
    /** 商店交易定位（17 号：ShopService 交易事务的 where 面） */
    shop?: string;
    /** 作者脚本定位（23 号：ScriptHost 事务与钩子的 where 面——脚本模块 id） */
    script?: string;
  };
  /** 事务随机源（DD-09：指令内表达式与效果的随机消耗走同一序列） */
  rng: Rng;
}

/** 流程跳转目标（§3.1：由叙事运行时 §4.2 消费，状态层/流程层分界） */
export type JumpTarget =
  | { type: 'scene'; scene: GameId }
  | { type: 'ending'; ending: GameId }
  | { type: 'battle'; battle: string }
  /** 商店开启意图（§3.3 shop 指令产出，17 号；宿主经 shop_open 事件消费） */
  | { type: 'shop'; shop: string }
  | { type: 'back' }
  | { type: 'loopTransition' }
  /**
   * 时段推进意图（§3.3 advance_time 指令产出，05 任务 B5；§4.3 时间管线消费）：
   * 效果指令系统只把意图放进 ExecOutcome.jumps，真正的时段推进（钩子编排、
   * 日刷新）归 09 号推进管线——状态层/流程层分界的同类延伸。
   */
  | { type: 'advanceTime'; slots: number };

/** 事务产出（§3.1）：补丁（调试器与回滚的统一底座）/ 跳转 / 事件 */
export interface ExecOutcome {
  jumps: JumpTarget[];
  events: EngineEvent[];
  patches: Patch[];
}

/**
 * 指令执行上下文（§3.3 最小接口）：draft 仅本指令生命周期有效。
 * evalExpr 以当前指令 draft 的实时视图求值（前序指令与本指令已提交的变更可见）；
 * child 为嵌套原子批入口（check 分支效果、battle 奖励，§3.3）。
 */
export interface EffectContext {
  /** 当前指令的 immer draft（事务提交后冻结，越界变更抛错） */
  readonly draft: WritableDraft<GameState>;
  readonly rng: Rng;
  evalExpr(expr: CompiledExpr): unknown;
  /** 事件收集进当前事务（提交后统一送达总线，见 engine-events TSDoc） */
  emit(event: EngineEvent): void;
  /**
   * 嵌套原子批：子效果在同一 draft 上顺序执行，任一失败令整条指令（进而整批
   * 事务）失败回滚；返回子批自身的 jumps/events（patches 不重复计数——子批
   * 状态变更并入当前指令的 immer 补丁集）。
   */
  child(effects: readonly EffectData[], ctx: ExecContext): ExecOutcome;
  /** 定位信息：继承 ExecContext.where 并附 instruction 序号（0 起） */
  readonly where: ExecContext['where'];
}

/** 已解析的可执行指令（执行器产出；jumps 为跳转类指令的静态声明，可省略） */
export interface EffectExecution {
  execute(effectCtx: EffectContext): void;
  readonly jumps?: readonly JumpTarget[];
}

/**
 * 效果执行器最小接口（05 号 EffectRegistry 实现）：解析一条指令为可执行句柄。
 * 未注册指令 / 参数校验失败由实现抛 EngineError（运行时包装为 EFFECT_FAILED
 * 并附 instruction 序号定位）。
 */
export interface EffectExecutor {
  resolve(instruction: EffectData, where: ExecContext['where']): EffectExecution;
}

/**
 * 事务后置派生器上下文（§4.5；11 号任务系统首用，DD-06「事务」交互面）。
 *
 * 运行时在指令全部执行后、状态提交前调用派生器：`draft` 为同一事务的可写
 * draft，`touched` 为本次事务触碰的 GameState 路径（点分，来自 immer 补丁路径，
 * 如 `world.flags.rumor`）——派生器按此做脏标记评估（不轮询）；`emit`/`child`
 * 与指令执行面同批（事件与子效果并入当前事务 frame，失败整批回滚）。
 */
export interface TransactionDeriveContext {
  /** 当前事务的可写 draft（与指令执行同一事务，变更并入同一补丁集） */
  readonly draft: WritableDraft<GameState>;
  /** 本次事务触碰的状态路径（点分前缀；脏标记评估的数据面） */
  readonly touched: readonly string[];
  readonly rng: Rng;
  /** 事件收集进当前事务（提交后统一送达） */
  emit(event: EngineEvent): void;
  /** 嵌套原子批（子效果并入当前事务 frame） */
  child(effects: readonly EffectData[]): ExecOutcome;
}

/**
 * 事务后置派生器：运行时在每次 exec 成功路径上（提交前）按注册序调用。
 * 结构性接口定义在 runtime 侧，具体派生器（如任务状态机）由宿主注入，
 * 避免 runtime 对子系统类型的横向依赖（§1.2 R5 / DD-06）。
 */
export interface TransactionDeriver {
  afterTransaction(ctx: TransactionDeriveContext): void;
}
