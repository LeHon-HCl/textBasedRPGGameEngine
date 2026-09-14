import type { GameId, ItemType, ItemDef, TextKey } from '@game/shared';
import type { BagEntry } from '../state/index.js';

/**
 * 背包 UI 数据投影（FR-ITEM-02，§4.7，13 任务 6）。
 *
 * 纯函数层：bag + 物品目录 → 框架无关视图（runtime-ui 背包面板的唯一数据源
 * 口径）。不读状态树、不改状态——给什么投影什么。
 *
 * 视图口径：
 * - 按种类聚合（同 itemId 条目计数求和；不可堆叠多件显示为数量 n，UI 再按
 *   type/stack 决定呈现形态）；
 * - 关键道具（ItemDef.key）独立分区（FR-ITEM-02「独立分区」的呈现面；
 *   不可丢弃/出售的禁制归商店与丢弃入口校验，投影只标注 key 标记）；
 * - 排序：缺省目录声明序；'id' 字典序 / 'count' 数量降序可选；
 * - 搜索：itemId 与本地化名称双口径（名称经 nameOf 注入，引擎不持语言包）。
 */

/** 单条目视图（聚合后的种类级条目） */
export interface BagEntryView {
  readonly itemId: GameId;
  /** 聚合计数 */
  readonly count: number;
  readonly type: ItemType;
  readonly nameKey: TextKey;
  /** 最大堆叠（缺省 = 不可堆叠，UI 据此决定能否拆分） */
  readonly stack: number | undefined;
  /** 关键道具标记 */
  readonly key: boolean;
}

/** 背包视图（分区 + 容量信息） */
export interface BagProjection {
  /** 关键道具分区 */
  readonly keyItems: readonly BagEntryView[];
  /** 普通物品分区 */
  readonly normalItems: readonly BagEntryView[];
  /** 已用容量（原始条目数，与 bagCapacity 口径一致） */
  readonly capacityUsed: number;
  /** 容量上限（未启用为 undefined） */
  readonly capacityLimit: number | undefined;
}

/** 投影选项（全部可选） */
export interface BagProjectionOptions {
  /** 容量上限（启用容量显示时传入） */
  readonly capacity?: number;
  /** 排序键：缺省保持目录声明序 */
  readonly sort?: 'id' | 'count';
  /** 搜索词：匹配 itemId 与 nameOf(itemName)（大小写不敏感） */
  readonly query?: string;
  /** 本地化名称解析（搜索用；未注入时仅按 itemId 匹配） */
  readonly nameOf?: (itemId: GameId) => string;
}

/** 背包投影（FR-ITEM-02） */
export function projectBag(
  bag: readonly BagEntry[],
  items: ReadonlyMap<string, ItemDef>,
  options: BagProjectionOptions = {},
): BagProjection {
  // 按种类聚合计数（保持首次出现序）
  const counts = new Map<GameId, number>();
  for (const entry of bag) {
    counts.set(entry.itemId, (counts.get(entry.itemId) ?? 0) + entry.count);
  }
  const query = options.query?.trim().toLowerCase() ?? '';
  const nameOf = options.nameOf;
  const toView = (itemId: GameId, count: number): BagEntryView | undefined => {
    const def = items.get(itemId);
    if (query !== '') {
      const haystack = [itemId, nameOf?.(itemId) ?? ''].join('\n').toLowerCase();
      if (!haystack.includes(query)) return undefined;
    }
    return {
      itemId,
      count,
      type: def?.type ?? 'normal',
      nameKey: def?.nameKey ?? (`items.${itemId}` as TextKey),
      stack: def?.stack,
      key: def?.key === true,
    };
  };

  const keyItems: BagEntryView[] = [];
  const normalItems: BagEntryView[] = [];
  for (const [itemId, count] of counts) {
    const view = toView(itemId, count);
    if (view === undefined) continue;
    if (view.key) keyItems.push(view);
    else normalItems.push(view);
  }

  const sort = options.sort;
  if (sort === 'id') {
    keyItems.sort((a, b) => a.itemId.localeCompare(b.itemId));
    normalItems.sort((a, b) => a.itemId.localeCompare(b.itemId));
  } else if (sort === 'count') {
    keyItems.sort((a, b) => b.count - a.count);
    normalItems.sort((a, b) => b.count - a.count);
  }

  return {
    keyItems,
    normalItems,
    capacityUsed: bag.length,
    capacityLimit: options.capacity,
  };
}
