import { EngineError } from '@game/shared';
import type {
  CompiledExpr,
  ExprFunctionRegistry,
  ExprNode,
  ExprSource,
  VarRef,
} from '@game/shared';
import { parseExpr } from './parse.js';
import { EXPR_ROOTS, joinPath, pathShapeError, splitRoot, unknownRootDetail } from './paths.js';

/**
 * 表达式编译（设计 §3.2，03 任务 A2/A3）：`compileExpr(source, registry)` =
 * AST 生成 + refs 抽取 + 静态校验。
 *
 * - refs（A2）：编译期抽取全部 `path` 节点为 {@link VarRef}（root = 首段，
 *   path = 完整点路径），路径嵌套在函数实参 / 一元 / 二元 / 三元分支内同样
 *   收集；按首次出现顺序去重（§4.4 事件池脏标记索引的依赖键，DD-06）；
 * - 静态校验（A3，DD-01 编译期四类）：未知 root（含路径形态不符）、未知函数、
 *   参数个数不符、`pure=false` 出现在缓存敏感位置（`requirePure` 语境）→
 *   `EXPR_COMPILE` 阻断，where 携带表达式原文与定位细节。
 */

/** 编译选项：`requirePure` = 当前编译位置是否缓存敏感（事件 require 等） */
export interface CompileOptions {
  readonly requirePure?: boolean;
}

/** 编译期错误（EXPR_COMPILE）快捷构造：where 必携带表达式原文（DD-01） */
export function exprCompileError(
  source: ExprSource,
  messageKey: string,
  detail: string,
  extra?: Record<string, string>,
): EngineError {
  return new EngineError({
    code: 'EXPR_COMPILE',
    where: { expr: source, ...extra, detail },
    messageKey,
  });
}

/**
 * 编译表达式：解析为 §2.3 AST，抽取 refs 并做静态校验（见模块 TSDoc）。
 * 语法 / 校验错误一律抛 `EngineError`（EXPR_COMPILE），不产出部分结果。
 */
export function compileExpr(
  source: ExprSource,
  registry: ExprFunctionRegistry,
  options: CompileOptions = {},
): CompiledExpr {
  const ast = parseExpr(source);
  const refs: VarRef[] = [];
  const seen = new Set<string>();
  visit(ast, source, registry, options.requirePure === true, refs, seen);
  return { source, ast, refs };
}

/**
 * 单遍遍历：静态校验（路径 / 函数）与 refs 抽取同趟完成。
 * 校验失败即抛 EXPR_COMPILE（首次命中即阻断，DD-01 编译期不产出部分结果）。
 */
function visit(
  node: ExprNode,
  source: ExprSource,
  registry: ExprFunctionRegistry,
  requirePure: boolean,
  refs: VarRef[],
  seen: Set<string>,
): void {
  switch (node.kind) {
    case 'path': {
      const { root, rest } = splitRoot(node.segments);
      const path = joinPath(node.segments);
      const detail = unknownRootDetailOrShape(root, rest);
      if (detail !== null) {
        throw exprCompileError(source, messageKeyForPath(detail), detail, {
          root,
          path,
        });
      }
      if (!seen.has(path)) {
        seen.add(path);
        refs.push({ root, path });
      }
      return;
    }
    case 'call': {
      const def = registry.get(node.name);
      if (!def) {
        throw exprCompileError(
          source,
          'error.expr.unknownFunction',
          `未知函数 '${node.name}'（内置函数清单冻结于设计 §2.3，共 20 个）`,
          { fn: node.name },
        );
      }
      const actual = node.args.length;
      const [min, max] = def.arity;
      if (actual < min || actual > max) {
        throw exprCompileError(
          source,
          'error.expr.arityMismatch',
          `函数 '${node.name}' 参数个数不符`,
          {
            fn: node.name,
            expected: min === max ? String(min) : `${min}..${max}`,
            actual: String(actual),
          },
        );
      }
      if (requirePure && !def.pure) {
        throw exprCompileError(
          source,
          'error.expr.impureFunction',
          `函数 '${node.name}' 为非纯函数（pure=false，如随机类），不可出现在缓存敏感位置`,
          { fn: node.name },
        );
      }
      for (const arg of node.args) {
        visit(arg, source, registry, requirePure, refs, seen);
      }
      return;
    }
    case 'unary':
      visit(node.operand, source, registry, requirePure, refs, seen);
      return;
    case 'binary':
      visit(node.left, source, registry, requirePure, refs, seen);
      visit(node.right, source, registry, requirePure, refs, seen);
      return;
    case 'cond':
      visit(node.test, source, registry, requirePure, refs, seen);
      visit(node.then, source, registry, requirePure, refs, seen);
      visit(node.else, source, registry, requirePure, refs, seen);
      return;
    default:
      return; // num / str / bool / null 字面量无引用、无校验点
  }
}

/** 路径校验：白名单外 root 与形态不符分别给文案；合法返回 null */
function unknownRootDetailOrShape(root: string, rest: readonly string[]): string | null {
  if (!EXPR_ROOTS.includes(root)) {
    return unknownRootDetail(root);
  }
  return pathShapeError(root, rest);
}

/** 路径错误的 messageKey：未知 root 与形态不符分列（同为 EXPR_COMPILE） */
function messageKeyForPath(detail: string): string {
  return detail.startsWith('未知变量域') ? 'error.expr.unknownRoot' : 'error.expr.badPath';
}
