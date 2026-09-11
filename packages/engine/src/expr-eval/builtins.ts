import { EngineError } from '@game/shared';
import type { EvalContext, ExprFunctionDef, ExprFunctionRegistry } from '@game/shared';

/**
 * 内置函数注册表（设计 §2.3 内置函数 v1 清单，DD-01 冻结 20 个；§3.2，03 任务 B3）。
 *
 * 清单冻结：新增函数必须升 schemaVersion 并修订设计 §2.3 表格（M0 冻结范围）。
 * pure 语义：pure=true = 无副作用且不消耗随机序列（可出现在缓存敏感位置）；
 * pure=false = 随机类（经 ctx.rng 消耗序列），编译期 requirePure 语境拦截。
 *
 * 实参契约（fn 收到的 args 已求值）：参数类型不符 → `EVAL_ERROR`
 * invalidArgument；封闭域未知键（rep/body）→ `EVAL_ERROR` missingKey；
 * 渐进域按 ExprScope 缺席语义返回定义值（flag→undefined、count→0、
 * met→false、favor（未登场）→0、quest（未开始）→undefined）。
 * 求值器负责在 where 中补注表达式原文（eval.ts 的错误包装）。
 */

/** 函数级求值错误（EVAL_ERROR）：where 携带 fn 与参数位（expr 由求值器补注） */
function builtinError(
  fn: string,
  messageKey: string,
  detail: string,
  extra?: Record<string, string>,
): EngineError {
  return new EngineError({
    code: 'EVAL_ERROR',
    where: { fn, ...extra, detail },
    messageKey,
  });
}

function describeArg(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return typeof value;
}

function requireNumber(fn: string, index: number, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw builtinError(
      fn,
      'error.eval.invalidArgument',
      `函数 '${fn}' 的第 ${index} 个参数要求有限 number，实际为 ${describeArg(value)}`,
      { arg: String(index) },
    );
  }
  return value;
}

function requireInteger(fn: string, index: number, value: unknown): number {
  const n = requireNumber(fn, index, value);
  if (!Number.isInteger(n)) {
    throw builtinError(
      fn,
      'error.eval.invalidArgument',
      `函数 '${fn}' 的第 ${index} 个参数要求整数，实际为 ${n}`,
      { arg: String(index) },
    );
  }
  return n;
}

function requireString(fn: string, index: number, value: unknown): string {
  if (typeof value !== 'string') {
    throw builtinError(
      fn,
      'error.eval.invalidArgument',
      `函数 '${fn}' 的第 ${index} 个参数要求 string，实际为 ${describeArg(value)}`,
      { arg: String(index) },
    );
  }
  return value;
}

/** 随机类（pure=false，接注入 Rng，DD-09：同种子序列确定可回放） —————— */

function randFn(args: unknown[], ctx: EvalContext): unknown {
  const min = requireNumber('rand', 1, args[0]);
  const max = requireNumber('rand', 2, args[1]);
  if (max < min) {
    throw builtinError(
      'rand',
      'error.eval.invalidRange',
      `rand 要求 min ≤ max，实际 ${min} > ${max}`,
    );
  }
  return min + ctx.rng.next() * (max - min);
}

function randIntFn(args: unknown[], ctx: EvalContext): unknown {
  const min = requireInteger('randInt', 1, args[0]);
  const max = requireInteger('randInt', 2, args[1]);
  if (min > max) {
    throw builtinError(
      'randInt',
      'error.eval.invalidRange',
      `randInt 要求 min ≤ max，实际 ${min} > ${max}`,
    );
  }
  return ctx.rng.int(min, max);
}

function chanceFn(args: unknown[], ctx: EvalContext): unknown {
  const p = requireNumber('chance', 1, args[0]);
  if (p < 0 || p > 1) {
    throw builtinError(
      'chance',
      'error.eval.invalidProbability',
      `chance 要求 p ∈ [0,1]，实际 ${p}`,
    );
  }
  return ctx.rng.chance(p);
}

/** 物品/服装查询（pure=true） ————————————————————————————————————————— */

function hasFn(args: unknown[], ctx: EvalContext): unknown {
  const itemId = requireString('has', 1, args[0]);
  return (ctx.state.bagCounts[itemId] ?? 0) > 0;
}

function countFn(args: unknown[], ctx: EvalContext): unknown {
  const itemId = requireString('count', 1, args[0]);
  return ctx.state.bagCounts[itemId] ?? 0;
}

function wornFn(args: unknown[], ctx: EvalContext): unknown {
  const part = requireString('worn', 1, args[0]);
  const outfitPart = ctx.state.player.outfit[part];
  if (args.length === 2) {
    const layerArg = args[1];
    const key =
      typeof layerArg === 'number'
        ? String(requireNumber('worn', 2, layerArg))
        : requireString('worn', 2, layerArg);
    return outfitPart?.[key] ?? null; // 该层未穿戴 → null
  }
  if (outfitPart === undefined) return null; // 渐进域：part 缺席 → null
  const numericLayers = Object.keys(outfitPart)
    .filter((key) => /^\d+$/.test(key))
    .map(Number)
    .sort((a, b) => a - b);
  if (numericLayers.length === 0) return null;
  return outfitPart[String(numericLayers[numericLayers.length - 1])] ?? null;
}

/** 状态查询（pure=true；渐进域宽松、封闭域严格） ——————————————————— */

function flagFn(args: unknown[], ctx: EvalContext): unknown {
  return ctx.state.world.flags[requireString('flag', 1, args[0])]; // 未设置 → undefined
}

function favorFn(args: unknown[], ctx: EvalContext): unknown {
  const npc = ctx.state.npcs[requireString('favor', 1, args[0])];
  return npc !== undefined ? npc.favor : 0; // 未登场 NPC 好感视为 0
}

function repFn(args: unknown[], ctx: EvalContext): unknown {
  const factionId = requireString('rep', 1, args[0]);
  const value = ctx.state.factions[factionId];
  if (value === undefined) {
    throw builtinError(
      'rep',
      'error.eval.missingKey',
      `未知阵营 '${factionId}'（封闭域，缺失视为内容错误）`,
      { key: factionId },
    );
  }
  return value;
}

function metFn(args: unknown[], ctx: EvalContext): unknown {
  const npc = ctx.state.npcs[requireString('met', 1, args[0])];
  return npc !== undefined ? npc.met : false; // 未登场 → false
}

function bodyFn(args: unknown[], ctx: EvalContext): unknown {
  const part = requireString('body', 1, args[0]);
  const value = ctx.state.player.body[part];
  if (value === undefined) {
    throw builtinError(
      'body',
      'error.eval.missingKey',
      `未知身体部位 '${part}'（封闭域，缺失视为内容错误）`,
      { key: part },
    );
  }
  return value;
}

/** 进度查询（pure=true） ————————————————————————————————————————————— */

function questFn(args: unknown[], ctx: EvalContext): unknown {
  const quest = ctx.state.quests[requireString('quest', 1, args[0])];
  return quest !== undefined ? quest.state : undefined; // 未开始 → undefined
}

function loopFn(_args: unknown[], ctx: EvalContext): unknown {
  return ctx.state.loop;
}

function dayFn(_args: unknown[], ctx: EvalContext): unknown {
  return ctx.state.world.time.day;
}

function weekdayFn(_args: unknown[], ctx: EvalContext): unknown {
  return ctx.state.world.time.weekday;
}

function slotFn(_args: unknown[], ctx: EvalContext): unknown {
  return ctx.state.world.time.slot;
}

function pointsFn(_args: unknown[], ctx: EvalContext): unknown {
  return ctx.state.meta.points;
}

/** 数值函数（pure=true） ——————————————————————————————————————————————— */

function clampFn(args: unknown[]): unknown {
  const value = requireNumber('clamp', 1, args[0]);
  const min = requireNumber('clamp', 2, args[1]);
  const max = requireNumber('clamp', 3, args[2]);
  if (min > max) {
    throw builtinError(
      'clamp',
      'error.eval.invalidRange',
      `clamp 要求 min ≤ max，实际 ${min} > ${max}`,
    );
  }
  return Math.min(Math.max(value, min), max);
}

function minFn(args: unknown[]): unknown {
  return Math.min(requireNumber('min', 1, args[0]), requireNumber('min', 2, args[1]));
}

function maxFn(args: unknown[]): unknown {
  return Math.max(requireNumber('max', 1, args[0]), requireNumber('max', 2, args[1]));
}

/**
 * 内置 20 函数（§2.3 表格逐项；随机 3 + 物品/服装 3 + 状态查询 5 +
 * 进度查询 6 + 数值 3）。
 */
const BUILTIN_FUNCTIONS: readonly ExprFunctionDef[] = [
  // 随机（依赖 Rng，pure=false）
  { name: 'rand', arity: [2, 2], pure: false, fn: randFn },
  { name: 'randInt', arity: [2, 2], pure: false, fn: randIntFn },
  { name: 'chance', arity: [1, 1], pure: false, fn: chanceFn },
  // 物品/服装查询
  { name: 'has', arity: [1, 1], pure: true, fn: hasFn },
  { name: 'count', arity: [1, 1], pure: true, fn: countFn },
  { name: 'worn', arity: [1, 2], pure: true, fn: wornFn },
  // 状态查询
  { name: 'flag', arity: [1, 1], pure: true, fn: flagFn },
  { name: 'favor', arity: [1, 1], pure: true, fn: favorFn },
  { name: 'rep', arity: [1, 1], pure: true, fn: repFn },
  { name: 'met', arity: [1, 1], pure: true, fn: metFn },
  { name: 'body', arity: [1, 1], pure: true, fn: bodyFn },
  // 进度查询
  { name: 'quest', arity: [1, 1], pure: true, fn: questFn },
  { name: 'loop', arity: [0, 0], pure: true, fn: loopFn },
  { name: 'day', arity: [0, 0], pure: true, fn: dayFn },
  { name: 'weekday', arity: [0, 0], pure: true, fn: weekdayFn },
  { name: 'slot', arity: [0, 0], pure: true, fn: slotFn },
  { name: 'points', arity: [0, 0], pure: true, fn: pointsFn },
  // 数值
  { name: 'clamp', arity: [3, 3], pure: true, fn: clampFn },
  { name: 'min', arity: [2, 2], pure: true, fn: minFn },
  { name: 'max', arity: [2, 2], pure: true, fn: maxFn },
];

const BUILTIN_REGISTRY: ExprFunctionRegistry = new Map(
  BUILTIN_FUNCTIONS.map((def) => [def.name, def]),
);

/**
 * 内置函数注册表（不可变约定：ReadonlyMap 视图，调用方不得修改；
 * 脚本扩展 x.* 由 ScriptHost 在加载期另行合并冻结，设计 §3.2）。
 */
export function createBuiltinFunctionRegistry(): ExprFunctionRegistry {
  return BUILTIN_REGISTRY;
}
