import { createElement, Fragment } from 'react';
import type { ReactNode } from 'react';
import { sanitizeRichText } from './sanitize.js';
import type { RichTextNode } from './sanitize.js';

/**
 * RichText —— 富文本 → ReactNode 渲染器（设计 §6.1 管线末段；NFR-18）。
 *
 * - 输入为**已插值的最终文本**（`text`）或已清洗的节点树（`nodes`）：
 *   前者内部经 {@link sanitizeRichText} 得到白名单节点树，后者供打字机等
 *   需要预先裁剪的场景复用（避免重复清洗）；
 * - 不使用 `dangerouslySetInnerHTML`（全流程无 HTML 解析路径）：非白名单标记
 *   以 React 文本子节点渲染，浏览器不会把它当标签——注入面在此彻底关闭；
 * - 容器标签可配（`as`，缺省 `span`——内联语义，不打断叙事段落流）；
 *   排版（字号/行距）由上层经 className / CSS 变量施加（FR-READ-05）。
 *
 * 不变式：`nodes` 与 `text` 必须恰好给出一个（两者都给时以 `nodes` 为准；
 * 都不给视为空文本）——渲染层不对已清洗节点做二次校验（白名单出口只有一处）。
 */

/** RichText 属性（受控：内容与容器皆由调用方给出） */
export interface RichTextProps {
  /** 已插值的富文本（可含白名单标记）；与 `nodes` 二选一 */
  readonly text?: string;
  /** 已清洗的节点树（打字机裁剪后的前缀树）；给出时优先于 `text` */
  readonly nodes?: readonly RichTextNode[];
  /** 容器标签（缺省 'span'；叙事段落用 'p'） */
  readonly as?: keyof JSX.IntrinsicElements;
  /** 容器类名（排版与主题挂载点） */
  readonly className?: string;
}

/**
 * 白名单标签 → React 元素（`br` / `hr` 为 void；其余带子节点）。
 * 元素类型表是「标签白名单」在渲染层的唯一出口：sanitize 已保证节点树中
 * 只可能出现这些 tag（防御性兜底把未知 tag 降级为文本容器）。
 */
function renderNode(node: RichTextNode, key: string | number): ReactNode {
  if (node.kind === 'text') return node.text;
  const children = node.children.map((child, index) => renderNode(child, index));
  switch (node.tag) {
    case 'br':
      return createElement('br', { key });
    case 'hr':
      return createElement('hr', { key });
    case 'span':
      return createElement(
        'span',
        node.className !== undefined ? { key, className: node.className } : { key },
        ...children,
      );
    case 'b':
    case 'i':
    case 'em':
    case 'mark':
    case 'ruby':
      return createElement(node.tag, { key }, ...children);
    default:
      return createElement(Fragment, { key }, ...children);
  }
}

/**
 * 渲染富文本（见模块 TSDoc）。
 *
 * @param props 受控属性（text 或 nodes + as / className）
 */
export function RichText({ text, nodes, as = 'span', className }: RichTextProps): ReactNode {
  const tree = nodes ?? sanitizeRichText(text ?? '');
  const children = tree.map((node, index) => renderNode(node, index));
  return createElement(as, className !== undefined ? { className } : null, ...children);
}
