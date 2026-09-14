/**
 * notifications 切片出口（设计 §6.4 末段通知系统；FR-UI-07）。
 *
 * 队列状态在 UiStore（app/types.ts 的 notifications 切片），本切片提供：
 * 合并/过期纯函数（toast.ts）与浮层组件（ToastStack.tsx）。
 */
export {
  expireToasts,
  mergeToast,
  nextToastId,
  TOAST_DEFAULT_TTL_MS,
  TOAST_MERGE_WINDOW_MS,
} from './toast.js';
export type { MergeToastOptions, ToastInput } from './toast.js';
export { ToastStack } from './ToastStack.js';
export type { ToastStackProps } from './ToastStack.js';
