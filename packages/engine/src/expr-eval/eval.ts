import { EngineError } from '@game/shared';
import type { CompiledExpr, EvalContext, ExprNode } from '@game/shared';
import { splitRoot, unknownRootDetail } from './paths.js';

/**
 * 表达式求值器（设计 §3.2，03 任务 B1）：AST walk 解释执行（NFR-19，
 * 禁 eval / new Function），AST 不可变、求值器无缓存职责。
 *
 * 严格错误语义（DD-01，详见各运算分支）：
 * - 算术 / 比较运算严格类型化：操作数类型不符 → `EVAL_ERROR`（无隐式转换，
 *   `+` 仅在「数+数」或「串+串」时有定义）；
 * - 除零 / 模零 → `EVAL_ERROR`，无静默默认值；
 * - 逻辑运算符（`!` `&&` `||`）与三元条件位是**布尔语境**：按真值化
 *   （undefined/null/0/''/false/NaN 为假）解释操作数；`&&`/`||` 返回操作数
 *   原值（短路侧不求值——随机序列不被消耗，可回放性由 DD-09 保证）；
 * - 顶层条件（if/show_if/require）的真值化入口 `evalCondition` 见 B5。
 *
 * 路径解析按 §2.3 白名单（编译期已校验 root 与形态）：缺席语义遵循
 * 「封闭域严格、渐进域宽松」——封闭域（attr/skill/body/faction/wallet/
 * npc 实体/quest 实体/meta.points/time/loop）缺 key 即 `EVAL_ERROR`；
 * 渐进域（flag/item 计数/npc 自定义 flag/outfit 穿戴位/meta.perk）缺席
 * 返回定义的缺席值（undefined / 0 / null / false）。
 */

/** 求值错误（EVAL_ERROR）快捷构造：where 必携带表达式原文（DD-01） */
function evalError(
  source: string,
  messageKey: string,
  detail: string,
  extra?: Record<string, string>,
): EngineError {
  return new EngineError({
    code: 'EVAL_ERROR',
    where: { expr: source, ...extra, detail },
    messageKey,
  });
}

/**
 * 布尔语境真值化（DD-01）：undefined / null / false / 0 / '' / NaN 为假，
 * 其余为真。仅用于逻辑运算符、三元条件位与 `evalCondition` 入口；
 * 算术与比较语境不做任何真值化（嵌套隐式转换禁止）。
 */
export function truthy(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (value === 0 || value === '') return false;
  if (typeof value === 'number' && Number.isNaN(value)) return false;
  return true;
}

/**
 * 严格求值入口：返回表达式原值（不做结果真值化）。
 * 与 `evalCondition`（真值化入口，B5）成对，防止真值化被滥用到算术语境。
 */
export function evalExpr(expr: CompiledExpr, ctx: EvalContext): unknown {
  return evaluate(expr.ast, ctx, expr.source);
}

function evaluate(node: ExprNode, ctx: EvalContext, source: string): unknown {
  switch (node.kind) {
    case 'num':
    case 'str':
    case 'bool':
      return node.value;
    case 'null':
      return null;
    case 'path':
      return resolvePath(node.segments, ctx, source);
    case 'call':
      return callFunction(node, ctx, source);
    case 'unary': {
      if (node.op === '!') {
        return !truthy(evaluate(node.operand, ctx, source));
      }
      const value = evaluate(node.operand, ctx, source);
      if (typeof value !== 'number') {
        throw evalError(
          source,
          'error.eval.typeMismatch',
          `一元运算符 '${node.op}' 要求 number 操作数，实际为 ${describeType(value)}`,
          { op: node.op },
        );
      }
      return node.op === '-' ? -value : value;
    }
    case 'binary': {
      const op = node.op;
      if (op === '&&') {
        const left = evaluate(node.left, ctx, source);
        return truthy(left) ? evaluate(node.right, ctx, source) : left;
      }
      if (op === '||') {
        const left = evaluate(node.left, ctx, source);
        return truthy(left) ? left : evaluate(node.right, ctx, source);
      }
      const left = evaluate(node.left, ctx, source);
      const right = evaluate(node.right, ctx, source);
      return applyBinary(op, left, right, source);
    }
    case 'cond':
      return truthy(evaluate(node.test, ctx, source))
        ? evaluate(node.then, ctx, source)
        : evaluate(node.else, ctx, source);
  }
}

/** 算术 / 比较 / 相等运算的严格类型化执行（逻辑运算符已在 walk 中短路处理） */
function applyBinary(op: string, left: unknown, right: unknown, source: string): unknown {
  switch (op) {
    case '+':
      if (typeof left === 'number' && typeof right === 'number') return left + right;
      if (typeof left === 'string' && typeof right === 'string') return left + right;
      throw typeMismatch(op, left, right, source);
    case '-':
    case '*':
      if (typeof left === 'number' && typeof right === 'number') {
        return op === '-' ? left - right : left * right;
      }
      throw typeMismatch(op, left, right, source);
    case '/':
    case '%':
      if (typeof left === 'number' && typeof right === 'number') {
        if (right === 0) {
          throw evalError(
            source,
            'error.eval.divisionByZero',
            op === '/' ? '除数为 0' : '取模数为 0',
            { op },
          );
        }
        return op === '/' ? left / right : left % right;
      }
      throw typeMismatch(op, left, right, source);
    case '<':
    case '<=':
    case '>':
    case '>=':
      if (typeof left === 'number' && typeof right === 'number') {
        return compare(op, left, right);
      }
      if (typeof left === 'string' && typeof right === 'string') {
        return compare(op, left, right);
      }
      throw typeMismatch(op, left, right, source);
    case '==':
      return looseEquals(left, right);
    case '!=':
      return !looseEquals(left, right);
    default:
      throw evalError(source, 'error.eval.typeMismatch', `未知二元运算符 '${op}'`, { op });
  }
}

function compare(op: string, left: number | string, right: number | string): boolean {
  switch (op) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    default:
      return left >= right;
  }
}

/**
 * 相等语义（`==`/`!=`）：同为 number/string/boolean 时按值比较；
 * null 与 undefined 互相相等（顶层条件判「未设置」的惯用形式）；
 * 其余跨类型一律不等（不做隐式转换，DD-01）。
 */
function looseEquals(left: unknown, right: unknown): boolean {
  const lNullish = left === null || left === undefined;
  const rNullish = right === null || right === undefined;
  if (lNullish || rNullish) return lNullish && rNullish;
  if (typeof left !== typeof right) return false;
  return left === right;
}

function typeMismatch(op: string, left: unknown, right: unknown, source: string): EngineError {
  return evalError(
    source,
    'error.eval.typeMismatch',
    `运算符 '${op}' 不接受操作数类型 ${describeType(left)} 与 ${describeType(right)}`,
    { op },
  );
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// —— 路径解析（§2.3 白名单映射，03 任务 B2 逐域用例钉死） ——————————————————

function resolvePath(segments: string[], ctx: EvalContext, source: string): unknown {
  const { root, rest } = splitRoot(segments);
  const state = ctx.state;
  const path = segments.join('.');
  const first = rest[0] as string | undefined;
  const second = rest[1] as string | undefined;
  // 编译期已保证 root 合法、形态正确；运行期对数据完整性再做严格兜底
  switch (root) {
    case 'attr': {
      const value = state.player.attrs[first as string];
      return strictValue(value, path, first as string, source);
    }
    case 'skill': {
      const record = state.player.skills[first as string];
      if (record === undefined) throw missingKey(path, first as string, source);
      if (second === undefined) return record;
      return strictValue(record[second as 'value' | 'exp'], path, second as string, source);
    }
    case 'flag':
      return state.world.flags[first as string]; // 渐进域：未设置 → undefined
    case 'item':
      return state.bagCounts[first as string] ?? 0; // 渐进域：未持有 → 0
    case 'outfit': {
      const part = state.player.outfit[first as string];
      return part?.[second as string] ?? null; // 渐进域：该层未穿戴 → null
    }
    case 'body': {
      const value = state.player.body[first as string];
      return strictValue(value, path, first as string, source);
    }
    case 'npc': {
      const npc = state.npcs[first as string];
      if (npc === undefined) throw missingKey(path, first as string, source);
      if (second === 'favor') return npc.favor;
      if (second === 'met') return npc.met;
      if (second === 'stage') return npc.stage; // schema 可选：未达阶段 → undefined
      if (second === 'flags') {
        const name = segments[3] as string; // segments = [npc, id, 'flags', name]
        return npc.flags[name]; // 渐进域：自定义 flag 未设置 → undefined
      }
      return npc.flags[second as string]; // 自定义 flag 简写（favor/stage/met 优先）
    }
    case 'faction': {
      const value = state.factions[first as string];
      return strictValue(value, path, first as string, source);
    }
    case 'time': {
      const value = state.world.time[first as 'day' | 'weekday' | 'slot'];
      return strictValue(value, path, first as string, source);
    }
    case 'loop': {
      return strictValue(state.loop, path, 'loop', source);
    }
    case 'meta': {
      if (first === 'perk') {
        // 渐进域：未购买 → false
        return state.meta.purchasedPerks.some((perk) => perk.id === second);
      }
      const value = state.meta.points;
      return strictValue(value, path, 'points', source);
    }
    case 'quest': {
      const quest = state.quests[first as string];
      if (quest === undefined) throw missingKey(path, first as string, source);
      if (second === undefined) return quest;
      if (second === 'state') return quest.state;
      return quest.stage; // schema 可选：未进入阶段 → undefined
    }
    case 'wallet': {
      const value = state.player.wallet[first as string];
      return strictValue(value, path, first as string, source);
    }
    default:
      // 编译期已拦截；防御性兜底保持同一错误面
      throw evalError(source, 'error.expr.unknownRoot', unknownRootDetail(root), { root, path });
  }
}

/** 封闭域取值：缺 key 即严格报错（DD-01：无静默默认值） */
function strictValue(value: unknown, path: string, key: string, source: string): unknown {
  if (value === undefined) throw missingKey(path, key, source);
  return value;
}

function missingKey(path: string, key: string, source: string): EngineError {
  return evalError(
    source,
    'error.eval.missingKey',
    `已知变量域路径 '${path}' 缺少键 '${key}'（封闭域缺 key 视为状态完整性问题）`,
    { path, key },
  );
}

// —— 函数调用（内置 20 函数见 builtins.ts，03 任务 B3） ——————————————————

/** 调用节点形状（ExprNode 判别后的 call 分支） */
interface CallNode {
  readonly name: string;
  readonly args: readonly ExprNode[];
}

function callFunction(node: CallNode, ctx: EvalContext, source: string): unknown {
  const def = ctx.registry.get(node.name);
  if (!def) {
    // 编译期已按注册表校验；求值期缺失说明调用方更换了注册表（契约违规）
    throw new EngineError({
      code: 'INTERNAL',
      where: { expr: source, fn: node.name },
      messageKey: 'error.eval.functionMissing',
    });
  }
  const args = node.args.map((arg) => evaluate(arg, ctx, source));
  try {
    return def.fn(args, ctx);
  } catch (err) {
    throw wrapFunctionError(err, node.name, source);
  }
}

/**
 * 函数层错误包装（DD-01：EVAL_ERROR + 表达式原文定位）：
 * - 函数抛出的 EngineError 保留原 code/messageKey，并在 where 补注
 *   `expr`（表达式原文）与 `fn`（调用点函数名）；
 * - 非 EngineError（函数实现缺陷）防御性收敛为 EVAL_ERROR，
 *   原始抛出值挂 cause 供诊断导出（设计 §10.2）。
 */
function wrapFunctionError(err: unknown, fn: string, source: string): EngineError {
  if (err instanceof EngineError) {
    return new EngineError({
      code: err.code,
      where: { ...err.where, expr: source, fn },
      messageKey: err.messageKey,
      cause: err,
    });
  }
  return new EngineError({
    code: 'EVAL_ERROR',
    where: { expr: source, fn },
    messageKey: 'error.eval.functionFailed',
    cause: err,
  });
}
