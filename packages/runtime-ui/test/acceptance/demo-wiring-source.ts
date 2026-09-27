import { readFileSync } from 'node:fs';

/**
 * demo 宿主页源码的**接线形态**探针（供 `demo-*-wiring.test.ts` 复用）。
 *
 * ## 为什么需要这一层
 * `apps/player-demo` 无测试基建，其运行行为不被 `pnpm test` 覆盖；「组件能力已就绪、
 * demo 没接」这类缺陷（见 `docs/plans/open-items.md` 的 L-1 装配缺口谱系）只能在
 * **源码装配面**上防守（与 `choice-visibility-host.test.ts` 的 `#4 静态防线` 同型）。
 *
 * ## 口径：断言「接线形态」而非「字符串出现过」
 * 全文 grep 会误报：注释里提到 `resolveName` 并不等于真的传了 prop，`<ShopPanel`
 * 也可能出现在别处。故这里不暴露裸源码，而是提供**结构化探针**——先剥注释，
 * 再用括号配对切出真正的 JSX 开标签与属性值，让用例断言「某组件收到了某属性实参」。
 *
 * 本文件放在 `acceptance/` 下与 `route-driver.ts` 同规：它是测试支撑，不是用例
 * （无 `describe`/`it`，故不被 vitest 的 `*.test.*` 匹配为用例文件）。
 */

const DEMO_MAIN = 'apps/player-demo/src/main.tsx';

/**
 * 去掉注释后的 demo 源码：只断言**代码**里的接线，不误伤解释性注释。
 * 与 `choice-visibility-host.test.ts` 的 `codeOf` 同款（块注释 + 行注释）。
 */
export function demoSource(): string {
  return readFileSync(DEMO_MAIN, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * 取 `<Component ...>` 开标签的完整文本（含全部属性）。
 *
 * 用 `{}` 深度 + 引号状态扫描，正确处理 JSX 表达式属性（如
 * `onBuy={(itemId) => { ... }}`）中出现的 `>`：箭头函数的 `=>` 位于 `{}` 内、
 * 深度 ≥ 1，不会与标签结束的 `>` 混淆。
 *
 * 找不到标签、标签名不是独立边界（避免 `<ShopPanelX` 之类前缀巧合）、
 * 或标签未闭合时抛错——用例侧会因此变红，指向「demo 结构已变」。
 */
export function jsxTag(source: string, component: string): string {
  const marker = `<${component}`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`源码中未找到 <${component} 标签`);
  const after = source[start + marker.length];
  if (after === undefined || !/[\s/>]/.test(after)) {
    throw new Error(`<${component} 不是独立标签名（后随 ${String(after)}）`);
  }
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + marker.length; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`<${component} 标签未闭合（源码结构可能已变）`);
}

/**
 * 取 JSX **属性值**（属性后紧跟的 `{...}` 内容），找不到该属性返回 null。
 * 返回 `{...}` 内部文本；用例据此断言内容而非「属性名出现过」。
 */
export function jsxAttrValue(tagText: string, attr: string): string | null {
  const marker = `${attr}={`;
  const at = tagText.indexOf(marker);
  if (at === -1) return null;
  let depth = 0;
  const open = at + attr.length; // 指向 '{'
  for (let i = open; i < tagText.length; i += 1) {
    const ch = tagText[i] as string;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return tagText.slice(open + 1, i);
    }
  }
  throw new Error(`属性 ${attr} 的大括号未闭合`);
}

/**
 * 取名为 `name` 的**函数调用**实参文本（不含外括号），找不到返回 null。
 * 排除 `function name(` 定义：否则会截到 hook 的定义体而非调用点。
 */
export function callArgs(source: string, name: string): string | null {
  const match = new RegExp(`(?<!function\\s)${name}\\s*\\(`).exec(source);
  if (match === null) return null;
  const open = match.index + match[0].length - 1; // '('
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${name}( 调用未闭合`);
}

/** 调用点位置（同样排除 `function name(` 定义）；用于断言两个 hook 的相对次序 */
export function callAt(source: string, name: string): number {
  const match = new RegExp(`(?<!function\\s)${name}\\s*\\(`).exec(source);
  if (match === null) throw new Error(`源码中未找到 ${name} 的调用`);
  return match.index;
}

/**
 * 取名为 `name` 的**函数声明体**（`function name(...) { ... }` 的大括号内文本）。
 *
 * 为什么需要：`jsxTag` 只能取「某组件在某处的**使用**标签」，但组件内部的
 * 渲染逻辑（如 `ErrorCard` 的两个按钮与分支判断）位于其**定义体**里——全文
 * grep 无法区分「这个分支属于 ErrorCard」还是「属于恰好也叫按钮的别处」。
 * 本函数把断言范围收窄到该函数的定义体，与 `jsxTag` 同一口径。
 *
 * 括号配对：先跳过参数列表（可能含解构 `{ host }`），再跨过返回类型注解定位
 * 函数体 `{`，最后配对到对应的 `}`。找不到函数、参数列表或函数体未闭合时抛错。
 */
export function functionBody(source: string, name: string): string {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`源码中未找到 function ${name}(`);
  if (!/[\s({]/.test(source[start + marker.length] ?? '')) {
    throw new Error(`function ${name}( 不是独立函数名`);
  }
  const bodyStart = findBodyOpen(source, start + marker.length - 1);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart + 1, i);
    }
  }
  throw new Error(`function ${name} 的函数体未闭合`);
}

/** 从参数列表左括号起，跨过参数与返回类型注解，返回函数体 `{` 的下标 */
function findBodyOpen(source: string, paramsOpen: number): number {
  let depth = 0;
  for (let i = paramsOpen; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        // 参数列表结束 → 下一个 `{` 即函数体起点（跳过 `: ReactNode` 之类注解）
        const body = source.indexOf('{', i);
        if (body === -1) throw new Error('函数体未找到');
        return body;
      }
    }
  }
  throw new Error('参数列表未闭合');
}
