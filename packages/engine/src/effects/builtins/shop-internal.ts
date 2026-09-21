import { z } from 'zod';
import type { EffectRegistryOptions } from '../types.js';
import { eraseDef } from '../types.js';
import type { EffectInstructionDef, ErasedEffectDef, TouchReport } from '../types.js';

/**
 * 商店类内部指令（引擎内部面，不面向作者；§5.3，17 号 S4）。
 *
 * `__shop.restock` 是时间管线 day_rollover 附近的载体（与 `__time.advance` /
 * `__npc.resolve` / `__quest.deadline` 同形态）：跨天时把**全部有限库存条目**
 * 重置为 ShopDef 声明的初始值（「周期性补货」的最小可用语义；条目级 `restock`
 * 周期的细粒度调度留给真实内容需求出现时扩展——已登记 17 号落地记录）。
 *
 * 作者包内书写 `__shop.restock` 会被 effectDataSchema 的加载期校验拒绝
 * （未知指令键），运行期仅管线可达。
 */
export function createShopInternalDefs(options: EffectRegistryOptions): ErasedEffectDef[] {
  const restockDef: EffectInstructionDef<Record<string, never>> = {
    id: '__shop.restock',
    schema: z.strictObject({}),
    touch: (): TouchReport => ({ reads: [], writes: ['world.shopStock'] }),
    execute: (_arg, ectx) => {
      const shops = options.shops;
      if (shops === undefined || shops.size === 0) return;
      const draft = ectx.draft;
      for (const shop of shops.values()) {
        for (const entry of shop.entries) {
          if (entry.stock === undefined) continue; // 无限库存不补货
          const key = `${shop.id}/${entry.item}`;
          // 未消耗（等于初始值）也写入——保持域内显式登记，读取语义不变
          draft.world.shopStock[key] = entry.stock;
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
