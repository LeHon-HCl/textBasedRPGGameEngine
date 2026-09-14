import type { CSSProperties, ReactNode } from 'react';
import type { ToastItem } from '../app/types.js';

/**
 * Toast 浮层（设计 §6.4 末段 / FR-UI-07）。
 *
 * 契约：
 * - **受控**：队列由 store/宿主提供（`items`），组件不持定时器——自动消失
 *   由宿主的过期清理驱动（`expireToasts` + TTL），组件只暴露 `onDismiss`；
 * - `count > 1` 呈现「×N」（合并策略的可视化，§6.4「防刷屏」）；
 * - `kind` 落到 `data-kind`（样式分支钩子；颜色与图标归主题，组件不硬编码）；
 * - 无障碍：`role="status"` + `aria-live="polite"`（新通知播报但不打断阅读）。
 */

/** ToastStack 属性（受控） */
export interface ToastStackProps {
  /** 通知队列（时间序；由 store 提供） */
  readonly items: readonly ToastItem[];
  /**
   * 文本键物化（第二参为插值变量；通常包装 TextResolver：
   * `(key, vars) => resolver.resolve(key, lang, vars).text`）
   */
  readonly nameOf: (key: string, vars?: Readonly<Record<string, unknown>>) => string;
  /** 关闭回调（点击条目手动关闭） */
  readonly onDismiss: (id: number) => void;
  /** 队列上限（超出时只渲染最近 N 条；缺省不限制——上限策略归宿主） */
  readonly maxVisible?: number;
}

/**
 * Toast 浮层（见模块 TSDoc）。
 *
 * 渲染为按钮（可聚焦、可键盘关闭），点击即回调 `onDismiss`；空队列返回 null
 * （零占位，不产生不可见容器）。
 */
export function ToastStack(props: ToastStackProps): ReactNode {
  if (props.items.length === 0) return null;
  const visible =
    props.maxVisible !== undefined && props.items.length > props.maxVisible
      ? props.items.slice(-props.maxVisible)
      : props.items;
  return (
    <div style={styles.root} role="status" aria-live="polite">
      {visible.map((item) => (
        <button
          key={item.id}
          type="button"
          data-kind={item.kind}
          data-toast={item.id}
          onClick={() => props.onDismiss(item.id)}
          style={styles.toast}
        >
          <span style={styles.text}>{props.nameOf(item.textKey, item.vars)}</span>
          {item.count > 1 ? <span style={styles.count}>{`×${item.count}`}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** 样式（内联；仅锁定结构与堆叠方向，视觉归主题） */
const styles: Record<string, CSSProperties> = {
  root: {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    maxWidth: '320px',
    zIndex: 1000,
  },
  toast: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '8px 12px',
    fontSize: '13px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  text: { minWidth: 0 },
  count: { fontSize: '12px', fontWeight: 600, opacity: 0.8 },
};
