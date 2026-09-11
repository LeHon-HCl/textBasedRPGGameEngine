import jsep from 'jsep';
import { EngineError } from '@game/shared';
import type { ExprBinaryOp, ExprNode, ExprSource } from '@game/shared';

/**
 * 表达式解析（设计 §2.3 EBNF / §3.2，03 任务 A1）。
 *
 * jsep 定制（设计 §3.2「关闭裸标识符/成员表达式，自定义 call 与 path 插件」）：
 * - **关闭原生标识符/成员/调用解析**：注册自定义 `gobble-token` 钩子认领全部
 *   标识符起始字符，直接产出 §2.3 的 `path` / `call` / 布尔 / null 节点——jsep
 *   原生 Identifier / MemberExpression / CallExpression 分支因此不再可达，
 *   `a.b()`（对路径调用）、`a[0]`（计算成员）等超出 EBNF 的形态无处产生；
 * - **运算符表裁剪到 EBNF**：移除位运算 / 严格相等 / 指数 / 空值合并等 EBNF
 *   之外的二元运算符与按位非一元运算符，多余运算符在解析期即报语法错误；
 * - 三元 `?:` 保留 jsep 默认注册的 ternary 插件（EBNF `ternary` 产生式）。
 *
 * 钩子产出的 `path`/`call` 节点与 jsep 其余核心节点（Literal / Unary / Binary /
 * Conditional）在 {@link normalize} 中统一归一为 `ExprNode`；一切无法归一的
 * 产物（数组字面量、逗号序列、复合表达式、非标识符调用目标等）按语法错误
 * `EXPR_COMPILE` 抛出（DD-01：编译期阻断，where 携带表达式原文）。
 */

/** EBNF 允许的二元运算符（jsep 优先级数值与 EBNF 分层一致，见 §2.3 文法） */
const EBNF_BINARY_OPS: ReadonlySet<string> = new Set([
  '||',
  '&&',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '+',
  '-',
  '*',
  '/',
  '%',
]);

/** jsep 默认表内、EBNF 之外的二元运算符（模块加载期移除，重复执行幂等） */
const REMOVED_BINARY_OPS: readonly string[] = [
  '??',
  '|',
  '^',
  '&',
  '===',
  '!==',
  '<<',
  '>>',
  '>>>',
  '**',
];

/** jsep 默认表内、EBNF 之外的一元运算符 */
const REMOVED_UNARY_OPS: readonly string[] = ['~'];

/** 字符常量（jsep typings 未导出字符码，按 ASCII 码点定义） */
const PERIOD_CODE = 46; // '.'
const OPAREN_CODE = 40; // '('
const CPAREN_CODE = 41; // ')'
const OBRACK_CODE = 91; // '['

/** jsep 节点的最小结构（运行期仅按需取字段，其余一律 unknown） */
interface JsepNodeLike {
  readonly type?: unknown;
  readonly name?: unknown;
  readonly value?: unknown;
  readonly operator?: unknown;
  readonly argument?: unknown;
  readonly left?: unknown;
  readonly right?: unknown;
  readonly test?: unknown;
  readonly consequent?: unknown;
  readonly alternate?: unknown;
}

/**
 * 标识符起始字符判定（与 jsep 默认配置一致：ASCII 字母 / '$' / '_' / 非 ASCII）。
 * jsep typings 未导出 isIdentifierStart，这里按其默认规则本地实现（本模块
 * 不增删 jsep 的 additional_identifier_chars，故两侧规则保持一致）。
 */
function isIdentifierStartChar(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 36 || // '$'
    code === 95 || // '_'
    code >= 128 // 非 ASCII（EBNF 未定义，交由 root 校验拒绝）
  );
}

/** 判断 expr 中自 pos 起（跳过 jsep 认可的空白）是否为标识符起始字符 */
function isIdentifierAhead(expr: string, pos: number): boolean {
  let index = pos;
  while (index < expr.length) {
    const ch = expr[index];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') break;
    index += 1;
  }
  if (index >= expr.length) return false;
  return isIdentifierStartChar(expr.charCodeAt(index));
}

/**
 * 自定义 path/call 插件：认领全部标识符起始字符（关闭 jsep 原生
 * identifier/member/call 解析），直接产出 §2.3 的 `path`/`call`/字面量节点。
 */
const pathCallPlugin = {
  name: 'game-path-call',
  // 插件 init 由 jsep 以自身实体为 this 调用；此处零参闭包直接使用 import 的 jsep
  init(): void {
    // env 显式宽化为 { node?: unknown }：本插件写入的是 ExprNode 而非 jsep.Expression
    jsep.hooks.add('gobble-token', function gobblePathOrCall(env: { node?: unknown }) {
      if (!isIdentifierStartChar(this.code)) {
        return; // 数字 / 字符串 / 括号 / 一元运算符等交还 jsep 核心处理
      }
      const first = this.gobbleIdentifier();
      if (!first || typeof first.name !== 'string') {
        this.throwError('expected identifier');
      }
      const name = first.name as string;
      if (name === 'true' || name === 'false') {
        env.node = { kind: 'bool', value: name === 'true' } satisfies ExprNode;
        return;
      }
      if (name === 'null') {
        env.node = { kind: 'null' } satisfies ExprNode;
        return;
      }

      // path = IDENT { '.' IDENT }：'.' 两侧允许空白（与 jsep 原生成员访问一致）
      const segments = [name];
      for (;;) {
        this.gobbleSpaces();
        if (this.code !== PERIOD_CODE || !isIdentifierAhead(this.expr, this.index + 1)) {
          break;
        }
        this.index += 1;
        this.gobbleSpaces();
        const segment = this.gobbleIdentifier();
        if (!segment || typeof segment.name !== 'string') {
          this.throwError('expected identifier after "."');
        }
        segments.push(segment.name as string);
      }

      // call = IDENT '(' [expr {',' expr}] ')'：仅允许对裸标识符调用（EBNF）
      this.gobbleSpaces();
      if (this.code === OPAREN_CODE && segments.length === 1) {
        this.index += 1;
        const rawArgs = this.gobbleArguments(CPAREN_CODE);
        const args = Array.isArray(rawArgs) ? rawArgs.map((arg) => normalize(arg)) : [];
        env.node = { kind: 'call', name, args } satisfies ExprNode;
        return;
      }

      env.node = { kind: 'path', segments } satisfies ExprNode;
    });

    // 守卫：本插件认领的 token 跳过了 jsep 原生成员/调用解析（gobbleTokenProperty），
    // 尾随的 '(' / '[' 会被 jsep 解析为空分组并静默丢弃（如 `a.b()`、`f()()`），
    // 这里显式拒绝，保证 EBNF 之外形态一律报语法错误。
    jsep.hooks.add('after-token', function guardTrailingTokens(env: { node?: unknown }) {
      if (typeof env.node !== 'object' || env.node === null) {
        return; // 仅守卫本插件产出的 path/call/字面量节点
      }
      if (typeof (env.node as { kind?: unknown }).kind !== 'string') {
        return; // jsep 核心节点（数字/字符串等）仍由原生成员解析处理
      }
      this.gobbleSpaces();
      if (this.code === OPAREN_CODE) {
        this.throwError('unexpected "(" after path or call');
      }
      if (this.code === OBRACK_CODE) {
        this.throwError('unexpected "[" after path or call');
      }
    });
  },
};

// —— 模块加载期一次性定制（ESM 单例；移除/注册均为幂等操作） ——————————————
for (const op of REMOVED_BINARY_OPS) {
  jsep.removeBinaryOp(op);
}
for (const op of REMOVED_UNARY_OPS) {
  jsep.removeUnaryOp(op);
}
jsep.plugins.register(pathCallPlugin);

/** 归一失败的内部哨兵（parseExpr 边界处统一转为 EXPR_COMPILE） */
class SyntaxFailure extends Error {}

function fail(detail: string): never {
  throw new SyntaxFailure(detail);
}

/** 运行期判别：本插件产出的节点带 `kind` 字段（ExprNode 判别键） */
function isExprNode(value: unknown): value is ExprNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string'
  );
}

/**
 * 将 jsep 解析树（含本插件产出的 ExprNode）归一为 §2.3 的 `ExprNode`。
 * 一切 EBNF 之外的产物在此拒绝（数组 / 序列 / 复合 / 非标识符调用目标等）。
 */
function normalize(raw: unknown): ExprNode {
  if (isExprNode(raw)) {
    return raw; // 本插件已产出最终形态
  }
  const node = raw as JsepNodeLike;
  const type = typeof node?.type === 'string' ? node.type : '';
  switch (type) {
    case 'Literal': {
      const value = node.value;
      if (typeof value === 'number') return { kind: 'num', value };
      if (typeof value === 'string') return { kind: 'str', value };
      if (typeof value === 'boolean') return { kind: 'bool', value };
      if (value === null) return { kind: 'null' };
      return fail(`unsupported literal: ${String(value)}`);
    }
    case 'UnaryExpression': {
      const op = node.operator;
      if (op === '!' || op === '-' || op === '+') {
        return { kind: 'unary', op, operand: normalize(node.argument) };
      }
      return fail(`unsupported unary operator: ${String(op)}`);
    }
    case 'BinaryExpression': {
      const op = node.operator;
      if (typeof op === 'string' && EBNF_BINARY_OPS.has(op)) {
        return {
          kind: 'binary',
          op: op as ExprBinaryOp,
          left: normalize(node.left),
          right: normalize(node.right),
        };
      }
      return fail(`unsupported binary operator: ${String(op)}`);
    }
    case 'ConditionalExpression':
      return {
        kind: 'cond',
        test: normalize(node.test),
        then: normalize(node.consequent),
        else: normalize(node.alternate),
      };
    default:
      return fail(`unsupported syntax: ${type || 'unknown'}`);
  }
}

/** 编译期错误（EXPR_COMPILE）快捷构造：where 必携带表达式原文（DD-01） */
function compileError(source: string, detail: string, messageKey: string): EngineError {
  return new EngineError({
    code: 'EXPR_COMPILE',
    where: { expr: source, detail },
    messageKey,
  });
}

/**
 * 解析表达式原文为 §2.3 AST（不做 root / 函数静态校验，见 `compileExpr`）。
 * 语法错误（含 EBNF 之外的运算符与语法构造）抛 `EXPR_COMPILE`，
 * `where` 携带 `expr`（原文）与 `detail`（含出错位置）。
 */
export function parseExpr(source: ExprSource): ExprNode {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw compileError(String(source), 'expression is empty', 'error.expr.empty');
  }
  let raw: unknown;
  try {
    raw = jsep(source);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new EngineError({
      code: 'EXPR_COMPILE',
      where: { expr: source, detail },
      messageKey: 'error.expr.syntax',
      cause: err,
    });
  }
  try {
    return normalize(raw);
  } catch (err) {
    const detail = err instanceof SyntaxFailure ? err.message : String(err);
    throw compileError(source, detail, 'error.expr.unsupportedSyntax');
  }
}
