import type { GameId, ShopDef } from '@game/shared';
import type { GameState } from '../state/index.js';
import type { TimeStepProvider } from '../time/index.js';

/**
 * 商店库存读写与补货（设计 §5.3，17 号 S4；FR-ECON-02）。
 *
 * 存储面：`world.shopStock`（键 `<shopId>/<itemId>`；17 号 schema 与状态树
 * 双侧 additive 补齐——设计只写「stock 计数 + 周期性补货」，未指定存放位置）。
 *
 * - {@link readStock}：读库存。**未登记 = 无限库存**（返回 undefined）——
 *   与 ShopEntry.stock 省略同语义；ShopDef 声明了 stock 但尚未交易过时，
 *   返回声明值（初始库存）；
 * - {@link writeStock}：交易后记账（-1 / +1）；写回后即「已登记」，
 *   后续读取以状态树为准；
 * - {@link createRestockProvider}：管线 day_rollover 钩子——跨天时把全部
 *   声明了 stock 的条目重置为初始值（「周期性补货」的最小可用语义；条目级
 *   restock 周期字段的细粒度调度留给真实内容需求出现时扩展）。
 */

/** 库存键（shopId/itemId） */
export function stockKey(shopId: GameId, itemId: GameId): string {
  return `${shopId}/${itemId}`;
}

/** 读库存：状态树登记优先，否则回落 ShopDef 初始值；均无 = 无限（undefined） */
export function readStock(
  state: GameState,
  shops: ReadonlyMap<GameId, ShopDef>,
  shopId: GameId,
  itemId: GameId,
): number | undefined {
  const recorded = state.world.shopStock?.[stockKey(shopId, itemId)];
  if (recorded !== undefined) return recorded;
  const entry = shops.get(shopId)?.entries.find((candidate) => candidate.item === itemId);
  return entry?.stock;
}

/** 写库存（交易记账入口；写成即登记，后续以状态树为准） */
export function writeStock(state: GameState, shopId: GameId, itemId: GameId, next: number): void {
  state.world.shopStock[stockKey(shopId, itemId)] = Math.max(0, Math.trunc(next));
}

/**
 * 补货钩子（管线 day_rollover 槽位，§4.3 步骤 4）：跨天时把全部有限库存条目
 * 重置为 ShopDef 声明的初始值。
 *
 * 返回**内部指令** `__shop.restock`（与 `__npc.resolve` / `__quest.deadline`
 * 同款——写状态域的操作以内部指令进事务，作者包内不可达）；管线契约要求钩子
 * 只收集数据，执行由 runtime.exec 原子完成。
 */
export function createRestockProvider(): TimeStepProvider {
  return () => [{ '__shop.restock': {} } as unknown as import('@game/shared').EffectData];
}
