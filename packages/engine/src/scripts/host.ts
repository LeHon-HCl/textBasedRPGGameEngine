import { EngineError } from '@game/shared';
import type { EffectData, GameId } from '@game/shared';
import type {
  HookContext,
  HookHandler,
  HookName,
  ScriptHost,
  ScriptHostDeps,
  ScriptTransactionResult,
} from './types.js';

/**
 * 脚本宿主实现（设计 §5.9，23 号；2026-09-25 六项裁定落地）。
 *
 * 两个职责：
 * 1. **运行期事务门面**（{@link createScriptHost}）：`transaction(effects)` 是
 *    脚本唯一状态入口——exec 包装；**拒绝流程指令**（goto/back/ending/
 *    loop_transition → SCRIPT_CONTRACT）；返回面不含 jumps；
 * 2. **钩子注册表**（{@link HookRegistry}）：加载期 `onHook` 收集 handler，
 *    运行期按**注册序**依次触发（确定性）；单个 handler 抛错**只记诊断不阻断**
 *    （脚本是可选增强，不应让游戏不可玩）。
 */

/** 流程类指令 id（脚本不得提交——只改状态，不控制叙事流；2026-09-25 裁定） */
const FLOW_INSTRUCTION_IDS = ['goto', 'back', 'ending', 'loop_transition'] as const;

/** 检查效果批次是否含流程指令（返回首个违规指令 id；无则 null） */
export function findFlowInstruction(effects: readonly EffectData[]): string | null {
  for (const effect of effects) {
    if (typeof effect !== 'object' || effect === null) continue;
    const record = effect as Record<string, unknown>;
    for (const id of FLOW_INSTRUCTION_IDS) {
      if (id in record) return id;
    }
    // 分支指令的子效果同样检查（check 的 onSuccess/onFail 等）
    for (const field of ['onSuccess', 'onFail', 'onCritical', 'onFumble'] as const) {
      const branch = record['check'];
      if (typeof branch !== 'object' || branch === null) continue;
      const nested = (branch as Record<string, unknown>)[field];
      if (Array.isArray(nested)) {
        const inner = findFlowInstruction(nested as EffectData[]);
        if (inner !== null) return inner;
      }
    }
  }
  return null;
}

/**
 * 创建脚本宿主（运行期）。
 *
 * @throws SCRIPT_CONTRACT：脚本提交了流程指令（见 {@link findFlowInstruction}）
 */
export function createScriptHost(deps: ScriptHostDeps): ScriptHost {
  return {
    transaction(effects: readonly EffectData[]): ScriptTransactionResult {
      const violation = findFlowInstruction(effects);
      if (violation !== null) {
        throw new EngineError({
          code: 'SCRIPT_CONTRACT',
          where: {
            op: 'script',
            instruction: violation,
            detail: `脚本不得提交流程指令 '${violation}'（脚本只改状态，叙事流由数据层控制；2026-09-25 裁定）`,
          },
          messageKey: 'error.script.flowForbidden',
        });
      }
      const outcome = deps.runtime.exec(effects, {
        source: 'script',
        where: { script: 'x' },
        rng: deps.runtime.rng,
      });
      // 返回面有意不含 jumps（见 types.ts 的 ScriptTransactionResult）
      return { events: outcome.events, patches: outcome.patches };
    },
  };
}

/** 钩子触发的诊断记录（错误隔离：单个 handler 抛错只记这里，不阻断管线） */
export interface HookDiagnostic {
  readonly hook: HookName;
  /** 出错的脚本模块 id */
  readonly scriptId: GameId | string;
  readonly error: Error;
}

/**
 * 钩子注册表（加载期收集 + 运行期触发）。
 *
 * 注册序即执行序（确定性）；同钩子多 handler 依次执行，前面 handler 提交的
 * 效果不会影响后面 handler 的调用（各自独立事务）。
 */
export class HookRegistry {
  readonly #handlers = new Map<HookName, { scriptId: string; handler: HookHandler }[]>();
  readonly #diagnostics: HookDiagnostic[] = [];

  /** 加载期注册（`ScriptSetupApi.onHook` 的转发面） */
  register(scriptId: string, hook: HookName, handler: HookHandler): void {
    const bucket = this.#handlers.get(hook) ?? [];
    bucket.push({ scriptId, handler });
    this.#handlers.set(hook, bucket);
  }

  /** 注册的钩子名清单（诊断/测试用） */
  registeredHooks(): readonly HookName[] {
    return [...this.#handlers.keys()];
  }

  /** 某钩子的 handler 数量（触发序断言用） */
  count(hook: HookName): number {
    return this.#handlers.get(hook)?.length ?? 0;
  }

  /** 触发诊断（错误隔离的记录面；测试与调试面板消费） */
  diagnostics(): readonly HookDiagnostic[] {
    return [...this.#diagnostics];
  }

  /**
   * 收集钩子效果（**不执行事务**，按注册序拼接）。
   *
   * 用途：时间管线契约要求「钩子只收集数据，执行由 runtime.exec 统一完成」
   * （一次推进 = 一个 undo 点）——管线侧经本方法取效果，而非 {@link fire}。
   * 抛错的 handler 记诊断后跳过（错误隔离）。
   */
  collect(host: ScriptHost, ctx: HookContext): readonly EffectData[] {
    const bucket = this.#handlers.get(ctx.hook);
    if (bucket === undefined) return [];
    const effects: EffectData[] = [];
    for (const entry of bucket) {
      try {
        const produced = entry.handler(host, ctx);
        if (Array.isArray(produced)) effects.push(...produced);
      } catch (error) {
        this.#diagnostics.push({
          hook: ctx.hook,
          scriptId: entry.scriptId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
    return effects;
  }

  /**
   * 触发钩子（按注册序，**各自独立事务**）。
   *
   * 每个 handler 独立调用：抛错 → 记诊断 → **继续执行后续 handler**（错误隔离，
   * 2026-09-25 裁定）。返回成功提交的效果条数（诊断面用）。
   *
   * 与 {@link collect} 的区别：本方法立即执行事务（用于非管线场景，如周目切换/
   * 战斗回合/读档完成后的宿主动作）；管线场景用 collect（合并进同一次事务）。
   */
  fire(host: ScriptHost, ctx: HookContext): number {
    const bucket = this.#handlers.get(ctx.hook);
    if (bucket === undefined) return 0;
    let committed = 0;
    for (const entry of bucket) {
      try {
        const effects = entry.handler(host, ctx);
        if (Array.isArray(effects) && effects.length > 0) {
          host.transaction(effects);
          committed += effects.length;
        }
      } catch (error) {
        // 错误隔离：脚本是可选增强，不应让游戏不可玩（裁定）
        this.#diagnostics.push({
          hook: ctx.hook,
          scriptId: entry.scriptId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
    return committed;
  }
}

/**
 * 为某脚本模块构造 `onHook` 注册函数（加载期注入 `ScriptSetupApi` 用）。
 *
 * 用法（loader 步骤 6）：
 * ```ts
 * const registry = new HookRegistry();
 * for (const module of modules) {
 *   module.setup({ ...effectApis, onHook: hookRegistrarFor(registry, module.id) });
 * }
 * ```
 */
export function hookRegistrarFor(
  registry: HookRegistry,
  scriptId: string,
): (hook: HookName, handler: HookHandler) => void {
  return (hook, handler) => registry.register(scriptId, hook, handler);
}
