import { EngineError } from '@game/shared';
import type { BagEntry, GameId, ItemDef } from '@game/shared';

/**
 * Inventory 纯函数集（设计 §4.7「give/take 指令内部走 Inventory 纯函数集」，
 * 13 任务 1；FR-ITEM-02）。
 *
 * 全部为无副作用纯函数：入参 bag 不变异，返回新数组。失败统一抛
 * EngineError(EFFECT_FAILED)，指令层（effects/builtins/items.ts）直接透传，
 * 事务原子性由 GameRuntime.exec 兜底。
 *
 * 堆叠口径（与「容量按 bag 条目数计」自洽，见 EffectRegistryOptions.bagCapacity）：
 * - 可堆叠（ItemDef.stack 定义）：单条目 count 封顶 stack，超出拆新条目；
 * - 不可堆叠（stack 缺省）：每件独占一条目（count 恒 1）；
 * - 容量：仅在「新建条目」时校验（堆叠续加/扣减不触发）；一次 give 拆出的
 *   多条目整体校验（任一条目放不下则整批失败，不产生半截结果）；
 * - 关键道具（ItemDef.key）：存取与普通物品同口径，分区呈现属 UI 投影
 *   （items/projection.ts，13 任务 6），不可丢弃出售的禁制归商店/丢弃入口
 *   （17 号）校验。
 */

/** 构造 EFFECT_FAILED（op = 指令/操作名；detail 为作者可读的失败原因） */
function bagError(op: string, detail: string, where: Record<string, string>): EngineError {
  return new EngineError({
    code: 'EFFECT_FAILED',
    where: { op, ...where, detail },
    messageKey: 'error.items.bagOperation',
  });
}

/** 数量契约：正整数（0 由调用方短路，纯函数层拒绝 0 防御误用） */
function requirePositiveInt(op: string, count: number, where: Record<string, string>): void {
  if (!Number.isInteger(count) || count < 1) {
    throw bagError(op, `数量须为正整数，实际 ${String(count)}`, where);
  }
}

/** 浅拷贝条目数组（纯函数边界：内部改写只作用于副本） */
function cloneBag(bag: readonly BagEntry[]): BagEntry[] {
  return bag.map((entry) => ({ ...entry }));
}

/**
 * 背包增加：可堆叠物品优先续加未满条目（不触发容量），余量按 stack 封顶拆
 * 新条目；不可堆叠物品逐件建条目。容量按「需新建条目数」整体校验。
 * op 为失败归因的操作名（指令层传入指令 id，缺省 'give'）。
 */
export function bagGive(
  bag: readonly BagEntry[],
  def: ItemDef,
  count: number,
  capacity?: number,
  op = 'give',
): BagEntry[] {
  requirePositiveInt(op, count, { item: def.id });
  const result = cloneBag(bag);
  let remaining = count;
  if (def.stack !== undefined) {
    for (const entry of result) {
      if (remaining === 0) break;
      if (entry.itemId !== def.id || entry.count >= def.stack) continue;
      const take = Math.min(def.stack - entry.count, remaining);
      entry.count += take;
      remaining -= take;
    }
  }
  if (remaining > 0) {
    const perEntry = def.stack ?? 1;
    const newEntries = Math.ceil(remaining / perEntry);
    if (capacity !== undefined && result.length + newEntries > capacity) {
      throw bagError(
        op,
        `背包已满（容量 ${String(capacity)}，需新建 ${String(newEntries)} 条目，FR-ITEM-02）`,
        { item: def.id },
      );
    }
    while (remaining > 0) {
      const take = Math.min(perEntry, remaining);
      result.push({ itemId: def.id, count: take });
      remaining -= take;
    }
  }
  return result;
}

/**
 * 背包扣减：跨同 itemId 条目按序扣减，归零条目移除。
 * 持有量不足即 EFFECT_FAILED（携带需求数与实际数，作者可读）。
 * op 为失败归因的操作名（指令层传入指令 id，缺省 'take'）。
 */
export function bagTake(
  bag: readonly BagEntry[],
  itemId: GameId,
  count: number,
  op = 'take',
): BagEntry[] {
  requirePositiveInt(op, count, { item: itemId });
  const held = bagCount(bag, itemId);
  if (held < count) {
    throw bagError(
      op,
      `未持有足够物品 '${itemId}'（需要 ${String(count)}，实际 ${String(held)}）`,
      { item: itemId },
    );
  }
  let remaining = count;
  const result: BagEntry[] = [];
  for (const entry of bag) {
    if (entry.itemId !== itemId || remaining === 0) {
      result.push({ ...entry });
      continue;
    }
    const take = Math.min(entry.count, remaining);
    remaining -= take;
    if (entry.count - take > 0) result.push({ itemId: entry.itemId, count: entry.count - take });
  }
  return result;
}

/** 持有量（bag 中同 itemId 条目计数之和；表达 count() 与 UI 显示的数据源） */
export function bagCount(bag: readonly BagEntry[], itemId: GameId): number {
  return bag
    .filter((entry) => entry.itemId === itemId)
    .reduce((sum, entry) => sum + entry.count, 0);
}

/**
 * 拆分：从 itemId 的首个条目拆出 count 到尾部新条目（UI 部分移动的前提）。
 * 仅可堆叠物品合法（def.stack 必须定义）；拆出后原条目须保留 ≥ 1
 * （归零场景应使用 bagTake）。
 */
export function bagSplit(bag: readonly BagEntry[], def: ItemDef, count: number): BagEntry[] {
  requirePositiveInt('split', count, { item: def.id });
  if (def.stack === undefined) {
    throw bagError('split', `物品 '${def.id}' 不可堆叠（stack 缺省），无法拆分`, {
      item: def.id,
    });
  }
  const source = bag.find((entry) => entry.itemId === def.id);
  if (source === undefined) {
    throw bagError('split', `背包中不存在物品 '${def.id}'`, { item: def.id });
  }
  if (source.count - count < 1) {
    throw bagError(
      'split',
      `拆分数量超出条目余量（条目 ${String(source.count)}，拆 ${String(count)}，须保留 ≥ 1）`,
      { item: def.id },
    );
  }
  const result = cloneBag(bag);
  const index = result.findIndex((entry) => entry.itemId === def.id);
  const entry = result[index] as BagEntry;
  entry.count -= count;
  result.push({ itemId: def.id, count });
  return result;
}

/**
 * 合并：itemId 全部条目收敛为 stack 封顶的最少条目（首个条目原位收纳，
 * 余量尾部追加；其余条目原位保留）。不可堆叠物品（stack 缺省）拒绝——
 * 多条目各代表一件，合并改变语义。
 */
export function bagMerge(bag: readonly BagEntry[], def: ItemDef): BagEntry[] {
  if (def.stack === undefined) {
    throw bagError('merge', `物品 '${def.id}' 不可堆叠（stack 缺省），禁止合并`, {
      item: def.id,
    });
  }
  const total = bagCount(bag, def.id);
  const entries = bag.filter((entry) => entry.itemId === def.id);
  if (entries.length <= 1) return cloneBag(bag);
  const headCount = Math.min(def.stack, total);
  const result: BagEntry[] = [];
  let inserted = false;
  for (const entry of bag) {
    if (entry.itemId !== def.id) {
      result.push({ ...entry });
      continue;
    }
    if (!inserted) {
      result.push({ itemId: def.id, count: headCount });
      inserted = true;
    }
  }
  let remaining = total - headCount;
  while (remaining > 0) {
    const take = Math.min(def.stack, remaining);
    result.push({ itemId: def.id, count: take });
    remaining -= take;
  }
  return result;
}
