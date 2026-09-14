import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { RichText } from './RichText.js';
import { sanitizeRichText } from './sanitize.js';
import type { RichTextNode } from './sanitize.js';

/**
 * 打字机效果（设计 §6.1 / FR-READ-05 / NFR-26）。
 *
 * 三条约束的落地方式：
 * 1. **不重排渲染结果**：{@link sliceRichTextNodes} 只按字符预算取节点树的
 *    **前缀**（节点顺序与层级逐字保留），展示层不重新分段、不重排；
 * 2. **reduced-motion 自动关闭**（NFR-26）：{@link usePrefersReducedMotion}
 *    命中时直接全显；
 * 3. **可关闭**：`settings.textSpeed <= 0`（{@link typewriterIntervalMs} 返回 0）
 *    或 `enabled=false` 时立即全显，不挂定时器。
 */

/** 打字机缺省间隔（ms/字符；速度 1 的基准，FR-READ-05 速度分级的中档） */
export const TYPEWRITER_BASE_INTERVAL_MS = 40;

/**
 * 字符预算裁剪（展示层唯一允许的「截断」操作）。
 *
 * 语义：按先序遍历累计字符数，取不超过 `budget` 的**前缀树**。
 * - 预算覆盖全部字符 / 超过总长 → 返回原数组（引用不变，避免无效重渲染）；
 * - 元素节点只有其可见文本进入预算（标签本身不占字符）；
 * - 不产生空元素节点（预算恰好落在边界时该节点整棵省略）。
 *
 * @param nodes 完整节点树（sanitize 产物）
 * @param budget 已揭示字符数（≥0；0 表示尚未揭示任何字符）
 */
export function sliceRichTextNodes(
  nodes: readonly RichTextNode[],
  budget: number,
): readonly RichTextNode[] {
  if (budget >= countRichTextChars(nodes)) return nodes;
  if (budget <= 0) return [];
  const out: RichTextNode[] = [];
  let remaining = budget;
  for (const node of nodes) {
    if (remaining <= 0) break;
    if (node.kind === 'text') {
      out.push(
        remaining >= node.text.length
          ? node
          : { kind: 'text', text: node.text.slice(0, remaining) },
      );
      remaining -= node.text.length;
      continue;
    }
    const inner = sliceRichTextNodes(node.children, remaining);
    if (inner.length > 0) {
      out.push({ ...node, children: inner });
      remaining -= countRichTextChars(inner);
    }
  }
  return out;
}

/** 节点树的可见字符总数（打字机的总长基准；标签不算字符） */
export function countRichTextChars(nodes: readonly RichTextNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += node.kind === 'text' ? node.text.length : countRichTextChars(node.children);
  }
  return total;
}

/**
 * 速度 → 定时器间隔（ms/字符）。速度 ≤0 返回 0，表示「关闭打字机」
 * （调用方据此跳过定时器，一次性全显）。
 *
 * @param speed 文本速度（`settings.textSpeed`；1 = 基准速度）
 */
export function typewriterIntervalMs(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 0;
  return Math.round(TYPEWRITER_BASE_INTERVAL_MS / speed);
}

/**
 * prefers-reduced-motion 探测（NFR-26）。
 *
 * 环境不支持 matchMedia（Node / 老宿主）时返回 false——「未减弱」是缺省口径，
 * 不因探测能力缺失而改变既有行为。
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => undefined;
      }
      const list = window.matchMedia('(prefers-reduced-motion: reduce)');
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },
    () => false,
  );
}

/**
 * 打字机推进钩子（纯逻辑，可在任意组件复用）。
 *
 * @param text 完整文本（变更时重置揭示进度——段落推进的语义）
 * @param options.speed 文本速度（`settings.textSpeed`）
 * @param options.enabled 是否启用（`false` = 立即全显，如 reduced-motion / 已读跳过）
 * @returns 已揭示的字符数（0..text.length）
 */
export function useTypewriter(
  text: string,
  options: { readonly speed: number; readonly enabled: boolean },
): number {
  const interval = typewriterIntervalMs(options.speed);
  const active = options.enabled && interval > 0 && text.length > 0;
  const [revealed, setRevealed] = useState(active ? 0 : text.length);
  /** 当前推进对应的文本：与 revealed 一同重置，避免旧定时器写新文本进度 */
  const activeTextRef = useRef(text);

  useEffect(() => {
    activeTextRef.current = text;
    if (!active) {
      setRevealed(text.length);
      return undefined;
    }
    setRevealed(0);
    const timer = setInterval(() => {
      setRevealed((current) => {
        const next = current + 1;
        if (next >= activeTextRef.current.length) {
          clearInterval(timer);
          return activeTextRef.current.length;
        }
        return next;
      });
    }, interval);
    return () => {
      clearInterval(timer);
    };
  }, [text, active, interval]);

  return active ? revealed : text.length;
}

/** TypewriterText 属性（受控：文本与展示参数由调用方给出） */
export interface TypewriterTextProps {
  /** 已插值的富文本（可含白名单标记） */
  readonly text: string;
  /** 文本速度（`settings.textSpeed`；≤0 = 关闭打字机直接全显） */
  readonly speed: number;
  /** 是否启用（缺省 true；reduced-motion 时由调用方传 false） */
  readonly enabled?: boolean;
  /** 是否自动探测 reduced-motion（缺省 true，NFR-26 自动关） */
  readonly respectReducedMotion?: boolean;
  /** 容器标签（缺省 'p'——叙事段落用段落语义） */
  readonly as?: keyof JSX.IntrinsicElements;
  /** 容器类名（排版设置挂载点） */
  readonly className?: string;
}

/**
 * 打字机文本组件（见模块 TSDoc）。
 *
 * 渲染路径与 {@link RichText} 完全一致（同一 sanitizer、同一节点映射），
 * 只在节点树上做前缀裁剪——因此「打字机不重排渲染结果」是本实现的结构性质，
 * 而非调用约定。
 */
export function TypewriterText({
  text,
  speed,
  enabled = true,
  respectReducedMotion = true,
  as = 'p',
  className,
}: TypewriterTextProps): ReactNode {
  const reducedMotion = usePrefersReducedMotion();
  const active = enabled && !(respectReducedMotion && reducedMotion);
  const revealed = useTypewriter(text, { speed, enabled: active });
  // 完整节点树按 text 记忆：预算变化只做前缀裁剪，不重新 sanitize
  const fullNodes = useMemo(() => sanitizeRichText(text), [text]);
  const nodes = sliceRichTextNodes(fullNodes, revealed);
  return <RichText nodes={nodes} as={as} className={className} />;
}
