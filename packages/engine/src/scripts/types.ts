import type { EffectData, ExprFunctionDef } from '@game/shared';
import type { CheckRule, EffectInstructionDef } from '../effects/index.js';
import type { ExecOutcome, GameRuntime } from '../runtime/index.js';

/**
 * 作者脚本宿主契约（设计 §5.9，23 号；**M2 末冻结面**——破坏性变更需里程碑评审）。
 *
 * 四类扩展点 + 事务边界（2026-09-25 人类裁定）：
 * - `registerEffect` / `registerFunction` / `registerCheckRule`：加载期注册
 *   （管线步骤 6，先注册后冻结；命名空间 `x.<script>.<name>`，DD-08）；
 * - `onHook`：运行期钩子（四类，见 {@link HookName}）；
 * - `transaction`：脚本**唯一**状态入口（exec 包装，不暴露原始 draft）；
 *   返回 **不含 jumps**，且脚本提交流程指令 → `SCRIPT_CONTRACT` 错误
 *   （脚本只改状态，不控制叙事流）。
 *
 * 能力面（OQ-11 复核结论，2026-09-25）：**最小面**——仅引擎事务 API + 纯计算；
 * 网络 / 文件系统 / 定时器均不开放（替代路径：云功能归宿主、持久化归存档、
 * 延迟效果归时间管线）。未来需求由**宿主注入能力**，引擎不开放裸 API。
 */

/**
 * 钩子名（设计 §5.9 的 `TimeHook | 'loop_transition' | 'battle_round_end' | 'load_complete'`）。
 *
 * 语义（2026-09-25 裁定，逐项）：
 * - `before_rollover` / `slot_advance` / `day_rollover`：时间管线步骤 0 / 每次推进 /
 *   步骤 4（`slot_advance` 为本次补齐——设计三值，M1 只落两槽）；
 * - `loop_transition`：**周目切换后**（新状态已就位）；
 * - `battle_round_end`：**整回合结束**（全部单位行动完、下一轮开始前，每轮一次）；
 * - `load_complete`：**全部恢复完成后**（迁移 → 周目恢复 → 状态就位，DD-10 末环）。
 */
export type HookName =
  | 'before_rollover'
  | 'slot_advance'
  | 'day_rollover'
  | 'loop_transition'
  | 'battle_round_end'
  | 'load_complete';

/** 钩子上下文（脚本据此决定行为；字段为只读快照，非可变状态入口） */
export interface HookContext {
  /** 钩子名（handler 复用同一函数时用于分支） */
  readonly hook: HookName;
  /** 时间类钩子的推进信息（非时间钩子为 undefined） */
  readonly time?: {
    readonly slots: number;
    readonly crossedDay: boolean;
    readonly crossedWeek: boolean;
    readonly crossedMonth: boolean;
  };
  /** 周目钩子：切换后的周目序号 */
  readonly loop?: number;
  /** 战斗钩子：当前回合序号（从 1 起） */
  readonly round?: number;
}

/**
 * 钩子处理器（同步；返回要提交的效果指令批次，可空）。
 *
 * **错误隔离**（裁定）：单个 handler 抛错只记诊断，不阻断管线——脚本是可选
 * 增强，不应让游戏不可玩。
 */
export type HookHandler = (host: ScriptHost, ctx: HookContext) => readonly EffectData[] | undefined;

/**
 * 脚本宿主（运行期面；`ScriptSetupApi` 的宿主侧对应物）。
 *
 * `transaction` 是脚本改状态的唯一入口：
 * - 内部即 `GameRuntime.exec` 包装的指令批（原子事务，§3.1）；
 * - 返回 `{ events, patches }`——**不含 jumps**；
 * - 提交流程指令（goto/back/ending/loop_transition）→ `SCRIPT_CONTRACT` 错误。
 */
export interface ScriptHost {
  /** 事务入口（脚本唯一状态写入面；原子、可回滚） */
  transaction(effects: readonly EffectData[]): ScriptTransactionResult;
}

/** 事务结果（脚本可见面；jumps 有意不暴露，见 {@link ScriptHost}） */
export interface ScriptTransactionResult {
  readonly events: ExecOutcome['events'];
  readonly patches: ExecOutcome['patches'];
}

/**
 * 加载期注册 API（设计 §5.9 `ScriptSetupApi`）。
 * 与 `loader/types.ts` 的同名契约保持一致（本文件为 23 号的权威定义，
 * loader 侧改为 re-export 以免双份漂移）。
 */
export interface ScriptSetupApi {
  /** 注册作者扩展效果指令：id 必须 `x.<script>.<name>`（DD-08） */
  registerEffect(def: EffectInstructionDef<unknown>): void;
  /** 注册作者扩展表达式函数：name 必须 `x.<script>.<name>`（DD-08） */
  registerFunction(def: ExprFunctionDef): void;
  /** 注册作者扩展判定规则（§5.1 CheckRule；'x.<script>.<rule>' 可插拔） */
  registerCheckRule(rule: CheckRule): void;
  /**
   * 注册运行期钩子（本次新增；设计 §5.9 四类）。
   * 同一钩子可注册多个 handler——**按注册序依次执行**（确定性）。
   */
  onHook(hook: HookName, handler: HookHandler): void;
}

/**
 * 作者脚本模块（设计 §5.9 `ScriptModule`，§9.2 编译产物接口）：引擎只接受
 * 宿主注入的模块实例（NFR-19 / FR-SCR-06，运行期无任何动态加载）。
 */
export interface ScriptModule {
  /** 脚本模块 id（`x.*` 命名空间段使用） */
  readonly id: string;
  setup(api: ScriptSetupApi): void;
}

/** 运行期运行时视图（宿主注入；仅暴露事务与只读状态，不含 IO） */
export interface ScriptHostDeps {
  /** 宿主运行时（事务执行面） */
  readonly runtime: GameRuntime;
}
