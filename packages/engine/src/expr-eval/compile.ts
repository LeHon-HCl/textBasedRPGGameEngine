import { EngineError } from '@game/shared';
import type { CompiledExpr, ExprNode, ExprSource, VarRef } from '@game/shared';
import { parseExpr } from './parse.js';

/**
 * 表达式编译（设计 §3.2，03 任务 A2/A3）：`compileExpr(source, registry)` =
 * AST 生成 + refs 抽取 + 静态校验。
 *
 * - refs（A2）：编译期抽取全部 `path` 节点为 {@link VarRef}（root = 首段，
 *   path = 完整点路径），路径嵌套在函数实参 / 一元 / 二元 / 三元分支内同样
 *   收集；按首次出现顺序去重（§4.4 事件池脏标记索引的依赖键，DD-06）；
 * - 静态校验（A3，DD-01 编译期四类）：未知 root、未知函数、参数个数不符、
 *   `pure=false` 出现在缓存敏感位置（`requirePure` 语境）→ `EXPR_COMPILE`
 *   阻断，where 携带表达式原文与定位细节。
 */

/** 编译期错误（EXPR_COMPILE）快捷构造：where 必携带表达式原文（DD-01） */
export function exprCompileError(
  source: ExprSource,
  detail: string,
  messageKey: string,
  extra?: Record<string, string>,
): EngineError {
  return new EngineError({
    code: 'EXPR_COMPILE',
    where: { expr: source, ...extra, detail },
    messageKey,
  });
}

/**
 * 编译表达式：解析为 §2.3 AST，抽取 refs（静态校验由 03 任务 A3 补齐，
 * 届时追加 registry 参数）。
 * 语法 / 校验错误一律抛 `EngineError`（EXPR_COMPILE），不产出部分结果。
 */
export function compileExpr(source: ExprSource): CompiledExpr {
  const ast = parseExpr(source);
  const refs: VarRef[] = [];
  const seen = new Set<string>();
  collectRefs(ast, refs, seen);
  return { source, ast, refs };
}

/** 先序遍历 AST 收集 VarRef：path 节点按完整点路径去重，其余节点递归实参/操作数/分支 */
function collectRefs(node: ExprNode, refs: VarRef[], seen: Set<string>): void {
  switch (node.kind) {
    case 'path': {
      const path = node.segments.join('.');
      if (!seen.has(path)) {
        seen.add(path);
        refs.push({ root: node.segments[0] as string, path });
      }
      return;
    }
    case 'call':
      for (const arg of node.args) {
        collectRefs(arg, refs, seen);
      }
      return;
    case 'unary':
      collectRefs(node.operand, refs, seen);
      return;
    case 'binary':
      collectRefs(node.left, refs, seen);
      collectRefs(node.right, refs, seen);
      return;
    case 'cond':
      collectRefs(node.test, refs, seen);
      collectRefs(node.then, refs, seen);
      collectRefs(node.else, refs, seen);
      return;
    default:
      return; // num / str / bool / null 字面量无引用
  }
}
