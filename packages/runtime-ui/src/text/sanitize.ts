import { parseFragment } from 'parse5';

/**
 * 富文本 sanitizer（设计 §6.1；NFR-18 安全红线）。
 *
 * 管线位置：`TextResolver.resolve → 插值文本 → sanitize → ReactNode`
 * （先插值后 sanitize——插值值来源是状态数据，含尖括号也会被本模块转义）。
 *
 * 实现路径：`parse5.parseFragment` 解析为 AST → 白名单筛选 → 产出**纯数据节点
 * 树**（本模块的 {@link RichTextNode}）。渲染器（react.tsx）再把节点树映射为
 * React 元素——**全流程没有 `innerHTML` 注入路径**，因此不存在
 * 「sanitize 后被浏览器二次解析」的绕过面（NFR-18 的实现要点）。
 *
 * 白名单（§6.1）：
 * - 标签：`b / i / em / mark / ruby / span / br / hr`；
 * - 属性：仅 `span` 的 `class`，且只放行 `tone-` 前缀的类名（其余丢弃）；
 * - **非白名单标签转义显示**（不丢弃内容，也不静默吞掉）——其标记文本原样
 *   成为输出中的文本节点，渲染后玩家看到 `<script>` 字样但不可执行；
 *   译文与 Mod 走同一路径。注释节点直接丢弃。
 *
 * 不变式：本模块为纯函数，无副作用、不读写全局；同一输入恒等输出。
 */

/** 白名单标签（小写；§6.1 的固定清单） */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'b',
  'i',
  'em',
  'mark',
  'ruby',
  'span',
  'br',
  'hr',
]);

/** 自闭合（void）白名单标签：解析结果恒无子节点 */
const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'hr']);

/** `span` 的类名白名单前缀（§6.1「class 限 tone- 前缀」） */
const CLASS_PREFIX = 'tone-';

/** 清洗后的富文本节点：元素 / 文本两类（渲染器的输入面） */
export type RichTextNode =
  | {
      readonly kind: 'element';
      /** 小写标签名（白名单内） */
      readonly tag: string;
      /** 仅 span 可能的类名（`tone-*`；其余标签无属性） */
      readonly className?: string;
      readonly children: readonly RichTextNode[];
    }
  | { readonly kind: 'text'; readonly text: string };

/** parse5 节点结构的最小视图（只声明本模块消费的字段，避免深绑其类型） */
interface P5Node {
  readonly nodeName: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly attrs?: readonly { readonly name: string; readonly value: string }[];
  readonly childNodes?: readonly P5Node[];
}

/** 从 attrs 中取 span 的合法类名（只保留 `tone-` 前缀项，保持原声明序） */
function toneClassOf(
  attrs: readonly { name: string; value: string }[] | undefined,
): string | undefined {
  if (attrs === undefined) return undefined;
  const classAttr = attrs.find((attr) => attr.name === 'class');
  if (classAttr === undefined) return undefined;
  const tones = classAttr.value.split(/\s+/).filter((name) => name.startsWith(CLASS_PREFIX));
  return tones.length > 0 ? tones.join(' ') : undefined;
}

/**
 * 清洗一段富文本（见模块 TSDoc）。
 *
 * @param source 待清洗文本（已插值的最终文本；可含白名单标记）
 * @returns 节点树；非白名单标记以**文本节点**形式保留（渲染为可见字面量）
 */
export function sanitizeRichText(source: string): RichTextNode[] {
  const fragment = parseFragment(source) as unknown as P5Node;
  return convertChildren(fragment.childNodes ?? []);
}

/** {@link sanitizeRichText} 的同义入口名（管线文档用的「解析」口径） */
export function parseRichText(source: string): RichTextNode[] {
  return sanitizeRichText(source);
}

/** 递归转换子节点（注释 / 文档类型节点直接丢弃——条件注释类注入面） */
function convertChildren(nodes: readonly P5Node[]): RichTextNode[] {
  const out: RichTextNode[] = [];
  for (const node of nodes) {
    if (node.nodeName === '#text') {
      // parse5 已按 HTML 规则解码实体（&lt; → '<'）；此处不再加工，
      // 渲染层以 React 文本子节点挂载，不存在 HTML 解析，天然安全
      out.push({ kind: 'text', text: node.value ?? '' });
      continue;
    }
    if (node.nodeName === '#comment' || node.nodeName === '#documentType') continue;
    const tag = (node.tagName ?? node.nodeName).toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      // 非白名单标签：标记原文成为可见文本（「转义显示」，NFR-18）
      const raw = rawOuterText(node);
      if (raw !== '') out.push({ kind: 'text', text: raw });
      continue;
    }
    const children = VOID_TAGS.has(tag) ? [] : convertChildren(node.childNodes ?? []);
    const className = tag === 'span' ? toneClassOf(node.attrs) : undefined;
    out.push({
      kind: 'element',
      tag,
      ...(className !== undefined ? { className } : {}),
      children,
    });
  }
  return out;
}

/** 非白名单节点的标记原文重装（用于「转义显示」的可见文本） */
function rawOuterText(node: P5Node): string {
  if (node.nodeName === '#text') return node.value ?? '';
  const tag = (node.tagName ?? node.nodeName).toLowerCase();
  const childrenText = (node.childNodes ?? []).map(rawOuterText).join('');
  const attrs = (node.attrs ?? [])
    .map((attr) => (attr.value === '' ? attr.name : `${attr.name}="${attr.value}"`))
    .join(' ');
  const open = attrs === '' ? `<${tag}>` : `<${tag} ${attrs}>`;
  if (VOID_TAGS.has(tag)) return open;
  return `${open}${childrenText}</${tag}>`;
}

/** 节点树 → 纯文本（调试面板/测试断言/无障碍备选文本的共用投影） */
export function richTextToPlainText(nodes: readonly RichTextNode[]): string {
  return nodes
    .map((node) => (node.kind === 'text' ? node.text : richTextToPlainText(node.children)))
    .join('');
}
