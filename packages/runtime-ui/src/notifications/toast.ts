import type { TextKey } from '@game/shared';
import type { ToastItem, ToastKind } from '../app/types.js';

/**
 * Toast 通知系统（设计 §6.4 末段 / FR-UI-07）。
 *
 * 合并策略（FR-UI-07「防刷屏合并策略」的落地口径）：
 * - **同类同键**（`kind` + `textKey` 相同）且在 {@link TOAST_MERGE_WINDOW_MS}
 *   窗口内 → 折叠为一条，`count` 递增、`at` 刷新为最新入队时刻；
 * - 窗口基准是「最近一条同类条目」的入队时刻（而非首条）——连续快速刷屏
 *   合并为一条，间隔超过窗口则重新起条（不吞信息）；
 * - 不同 kind 或不同 textKey 各自成条；合并产物**替换原位置**（保持时间序）。
 *
 * 本模块为纯函数（无定时器、无 DOM）：自动消失由宿主定时器驱动
 * （`onExpire` 回调），使合并逻辑可在 node 环境直接断言。
 */

/** 合并窗口（ms；设计 §6.2「同类 500ms 窗口合并」） */
export const TOAST_MERGE_WINDOW_MS = 500;

/** 缺省存活时长（ms；超期由宿主移除——防累积） */
export const TOAST_DEFAULT_TTL_MS = 4000;

/** 入队输入（id 由 store 分配；at 由调用方给或取当前时刻） */
export interface ToastInput {
  readonly kind: ToastKind;
  readonly textKey: TextKey;
  readonly vars?: Readonly<Record<string, unknown>>;
  /** 入队时刻（epoch 毫秒；测试可注入以获得确定性） */
  readonly at?: number;
}

/** 合并选项 */
export interface MergeToastOptions {
  /** 合并窗口（ms；缺省 {@link TOAST_MERGE_WINDOW_MS}） */
  readonly windowMs?: number;
  /** 新条目的 id 分配器（缺省取 `max(id) + 1`） */
  readonly nextId?: () => number;
}

/**
 * 合并入队（纯函数：返回新数组，不修改入参与原条目）。
 *
 * @param items 现有队列（时间序）
 * @param input 新通知（kind / textKey / vars / at）
 * @param options 窗口与 id 策略（缺省 500ms 与自增）
 * @returns 新队列；命中合并窗口时替换原条目，否则追加到末尾
 */
export function mergeToast(
  items: readonly ToastItem[],
  input: ToastInput,
  options: MergeToastOptions = {},
): ToastItem[] {
  const windowMs = options.windowMs ?? TOAST_MERGE_WINDOW_MS;
  const at = input.at ?? Date.now();
  // 从后往前找「最近一条同类同键」：它才是合并基准（避免与更早的同类误并）
  for (let index = items.length - 1; index >= 0; index--) {
    const candidate = items[index] as ToastItem;
    if (candidate.kind !== input.kind || candidate.textKey !== input.textKey) continue;
    if (at - candidate.at > windowMs) break;
    const merged: ToastItem = {
      id: candidate.id,
      kind: candidate.kind,
      textKey: candidate.textKey,
      ...(input.vars !== undefined ? { vars: input.vars } : {}),
      count: candidate.count + 1,
      at,
    };
    const next = [...items];
    next[index] = merged;
    return next;
  }
  const id = options.nextId?.() ?? nextToastId(items);
  return [
    ...items,
    {
      id,
      kind: input.kind,
      textKey: input.textKey,
      ...(input.vars !== undefined ? { vars: input.vars } : {}),
      count: 1,
      at,
    },
  ];
}

/** 缺省 id 分配：现有最大 id + 1（单调，保证 React key 稳定） */
export function nextToastId(items: readonly ToastItem[]): number {
  let max = 0;
  for (const item of items) {
    if (item.id > max) max = item.id;
  }
  return max + 1;
}

/**
 * 过期清理（纯函数）：移除 `now - at > ttl` 的条目。
 *
 * @param items 现有队列
 * @param now 当前时刻（epoch 毫秒；宿主定时器注入）
 * @param ttl 存活时长（ms；缺省 {@link TOAST_DEFAULT_TTL_MS}）
 */
export function expireToasts(
  items: readonly ToastItem[],
  now: number,
  ttl: number = TOAST_DEFAULT_TTL_MS,
): ToastItem[] {
  const survivors = items.filter((item) => now - item.at <= ttl);
  // 无变化时保持原引用（避免宿主每 tick 触发一次无效重渲染）
  return survivors.length === items.length ? (items as ToastItem[]) : survivors;
}
