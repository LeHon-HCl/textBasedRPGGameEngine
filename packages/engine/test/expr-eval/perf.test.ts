import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { CompiledExpr, EvalContext } from '@game/shared';
import { compileExpr } from '../../src/expr-eval/compile.js';
import { evalExpr } from '../../src/expr-eval/eval.js';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/builtins.js';
import { makeCtx, makeScope } from './fixtures.js';

/**
 * 03 任务 C4：性能烟测（供 10 号模块事件池 16ms 预算推算，NFR-02）。
 *
 * 预算口径：单表达式求值 < 0.1ms（设计 §3.2 / 03 任务书 C4）。
 * 烟测性质：非严格预算门禁——在常规 CI 负载下留有约一个数量级余量；
 * 若此处失败说明求值器出现数量级劣化（如误加了每次求值的重编译/深拷贝），
 * 应先本地复测再定位。AST 不可变可缓存（编译一次、求值多次）。
 */

const REGISTRY = createBuiltinFunctionRegistry();

/** 代表性表达式：路径 + 查询/随机函数 + 算术/比较/逻辑 + 三元 */
const SOURCE =
  'flag("door_opened") && attr.hp < 50 ? randInt(1, 6) + item.potion.count : clamp(attr.strength * 2, 1, 20)';

function compileOnce(): CompiledExpr {
  return compileExpr(SOURCE, REGISTRY);
}

function timeEval(compiled: CompiledExpr, ctx: EvalContext, iterations: number): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    evalExpr(compiled, ctx);
  }
  return (performance.now() - start) / iterations;
}

describe('C4：性能烟测（单表达式求值 < 0.1ms）', () => {
  it('编译一次后重复求值：平均单次耗时 < 0.1ms', () => {
    const compiled = compileOnce();
    const ctx = makeCtx(makeScope(), createRng(42), REGISTRY);

    // 预热（JIT + 内联缓存），不计入测量
    for (let i = 0; i < 2000; i++) {
      evalExpr(compiled, ctx);
    }

    const avgMs = timeEval(compiled, ctx, 20000);
    // 诊断输出（ vitest 报告可见）
    console.log(`[perf-smoke] eval avg = ${avgMs.toFixed(4)}ms (budget 0.1ms)`);
    expect(avgMs).toBeLessThan(0.1);
  });

  it('编译开销 sanity：平均单次编译 < 2ms（烟测）', () => {
    // 预热
    for (let i = 0; i < 50; i++) {
      compileOnce();
    }
    const start = performance.now();
    const iterations = 500;
    for (let i = 0; i < iterations; i++) {
      compileOnce();
    }
    const avgMs = (performance.now() - start) / iterations;
    console.log(`[perf-smoke] compile avg = ${avgMs.toFixed(4)}ms`);
    expect(avgMs).toBeLessThan(2);
  });

  it('编译产物可复用：同一 CompiledExpr 在不同上下文中求值一致', () => {
    const compiled = compileOnce();
    const a = evalExpr(compiled, makeCtx(makeScope(), createRng(42), REGISTRY));
    const b = evalExpr(compiled, makeCtx(makeScope(), createRng(42), REGISTRY));
    // 同种子同状态 → 结果一致（DD-09 可回放）
    expect(b).toBe(a);
  });
});
