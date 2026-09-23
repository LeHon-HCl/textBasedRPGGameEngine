import { z } from 'zod';
import type { EffectRegistryOptions } from '../types.js';
import { eraseDef } from '../types.js';
import type { EffectInstructionDef, ErasedEffectDef, TouchReport } from '../types.js';

/**
 * 商店类内部指令（引擎内部面，不面向作者；§5.3，17 号 S4）。
 *
 * `__shop.restock` 是时间管线 day_rollover 槽位的载体（与 `__time.advance` /
 * `__npc.resolve` / `__quest.deadline` 同形态）：**条目级补货调度**（17 号
 * 缺口②裁定 2026-09-23 实现）——
 * - 商品声明 `restock: N`（时段数）时：距上次补货 ≥ N 个时段才补货，计时经
 *   `world.shopRestock`（键同 shopStock，值 = 天×1000 + 时段）
 *   ——「面包店每天补、稀有药材每 3 天补」这类商业节奏由此表达；
 * - 未声明 `restock` 时：每次钩子触发即补（跨天语义，向后兼容）。
 * 钩子本身每天触发一次（管线 day_rollover），故 N 的实际粒度以「天」为上限
 * 精度——`restock: 4`（4 时段）在跨天触发下等于每天补（demo 数据即此语义）。
 *
 * 作者包内书写 `__shop.restock` 会被 effectDataSchema 的加载期校验拒绝
 * （未知指令键），运行期仅管线可达。
 */
export function createShopInternalDefs(options: EffectRegistryOptions): ErasedEffectDef[] {
  const restockDef: EffectInstructionDef<Record<string, never>> = {
    id: '__shop.restock',
    schema: z.strictObject({}),
    touch: (): TouchReport => ({ reads: [], writes: ['world.shopStock', 'world.shopRestock'] }),
    execute: (_arg, ectx) => {
      const shops = options.shops;
      if (shops === undefined || shops.size === 0) return;
      const draft = ectx.draft;
      // 时间计数（天 × 1000 + 时段）：单调、与时区/时段制配置解耦的比较基准。
      // 时段制按「每日时段数」配置（TimeConfig），取 1000 的上界避免溢出与耦合。
      const clock = draft.world.time;
      const nowCount = clock.day * 1000 + clock.slotIndex;
      for (const shop of shops.values()) {
        for (const entry of shop.entries) {
          if (entry.stock === undefined) continue; // 无限库存不补货
          const key = `${shop.id}/${entry.item}`;
          if (entry.restock === undefined) {
            // 无周期声明：跨天钩子语义 = 每次触发即补（旧行为，向后兼容）
            draft.world.shopStock[key] = entry.stock;
            continue;
          }
          // 条目级调度：距上次补货达 restock 个时段才补（首日/未登记视为到期）
          const last = draft.world.shopRestock[key];
          if (last === undefined || nowCount - last >= entry.restock) {
            draft.world.shopStock[key] = entry.stock;
            draft.world.shopRestock[key] = nowCount;
          }
        }
      }
    },
  };

  /**
   * `__shop.set_stock`：库存增量写入（交易事务的组成部分，17 号 S2/S4）。
   *
   * 语义：基数为「已登记值，否则 ShopDef 初始 stock」；**无限库存条目**
   * （ShopDef 未声明 stock 且未登记）静默无操作——交易层不需要分支判断。
   * 作为交易效果批次的一员执行，与钱物同事务原子（失败一并回滚）。
   */
  const setStockDef: EffectInstructionDef<{ shop: string; item: string; delta: number }> = {
    id: '__shop.set_stock',
    schema: z.strictObject({
      shop: z.string().min(1),
      item: z.string().min(1),
      delta: z.number().int(),
    }),
    touch: (): TouchReport => ({ reads: [], writes: ['world.shopStock'] }),
    execute: (arg, ectx) => {
      const shopDef = options.shops?.get(arg.shop);
      const entry = shopDef?.entries.find((candidate) => candidate.item === arg.item);
      const key = `${arg.shop}/${arg.item}`;
      const recorded = ectx.draft.world.shopStock[key];
      const base = recorded ?? entry?.stock;
      if (base === undefined) return; // 无限库存：不登记、不变化
      ectx.draft.world.shopStock[key] = Math.max(0, base + arg.delta);
    },
  };

  return [eraseDef(restockDef), eraseDef(setStockDef)];
}
