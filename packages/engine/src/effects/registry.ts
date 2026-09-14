import { EngineError } from '@game/shared';
import type { EffectData, ExprFunctionRegistry } from '@game/shared';
import { compileExpr, createBuiltinFunctionRegistry } from '../expr-eval/index.js';
import type { EffectContext, EffectExecution, EffectExecutor } from '../runtime/index.js';
import type { JumpTarget } from '../runtime/index.js';
import { eraseDef } from './types.js';
import type {
  EffectExecuteContext,
  EffectInstructionDef,
  EffectRegistryOptions,
  ErasedEffectDef,
} from './types.js';

/**
 * 效果指令注册表（设计 §3.3 内置指令注册表；05 任务 A1）。
 *
 * - 实现 04 号 `EffectExecutor` 最小接口：`resolve` 把单键 EffectData 解析为
 *   可执行句柄——id 查找 → 02 号参数 schema 校验（effectParamSchemas 为基准，
 *   数据加载期与运行期共用）→ 组装 EffectExecution（execute + 跳转 sink）；
 * - 重复 id 注册冲突报 DUP_ID（加载期错误码，§2.2）；作者扩展注册的 id 必须
 *   `x.<script>.<name>`（DD-08），违例报 SCRIPT_CONTRACT——内置指令经构造器
 *   装配，不受该约束（call 指令在执行期校验 fn 命名空间，05 任务 A3）；
 * - 跳转通道：目标静态可知的指令经 `def.jumps` 在解析期声明；动态目标
 *   （advance_time 的 cost 表达式）经 EffectExecuteContext.emitJump 在执行期
 *   收集——两条通道都汇入 EffectExecution.jumps，由 GameRuntime 并入
 *   ExecOutcome（§3.3「跳转类指令不改状态」分界，05 任务 B4 验证）；
 * - 未注册指令 / 参数校验失败抛 EFFECT_FAILED（运行时包装后附 instruction
 *   序号定位，04 号 exec 管线职责）。
 */

/** 作者扩展指令 id 形态（DD-08）：x.<script>.<name>，段为 GameId 形态 */
const X_NAMESPACE_PATTERN = /^x\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * 效果指令注册表（设计 §3.3；05 号）。
 *
 * 实现 04 号 `EffectExecutor` 最小接口：`resolve` 把单键 `EffectData` 解析为可执行
 * 句柄（id 查找 → 参数 schema 校验 → 组装 `EffectExecution`）；`execute` 由运行时
 * 在事务内调用。注册面约束：
 * - 重复 id → `DUP_ID`；作者扩展 id 必须 `x.<script>.<name>`（DD-08），违例
 *   `SCRIPT_CONTRACT`——内置指令经构造器装配，不受该约束；
 * - `__` 前缀为引擎内部命名空间，拒绝经 `register()` 注册（内部指令走
 *   {@link EffectRegistryOptions} 在构造期装配）；
 * - 冻结后（`freeze()`）不再接受注册，加载管线的 scripts 步骤依赖该语义。
 */
export class EffectRegistry implements EffectExecutor {
  readonly #defs = new Map<string, ErasedEffectDef>();
  readonly #options: EffectRegistryOptions;
  readonly #functionRegistry: ExprFunctionRegistry;
  #frozen = false;

  constructor(
    options: EffectRegistryOptions = {},
    builtins: readonly EffectInstructionDef<unknown>[] = [],
  ) {
    this.#options = options;
    this.#functionRegistry = options.functionRegistry ?? createBuiltinFunctionRegistry();
    validateOptions(options);
    for (const def of builtins) {
      this.#registerBuiltin(def);
    }
  }

  /** 注册表选项（内置指令工厂读取的目录 / 配置注入面） */
  get options(): EffectRegistryOptions {
    return this.#options;
  }

  /**
   * 注册作者扩展指令（DD-08）：id 必须 `x.<script>.<name>`，与已注册 id
   * （含内置指令）冲突报 DUP_ID。脚本宿主（23 号）在加载期调用；注册表
   * 冻结后（加载管线步骤 6 完成，§3.4）调用报 SCRIPT_CONTRACT。
   */
  register<T>(def: EffectInstructionDef<T>): void {
    if (this.#frozen) {
      throw new EngineError({
        code: 'SCRIPT_CONTRACT',
        where: { id: def.id, detail: '效果注册表已冻结（加载管线步骤 6 完成，§3.4）' },
        messageKey: 'error.effects.registryFrozen',
      });
    }
    if (!X_NAMESPACE_PATTERN.test(def.id)) {
      throw new EngineError({
        code: 'SCRIPT_CONTRACT',
        where: { id: def.id, detail: "作者扩展指令 id 必须 'x.<script>.<name>'（DD-08）" },
        messageKey: 'error.effects.namespaceViolation',
      });
    }
    if (this.#defs.has(def.id)) {
      throw new EngineError({
        code: 'DUP_ID',
        where: { id: def.id, detail: '效果指令 id 重复注册' },
        messageKey: 'error.effects.dupId',
      });
    }
    this.#defs.set(def.id, eraseDef(def));
  }

  /** 按 id 查找已注册指令（call 转发 / 调试自省用） */
  lookup(id: string): ErasedEffectDef | undefined {
    return this.#defs.get(id);
  }

  /**
   * 冻结注册表（加载管线步骤 6 完成，设计 §3.4）：冻结后 register 一律报
   * SCRIPT_CONTRACT。冻结语义由宿主（06 号加载器 / 脚本宿主 23 号）在
   * ScriptModule.setup 全部执行完毕后调用。
   */
  freeze(): void {
    this.#frozen = true;
  }

  /** 注册表是否已冻结（调试自省与测试用） */
  get frozen(): boolean {
    return this.#frozen;
  }

  /** 已注册指令 id 清单（加载期诊断与指令矩阵测试用） */
  ids(): readonly string[] {
    return [...this.#defs.keys()];
  }

  /**
   * 解析一条指令为可执行句柄（EffectExecutor 契约）：调用方定位（where）由
   * 运行时在包装 EFFECT_FAILED 时统一附加，本实现不重复消费。
   * 单键对象 → id 查找 → 参数 schema 校验 → EffectExecution。
   * 跳转 sink 在解析期创建：静态声明（def.jumps）即刻入列，执行期动态产出
   * （emitJump）追加——GameRuntime 在 execute 后读取 execution.jumps。
   */
  resolve(instruction: EffectData): EffectExecution {
    if (typeof instruction !== 'object' || instruction === null || Array.isArray(instruction)) {
      throw resolveError('error.effects.invalidShape', '效果指令必须为单键对象', {});
    }
    const record = instruction as unknown as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== 1) {
      throw resolveError(
        'error.effects.invalidShape',
        `效果指令必须为单键对象，实际键数 ${String(keys.length)}`,
        {},
      );
    }
    const id = keys[0] as string;
    const def = this.#defs.get(id);
    if (def === undefined) {
      throw resolveError('error.effects.unknownInstruction', `未注册的效果指令 '${id}'`, {
        op: id,
      });
    }
    const parsed = def.schema.safeParse(record[id]);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue !== undefined ? issue.path.map(String).join('.') : '';
      throw resolveError(
        'error.effects.invalidParams',
        `指令 '${id}' 参数校验失败：${issue !== undefined ? issue.message : '未知问题'}`,
        { op: id, ...(path !== '' ? { param: path } : {}) },
      );
    }
    const arg = parsed.data as never;
    const sink: JumpTarget[] = [];
    if (def.jumps !== undefined) {
      sink.push(...def.jumps(arg));
    }
    return {
      get jumps(): readonly JumpTarget[] {
        return sink;
      },
      execute: (ectx: EffectContext): void => {
        def.execute(arg, this.#extendContext(ectx, sink));
      },
    };
  }

  /** 内置指令装配（构造器专用，不受 x.* 命名空间约束） */
  #registerBuiltin(def: EffectInstructionDef<unknown>): void {
    if (this.#defs.has(def.id)) {
      throw new EngineError({
        code: 'DUP_ID',
        where: { id: def.id, detail: '内置效果指令 id 重复装配' },
        messageKey: 'error.effects.dupId',
      });
    }
    this.#defs.set(def.id, eraseDef(def));
  }

  /**
   * 交付给指令执行体的上下文：EffectContext 的注册表内部超集
   * （EffectExecuteContext）——emitJump 收集动态跳转入 sink；evalSource 以
   * 注册表持有的函数注册表编译参数表达式后经 ctx.evalExpr 求值（当前 draft
   * 实时视图，前序指令变更可见，§3.2 求值上下文）。
   */
  #extendContext(ectx: EffectContext, sink: JumpTarget[]): EffectExecuteContext {
    const fnRegistry = this.#functionRegistry;
    return {
      ...ectx,
      emitJump: (target: JumpTarget): void => {
        sink.push(target);
      },
      evalSource: (source: string): unknown => ectx.evalExpr(compileExpr(source, fnRegistry)),
    };
  }
}

/** 注册表选项契约校验（构造期显性化，契约违规 = INTERNAL） */
function validateOptions(options: EffectRegistryOptions): void {
  const capacity = options.bagCapacity;
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 0)) {
    throw optionError(`bagCapacity 必须为非负整数，实际为 ${String(capacity)}`);
  }
  const bounds = options.reputationBounds;
  if (
    bounds !== undefined &&
    (!Number.isFinite(bounds.min) || !Number.isFinite(bounds.max) || bounds.min > bounds.max)
  ) {
    throw optionError(
      `reputationBounds 必须 min ≤ max 且为有限数，实际 [${String(bounds.min)}, ${String(bounds.max)}]`,
    );
  }
}

function optionError(detail: string): EngineError {
  return new EngineError({
    code: 'INTERNAL',
    where: { detail },
    messageKey: 'error.effects.invalidOptions',
  });
}

/** resolve 期错误（EFFECT_FAILED）：op 为指令 id，运行时包装后附序号定位 */
function resolveError(
  messageKey: string,
  detail: string,
  where: Record<string, string>,
): EngineError {
  return new EngineError({
    code: 'EFFECT_FAILED',
    where: { ...where, detail },
    messageKey,
  });
}
