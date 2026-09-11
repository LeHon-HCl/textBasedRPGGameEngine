import { EngineError } from '@game/shared';
import type { AttrDefs, CompiledExpr, EffectData, ExprFunctionRegistry, Rng } from '@game/shared';
import { applyPatches, enablePatches, freeze, produce } from 'immer';
import type { Patch, WritableDraft } from 'immer';

// 补丁插件启用（ExecOutcome.patches 与失败反向回滚的底座；幂等调用）
enablePatches();
import type { DerivedTriggerDomain, MetaView, TimeViewProvider } from '../state/index.js';
import {
  DEFAULT_META_VIEW,
  buildExprScope,
  defaultTimeView,
  recomputeDerived,
} from '../state/index.js';
import type { GameState } from '../state/index.js';
import { createBuiltinFunctionRegistry, evalExpr, truthy } from '../expr-eval/index.js';
import type { EffectContext, EffectExecutor, ExecContext, ExecOutcome } from './exec-context.js';
import type { EngineEvent } from './engine-events.js';

/**
 * GameRuntime 状态事务核心（设计 §3.1，DD-06 交互中枢；04 任务 B1）。
 *
 * 事务执行（§3.1 时序图）：
 * 1. `produce` 逐指令包裹——每条指令在自己的 produce 生命周期内拿到 draft
 *    （指令间隔离，提交后冻结，越界变更抛错）；
 * 2. 指令经注入的 EffectExecutor 解析后执行；任一步抛错 → 反向应用已应用
 *    补丁（§3.1 时序图）→ 抛 `EFFECT_FAILED{where.instruction=i}`（0 起），
 *    原始错误挂 cause 供诊断导出（§10.2）；
 * 3. 事务内每条指令成功后，若其补丁触碰 attr/equip/outfit/body/statuses 域，
 *    立即重算派生属性（保证同事务后续指令的 evalExpr 读到新值）；
 * 4. 全部成功才提交（this.#state 指向新状态）并返回 ExecOutcome；失败时
 *    状态保持原对象（原子性），半途事件/跳转/补丁一律不外泄。
 *
 * 引擎无 DOM、可在 Node 纯数据测试（§1.3）；GameDefinition 的接入（readonly
 * def）由 06 号加载器产出后补齐，本模块只依赖注入的解耦面。
 */

/** GameRuntime 构造选项（全部依赖注入，§1.3 可测试性原则） */
export interface GameRuntimeOptions {
  /** 初始状态（newGameState 产物；构造后由运行时冻结为不可变） */
  state: GameState;
  /** 运行时随机源（DD-09：随存档保存/恢复，回放与回滚一致性的根基） */
  rng: Rng;
  /** 属性定义（派生属性重算依据；缺省 = 无派生属性） */
  attrDefs?: AttrDefs;
  /** 表达式函数注册表（缺省 = 内置 20 函数；脚本扩展由宿主合并冻结后注入） */
  functionRegistry?: ExprFunctionRegistry;
  /** time 求值视图提供器（缺省 = 默认投影；09 号以 TimeConfig 校准注入） */
  timeViewProvider?: TimeViewProvider;
  /** meta 求值投影提供器（缺省 = 空档视图；18 号接入 ProfileStore 后注入） */
  metaProvider?: () => MetaView;
  /** 效果执行器（05 号注册表实现；缺省时任何指令执行都会以 EFFECT_FAILED 报错） */
  effectExecutor?: EffectExecutor;
}

/** 事务内收集器（ExecOutcome 的装配底座） */
interface TransactionFrame {
  jumps: ExecOutcome['jumps'];
  events: EngineEvent[];
  patches: Patch[];
}

/** player 下一级状态域 → 派生触发域标记（§3.1 仅五域触发重算） */
const PLAYER_DOMAIN_TOKENS: Record<string, DerivedTriggerDomain> = {
  attrs: 'attr',
  equip: 'equip',
  outfit: 'outfit',
  body: 'body',
  statuses: 'statuses',
};

const EXEC_SOURCES: readonly string[] = ['choice', 'event', 'hook', 'battle', 'script', 'debug'];

export class GameRuntime {
  #state: GameState;
  readonly #rng: Rng;
  readonly #attrDefs: AttrDefs | undefined;
  readonly #registry: ExprFunctionRegistry;
  readonly #timeView: TimeViewProvider;
  readonly #metaProvider: () => MetaView;
  readonly #executor: EffectExecutor | undefined;

  constructor(options: GameRuntimeOptions) {
    this.#state = freeze(options.state, true);
    this.#rng = options.rng;
    this.#attrDefs = options.attrDefs;
    this.#registry = options.functionRegistry ?? createBuiltinFunctionRegistry();
    this.#timeView = options.timeViewProvider ?? defaultTimeView;
    this.#metaProvider = options.metaProvider ?? (() => DEFAULT_META_VIEW);
    this.#executor = options.effectExecutor;
  }

  /** 当前已提交状态（只读视图；事务提交后指向新对象） */
  get state(): Readonly<GameState> {
    return this.#state;
  }

  /** 运行时随机源（调用方构造 ExecContext 时复用，DD-09 单一序列） */
  get rng(): Rng {
    return this.#rng;
  }

  /**
   * 原子执行一批效果（§3.1 时序图）：全部成功或全部回滚。
   *
   * - 逐指令 produce：指令 i 的定位 where = {...ctx.where, instruction: i}；
   * - 失败：反向应用已应用补丁后抛 EFFECT_FAILED（where 携带 source/scene/
   *   event/battle/instruction，原错误挂 cause）；
   * - 成功：返回 ExecOutcome（jumps 供调用方消费；patches 为全事务补丁集，
   *   含派生属性重算产生的补丁）。
   */
  exec(effects: readonly EffectData[], ctx: ExecContext): ExecOutcome {
    validateExecContext(ctx);
    const frame: TransactionFrame = { jumps: [], events: [], patches: [] };
    const appliedInverse: Patch[][] = [];
    let work = this.#state;

    for (let i = 0; i < effects.length; i++) {
      const instruction = effects[i] as EffectData;
      const where = { ...ctx.where, instruction: i };
      let stepPatches: Patch[] | undefined;
      let stepInverse: Patch[] | undefined;
      try {
        work = produce(
          work,
          (draft) => {
            this.#runInstruction(instruction, ctx, where, draft, frame);
          },
          (patches, inversePatches) => {
            stepPatches = patches;
            stepInverse = inversePatches;
          },
        );
      } catch (err) {
        // 反向应用已应用补丁（§3.1 时序图）：work 从未提交，仍按补丁底座
        // 统一回退后丢弃，保证失败路径与补丁语义一致
        let reverted = work;
        for (let j = appliedInverse.length - 1; j >= 0; j--) {
          reverted = applyPatches(reverted, appliedInverse[j] as Patch[]);
        }
        throw effectFailed(ctx, i, err);
      }
      const patches = stepPatches as Patch[];
      appliedInverse.push(stepInverse as Patch[]);
      frame.patches.push(...patches);
      // 触碰派生相关域 → 立即重算（同事务后续指令的求值可见）
      const touched = touchedFromPatches(patches);
      if (touched.length > 0) {
        work = this.#recomputeDerivedOn(work, touched, ctx, frame);
      }
    }

    this.#state = work;
    return { jumps: frame.jumps, events: frame.events, patches: frame.patches };
  }

  /** 条件求值入口（选项 show_if、事件 require 等统一走这里，§3.1）：原值返回 */
  eval(expr: CompiledExpr): unknown {
    return this.#evalOnView(this.#state, expr, this.#rng);
  }

  /** 布尔语境条件求值（真值化口径与 03 号 evalCondition 一致，DD-01） */
  evalCondition(expr: CompiledExpr): boolean {
    return truthy(this.eval(expr));
  }

  // —— 事务内部管线 ————————————————————————————————————————————————————

  /** 单条指令执行：解析 → 构造 EffectContext → 执行 → 合并静态 jumps */
  #runInstruction(
    instruction: EffectData,
    ctx: ExecContext,
    where: ExecContext['where'],
    draft: WritableDraft<GameState>,
    frame: TransactionFrame,
  ): void {
    const executor = this.#executor;
    if (!executor) {
      throw new EngineError({
        code: 'EFFECT_FAILED',
        where: { detail: '运行时未注入 EffectExecutor（05 号注册表；测试请提供桩执行器）' },
        messageKey: 'error.runtime.noExecutor',
      });
    }
    const execution = executor.resolve(instruction, where);
    const effectCtx: EffectContext = {
      draft,
      rng: ctx.rng,
      evalExpr: (expr) => this.#evalOnView(draft, expr, ctx.rng),
      emit: (event) => {
        frame.events.push(event);
      },
      child: (childEffects, childCtx) => this.#runChild(childEffects, childCtx, draft, frame),
      where,
    };
    execution.execute(effectCtx);
    if (execution.jumps !== undefined) {
      frame.jumps.push(...execution.jumps);
    }
  }

  /**
   * 嵌套原子批（§3.3）：子效果在同一 draft 上顺序执行；任一子指令失败沿
   * 调用栈上抛 → 当前指令失败 → 整批事务回滚。子批 events/jumps 并入父事务
   * frame（顶层 ExecOutcome 统一消费），返回值为子批自身切片；patches 不
   * 重复计数（子批变更并入当前指令的 immer 补丁集）。
   */
  #runChild(
    childEffects: readonly EffectData[],
    childCtx: ExecContext,
    draft: WritableDraft<GameState>,
    frame: TransactionFrame,
  ): ExecOutcome {
    const childFrame: TransactionFrame = { jumps: [], events: [], patches: [] };
    for (let j = 0; j < childEffects.length; j++) {
      const sub = childEffects[j] as EffectData;
      const subWhere = { ...childCtx.where, instruction: j };
      try {
        this.#runInstruction(sub, childCtx, subWhere, draft, childFrame);
      } catch (err) {
        // 子指令失败先按子批定位包装，再由父指令统一包装为 EFFECT_FAILED
        // （诊断链保留 scene/instruction 两级定位，§10.2）
        throw effectFailed(childCtx, j, err);
      }
    }
    frame.events.push(...childFrame.events);
    frame.jumps.push(...childFrame.jumps);
    return { jumps: childFrame.jumps, events: childFrame.events, patches: childFrame.patches };
  }

  /** 触碰域命中时的派生重算（独立 produce，重算补丁并入事务补丁集） */
  #recomputeDerivedOn(
    work: GameState,
    touched: readonly DerivedTriggerDomain[],
    ctx: ExecContext,
    frame: TransactionFrame,
  ): GameState {
    const attrDefs = this.#attrDefs;
    if (!attrDefs) return work;
    let patches: Patch[] | undefined;
    const next = produce(
      work,
      (draft) => {
        recomputeDerived(draft, touched, attrDefs, {
          rng: ctx.rng,
          registry: this.#registry,
          timeView: this.#timeView(draft.world.time),
          meta: this.#metaProvider(),
        });
      },
      (collected) => {
        patches = collected;
      },
    );
    if (patches !== undefined) frame.patches.push(...patches);
    return next;
  }

  /** 以给定状态视图（可为 draft）构造作用域并求值（§3.2 求值上下文） */
  #evalOnView(view: GameState, expr: CompiledExpr, rng: Rng): unknown {
    const scope = buildExprScope(view, {
      time: this.#timeView(view.world.time),
      meta: this.#metaProvider(),
    });
    return evalExpr(expr, { state: scope, rng, registry: this.#registry });
  }
}

// —— 模块级辅助（无状态纯函数） ————————————————————————————————————————

/** ExecContext 校验（source 白名单 + rng 存在；非法 = 契约违规 INTERNAL） */
function validateExecContext(ctx: ExecContext): void {
  if (typeof ctx !== 'object' || ctx === null) {
    throw internalInvalidContext('ExecContext 缺失');
  }
  if (!EXEC_SOURCES.includes(ctx.source)) {
    throw internalInvalidContext(`未知事务来源 '${String(ctx.source)}'`);
  }
  if (typeof ctx.rng !== 'object' || ctx.rng === null) {
    throw internalInvalidContext('ExecContext.rng 缺失（DD-09 随机源必须注入）');
  }
}

function internalInvalidContext(detail: string): EngineError {
  return new EngineError({
    code: 'INTERNAL',
    where: { detail },
    messageKey: 'error.runtime.invalidExecContext',
  });
}

/** 指令失败的统一包装（EFFECT_FAILED：where 定位 + cause 保留原始错误） */
function effectFailed(ctx: ExecContext, index: number, cause: unknown): EngineError {
  const where: Record<string, string> = { source: ctx.source };
  const { scene, event, battle } = ctx.where;
  if (scene !== undefined) where['scene'] = scene;
  if (event !== undefined) where['event'] = event;
  if (battle !== undefined) where['battle'] = battle;
  where['instruction'] = String(index);
  return new EngineError({
    code: 'EFFECT_FAILED',
    where,
    messageKey: 'error.runtime.effectFailed',
    cause,
  });
}

/** 从补丁路径提取派生触发域（patch.path[0] === 'player' 的下一级映射） */
function touchedFromPatches(patches: readonly Patch[]): DerivedTriggerDomain[] {
  const found = new Set<DerivedTriggerDomain>();
  for (const patch of patches) {
    if (patch.path[0] !== 'player') continue;
    const token = PLAYER_DOMAIN_TOKENS[String(patch.path[1])];
    if (token !== undefined) found.add(token);
  }
  return [...found];
}
