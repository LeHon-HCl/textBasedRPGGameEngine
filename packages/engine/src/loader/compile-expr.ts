import { EngineError } from '@game/shared';
import type { CompiledExpr, ExprFunctionDef, ExprFunctionRegistry, ExprSource } from '@game/shared';
import { compileExpr, createBuiltinFunctionRegistry } from '../expr-eval/index.js';

/**
 * compile 步骤的 x.* 函数延迟注册表（管线次序保障，设计 §3.4 步骤 5→6）。
 *
 * 步骤 5 编译表达式时脚本（步骤 6）尚未注册：数据表达式对 `x.<script>.<name>`
 * 的调用此时不能按「未知函数」阻断，也不能执行——本注册表对 x.* 名称返回
 * 占位函数并**登记引用**；步骤 6 注册完成后由 scripts 步骤逐一核对存在性
 * （缺失 → SCRIPT_CONTRACT，FR-SCR-04）与纯度（非纯函数出现在缓存敏感位置
 * → EXPR_COMPILE，DD-01）。非 x.* 的未知函数维持 DD-01 语义：get 返回
 * undefined → compileExpr 抛 EXPR_COMPILE。
 */
export class DeferredXFunctionRegistry extends Map<string, ExprFunctionDef> {
  readonly #referenced = new Map<string, { name: string; requirePure: boolean }>();

  constructor(base: ExprFunctionRegistry = createBuiltinFunctionRegistry()) {
    super(base);
  }

  override get(name: string): ExprFunctionDef | undefined {
    const def = super.get(name);
    if (def !== undefined) return def;
    if (name.startsWith('x.')) {
      if (!this.#referenced.has(name)) {
        this.#referenced.set(name, { name, requirePure: false });
      }
      return X_PLACEHOLDER;
    }
    return undefined;
  }

  override has(name: string): boolean {
    return super.has(name) || (name.startsWith('x.') && this.#referenced.has(name));
  }

  /** 编译期引用过的 x.* 函数名（登记顺序稳定） */
  referencedNames(): readonly string[] {
    return [...this.#referenced.keys()];
  }

  /** x.* 引用清单（含是否缓存敏感位置，scripts 步骤核对用） */
  referenced(): Array<{ name: string; requirePure: boolean }> {
    return [...this.#referenced.values()];
  }

  /** 标记某个 x.* 引用出现在缓存敏感位置（事件 require 等，DD-01） */
  markRequireSensitive(name: string): void {
    const entry = this.#referenced.get(name);
    if (entry !== undefined) this.#referenced.set(name, { ...entry, requirePure: true });
  }
}

/** x.* 占位函数：加载期绝不执行（误用时显性失败），纯度待步骤 6 核对 */
const X_PLACEHOLDER: ExprFunctionDef = {
  name: 'x.__deferred__',
  arity: [0, Number.MAX_SAFE_INTEGER],
  pure: true,
  fn: () => {
    throw new EngineError({
      code: 'INTERNAL',
      where: { fn: 'x.__deferred__', detail: 'x.* 占位函数仅用于加载期编译' },
      messageKey: 'error.loader.deferredXCall',
    });
  },
};

/**
 * 表达式编译入缓存（设计 §3.4「表达式编译入缓存」，DD-01 编译期校验）：
 * 同一原文只编译一次（exprCache 键 = 原文）；requirePure 位点（事件 require）
 * 以 CompileOptions.requirePure 编译。失败抛出 EXPR_COMPILE（含原文定位）。
 */
export function compileExprIntoCache(
  site: { readonly source: ExprSource; readonly requirePure: boolean },
  registry: ExprFunctionRegistry,
  exprCache: Map<string, CompiledExpr>,
): void {
  if (exprCache.has(site.source)) return;
  const compiled = compileExpr(site.source, registry, { requirePure: site.requirePure });
  exprCache.set(site.source, compiled);
}
