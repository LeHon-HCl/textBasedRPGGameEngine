import type { EffectData, GameId, ItemDef, ShopDef } from '@game/shared';
import { EngineError } from '@game/shared';
import type { GameRuntime } from '../runtime/index.js';
import type { ExecOutcome } from '../runtime/index.js';
import type { GameState } from '../state/index.js';
import type { ShopPrice, ShopService } from './types.js';
import { createShopProjection, type ShopServiceOptions } from './shop-service.js';

/**
 * 商店服务：交易事务（设计 §5.3，17 号 S2；FR-ECON-03/04）。
 *
 * **原子性策略（关键设计决定）**：buy/sell 不自己改状态，而是把交易翻译成
 * 一批**效果指令**交给 GameRuntime.exec——
 *
 * - buy = `[{money: {<currency>: -price}}, {give: {item, count}}]`；
 * - sell = `[{money: {<currency>: +price}}, {take: {item, count}}]`；
 *
 * 事务语义由运行时保证（钱不够 / 超库存 / 背包溢出 → 整批回滚，与选项效果
 * 同款，§3.1）。本层只负责：定价求值、库存校验（前置显性化）、把批量交易
 * 规整为单批效果、回购价登记、trade 事件补发。
 *
 * **回购一致性（FR-ECON-03）**：卖出时把该次成交价登记进 `sellPrices`
 * （shopId+itemId → {price, day, slotIndex}）；同一「交易会话」内再次买回
 * 同物品，按登记的卖价成交，而非 priceBuy。会话边界 = **同一天同一时段**——
 * 跨时段/跨天即失效（需求原文「当次交易内回购同价」，此处以时间片界定「当次」，
 * 避免引入会话对象生命周期）。
 */

/** 回购登记条目（时间片界定「当次交易」） */
interface SellRecord {
  readonly price: number;
  readonly currency: GameId;
  readonly day: number;
  readonly slotIndex: number;
}

export interface ShopServiceDeps extends ShopServiceOptions {
  /** 运行时（交易事务的执行面；提供 exec 与当前状态） */
  readonly runtime: GameRuntime;
  /**
   * 物品目录（give/take 的类型校验与堆叠语义由运行时注册表持有；本层仅用于
   * 条目存在性自检，缺省不校验——加载期 crossRef 已核对 ShopEntry.item）
   */
  readonly items?: ReadonlyMap<GameId, ItemDef>;
  /** 库存读取缝（同投影层；S4 接存档域） */
  readonly stockOf?: (shopId: GameId, itemId: GameId) => number | undefined;
  /**
   * 库存记账（缺省 = 启用内置 `__shop.set_stock` 内部指令，随交易事务原子执行）。
   * 置 false 关闭记账（纯投影场景）。
   */
  readonly stockAccounting?: boolean;
  /** 交易后效果（作者声明，FR-ECON-04）：交易成功时追加执行 */
  readonly onTrade?: (
    shopId: GameId,
    itemId: GameId,
    mode: 'buy' | 'sell',
  ) => readonly EffectData[];
}

/** 从运行时状态取时间片（回购登记的有效期判定） */
function timeSliceOf(state: GameState): { day: number; slotIndex: number } {
  return { day: state.world.time.day, slotIndex: state.world.time.slotIndex };
}

/**
 * 创建完整商店服务（投影 + 定价 + 交易）。
 *
 * @throws EngineError（EFFECT_FAILED）：数量非法 / 库存不足 / 卖出持有不足
 *   （**前置校验**，与事务内校验双保险——前置失败不产生任何副作用）。
 */
export function createShopService(deps: ShopServiceDeps): ShopService {
  const projection = createShopProjection(deps);
  const sellRecords = new Map<string, SellRecord>();
  const keyOf = (shopId: GameId, itemId: GameId): string => `${shopId}/${itemId}`;

  const requireShop = (shopId: GameId): ShopDef => {
    const shop = deps.shops.get(shopId);
    if (shop === undefined) {
      throw new EngineError({
        code: 'DANGLING_REF',
        where: { op: 'shop', shop: shopId, detail: `商店 '${shopId}' 不存在` },
        messageKey: 'error.loader.danglingRef',
      });
    }
    return shop;
  };

  const requireEntry = (shop: ShopDef, itemId: GameId) => {
    const entry = shop.entries.find((candidate) => candidate.item === itemId);
    if (entry === undefined) {
      throw new EngineError({
        code: 'EFFECT_FAILED',
        where: {
          op: 'shop',
          shop: shop.id,
          item: itemId,
          detail: `条目 '${itemId}' 不在商店 '${shop.id}' 的商品表中`,
        },
        messageKey: 'error.effects.instructionFailed',
      });
    }
    return entry;
  };

  const requirePositiveCount = (count: number, shopId: GameId, itemId: GameId): void => {
    if (!Number.isInteger(count) || count <= 0) {
      throw new EngineError({
        code: 'EFFECT_FAILED',
        where: {
          op: 'shop',
          shop: shopId,
          item: itemId,
          detail: `交易数量须为正整数，实际 ${String(count)}`,
        },
        messageKey: 'error.effects.instructionFailed',
      });
    }
  };

  /** 有效回购登记（同天同时段才算「当次交易」） */
  const activeSell = (shopId: GameId, itemId: GameId): SellRecord | undefined => {
    const record = sellRecords.get(keyOf(shopId, itemId));
    if (record === undefined) return undefined;
    const { day, slotIndex } = timeSliceOf(deps.runtime.state);
    if (record.day !== day || record.slotIndex !== slotIndex) {
      sellRecords.delete(keyOf(shopId, itemId));
      return undefined;
    }
    return record;
  };

  /**
   * 交易后效果（FR-ECON-04）：作者声明的交易完成效果（声望/flag/任务进度），
   * 与钱物同批执行（原子性一致——交易成功才生效）。
   */
  const tradeEffects = (
    shopId: GameId,
    itemId: GameId,
    mode: 'buy' | 'sell',
  ): readonly EffectData[] => [...(deps.onTrade?.(shopId, itemId, mode) ?? [])];

  /** 库存记账效果（内置内部指令；stockAccounting: false 时关闭） */
  const stockEffects = (shopId: GameId, itemId: GameId, delta: number): readonly EffectData[] =>
    deps.stockAccounting === false
      ? []
      : [{ '__shop.set_stock': { shop: shopId, item: itemId, delta } } as unknown as EffectData];

  return {
    entries: (shopId) => projection.entries(shopId),
    priceOf: (shopId, itemId, mode) => projection.priceOf(shopId, itemId, mode),

    buy(shopId: GameId, itemId: GameId, count: number): ExecOutcome {
      requirePositiveCount(count, shopId, itemId);
      const shop = requireShop(shopId);
      const entry = requireEntry(shop, itemId);
      const stock = deps.stockOf?.(shopId, itemId) ?? entry.stock;
      if (stock !== undefined && stock < count) {
        throw new EngineError({
          code: 'EFFECT_FAILED',
          where: {
            op: 'shop',
            shop: shopId,
            item: itemId,
            detail: `库存不足：剩余 ${String(stock)}，请求 ${String(count)}`,
          },
          messageKey: 'error.effects.instructionFailed',
        });
      }
      // 回购价优先（当次交易内一致，FR-ECON-03）；否则 priceBuy
      const record = activeSell(shopId, itemId);
      const price: ShopPrice =
        record !== undefined && record.price !== undefined
          ? { amount: record.price, currency: record.currency }
          : projection.priceOf(shopId, itemId, 'buy');
      const effects: EffectData[] = [
        { money: { [price.currency]: -price.amount * count } },
        { give: { item: itemId, count } },
        // 库存记账进同一事务（原子：钱/物/库存一致，失败一并回滚）
        ...stockEffects(shopId, itemId, -count),
        ...tradeEffects(shopId, itemId, 'buy'),
      ];
      const outcome = deps.runtime.exec(effects, {
        source: 'choice',
        where: { scene: 'shop', shop: shopId },
        rng: deps.rng,
      });
      if (record !== undefined) sellRecords.delete(keyOf(shopId, itemId)); // 回购完成即消费登记
      outcome.events.push({
        type: 'trade',
        shop: shopId,
        item: itemId,
        mode: 'buy',
        count,
        amount: price.amount * count,
        currency: price.currency,
      });
      return outcome;
    },

    sell(shopId: GameId, itemId: GameId, count: number): ExecOutcome {
      requirePositiveCount(count, shopId, itemId);
      const shop = requireShop(shopId);
      requireEntry(shop, itemId); // 条目存在性自检（悬空条目显性化）
      const held = deps.runtime.state.player.bag
        .filter((bagEntry) => bagEntry.itemId === itemId)
        .reduce((sum, bagEntry) => sum + bagEntry.count, 0);
      if (held < count) {
        throw new EngineError({
          code: 'EFFECT_FAILED',
          where: {
            op: 'shop',
            shop: shopId,
            item: itemId,
            detail: `持有不足：现有 ${String(held)}，请求卖出 ${String(count)}`,
          },
          messageKey: 'error.effects.instructionFailed',
        });
      }
      const price = projection.priceOf(shopId, itemId, 'sell');
      const effects: EffectData[] = [
        { money: { [price.currency]: price.amount * count } },
        { take: { item: itemId, count } },
        ...stockEffects(shopId, itemId, count),
        ...tradeEffects(shopId, itemId, 'sell'),
      ];
      const outcome = deps.runtime.exec(effects, {
        source: 'choice',
        where: { scene: 'shop', shop: shopId },
        rng: deps.rng,
      });
      // 登记卖价（回购一致性）：同天同时段内买回按此价
      const { day, slotIndex } = timeSliceOf(deps.runtime.state);
      sellRecords.set(keyOf(shopId, itemId), {
        price: price.amount,
        currency: price.currency,
        day,
        slotIndex,
      });
      outcome.events.push({
        type: 'trade',
        shop: shopId,
        item: itemId,
        mode: 'sell',
        count,
        amount: price.amount * count,
        currency: price.currency,
      });
      return outcome;
    },
  };
}
