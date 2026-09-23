import type { GameId, Rng, ShopDef } from '@game/shared';
import { EngineError } from '@game/shared';
import { compileExpr, evalExpr } from '../expr-eval/index.js';
import type { CompiledExpr, ExprFunctionRegistry, ExprScope, ExprTimeView } from '@game/shared';
import { buildExprScope, type GameState, type TimeViewProvider } from '../state/index.js';
import type { ShopEntryView, ShopPrice } from './types.js';

/**
 * 商店服务（设计 §5.3，17 号 S1/S2；FR-ECON-02/03/04）。
 *
 * 分层（S1 本文件先落投影与定价，交易事务见 `createShopService` 后半）：
 * - **投影**（{@link ShopServiceProjection.entries}）：showIf 过滤 + 库存投影。
 *   库存读取经注入的 `stockOf` 缝——库存是**运行时状态**（随存档），其存储面
 *   归宿主（20 号存档域扩展，S2/S4 落地），本层只消费读数；
 * - **定价**（{@link ShopServiceProjection.priceOf}）：ShopDef 的 priceBuy/
 *   priceSell 表达式在首次调用时编译并缓存，每次求值注入当前状态
 *   （声望/时段/周目/好感即普通变量，§5.3——作用域复用 `buildExprScope`）；
 * - 定价上下文：`ShopPrice.currency` 取 ShopDef.currency，缺省回落到
 *   `defaultCurrency`（宿主注入；游戏包无货币声明时 = 首个货币/或 'money'）。
 *
 * 求值失败（表达式运行期错误）显性化为 EFFECT_FAILED，不静默取 0。
 */

/** 商店服务的宿主注入面（存储/目录/求值依赖） */
export interface ShopServiceOptions {
  /** 读取当前状态（每次调用现取，投影与定价都基于最新快照） */
  readonly state: () => GameState;
  /** 商店目录（加载器发布面） */
  readonly shops: ReadonlyMap<GameId, ShopDef>;
  /**
   * 物品目录（`item.<id>.price` 基准价的数据源，17 号缺口③方案 A）：
   * 注入后定价表达式可写 `item.<id>.price * 0.9` 这类「按基准价打折」；
   * 缺省不注入 → 该类引用 EVAL_ERROR（封闭域，显性化）。
   */
  readonly items?: ReadonlyMap<GameId, import('@game/shared').ItemDef>;
  /** 表达式函数注册表（与运行时同一实例，§3.2） */
  readonly functionRegistry: ExprFunctionRegistry;
  /** 库存读取缝（S2/S4 接存档域；缺省 = 全部无限库存） */
  readonly stockOf?: (shopId: GameId, itemId: GameId) => number | undefined;
  /** 求值随机源（定价表达式可用随机函数时；DD-09） */
  readonly rng: Rng;
  /** 货币缺省值（ShopDef.currency 未声明时；同款回落口径） */
  readonly defaultCurrency?: GameId;
  /**
   * time 求值视图提供器（09 号以 TimeConfig 校准时段命名；缺省走
   * defaultTimeView 的 slotIndex 直传）。定价表达式用 `time.slot == 'night'`
   * 这类命名时段条件时必须注入，否则比较的是数字索引（恒假）。
   */
  readonly timeView?: TimeViewProvider;
}

/** 条目投影与定价面（S1；交易事务在 S2 追加） */
export interface ShopServiceProjection {
  entries(shopId: GameId): ShopEntryView[];
  priceOf(shopId: GameId, itemId: GameId, mode: 'buy' | 'sell'): ShopPrice;
}

const FALLBACK_CURRENCY = 'money';

/** 取商店定义；未知 id 显性化（加载期 crossRef 已拦，此处防御性再报） */
function requireShop(options: ShopServiceOptions, shopId: GameId): ShopDef {
  const shop = options.shops.get(shopId);
  if (shop === undefined) {
    throw new EngineError({
      code: 'DANGLING_REF',
      where: { op: 'shop', shop: shopId, detail: `商店 '${shopId}' 不存在` },
      messageKey: 'error.loader.danglingRef',
    });
  }
  return shop;
}

/** 构造求值作用域（状态投影 + 可选视图；两处求值共用，保证口径一致） */
function scopeOf(options: ShopServiceOptions): ExprScope {
  const views: { time?: ExprTimeView; itemPrices?: Readonly<Record<string, number>> } = {};
  if (options.timeView !== undefined) {
    views.time = options.timeView(options.state().world.time);
  }
  if (options.items !== undefined && options.items.size > 0) {
    const prices: Record<string, number> = {};
    for (const [id, def] of options.items) {
      if (typeof def.price === 'number') prices[id] = def.price;
    }
    views.itemPrices = prices;
  }
  return buildExprScope(options.state(), views);
}

/** 定价表达式求值（编译缓存 + 状态作用域；失败显性化） */
function evalPrice(
  options: ShopServiceOptions,
  cache: Map<string, CompiledExpr>,
  source: string,
  shopId: GameId,
  itemId: GameId,
): number {
  let compiled = cache.get(source);
  if (compiled === undefined) {
    compiled = compileExpr(source, options.functionRegistry);
    cache.set(source, compiled);
  }
  // 作用域经 buildExprScope 投影（bagCounts/npcLocationCache/time 视图等派生面
  // 只有投影后才有——直接传 GameState 会让 item.count / npc.<id>.at 类引用失真）
  const value = evalExpr(compiled, {
    state: scopeOf(options),
    rng: options.rng,
    registry: options.functionRegistry,
  });
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EngineError({
      code: 'EFFECT_FAILED',
      where: {
        op: 'shop',
        shop: shopId,
        item: itemId,
        expr: source,
        detail: `定价表达式求值结果为非有限数值（${String(value)}）`,
      },
      messageKey: 'error.effects.instructionFailed',
    });
  }
  return value;
}

/**
 * 创建投影与定价服务（S1）。
 * 编译缓存按服务实例持有（表达式原文 → CompiledExpr，§3.4 编译缓存同款口径）。
 */
export function createShopProjection(options: ShopServiceOptions): ShopServiceProjection {
  const cache = new Map<string, CompiledExpr>();
  const currencyOf = (shop: ShopDef): GameId =>
    shop.currency ?? options.defaultCurrency ?? FALLBACK_CURRENCY;

  const priceOf = (shopId: GameId, itemId: GameId, mode: 'buy' | 'sell'): ShopPrice => {
    const shop = requireShop(options, shopId);
    const source = mode === 'buy' ? shop.priceBuy : shop.priceSell;
    return {
      amount: evalPrice(options, cache, source, shopId, itemId),
      currency: currencyOf(shop),
    };
  };

  return {
    priceOf,
    entries(shopId: GameId): ShopEntryView[] {
      const shop = requireShop(options, shopId);
      const views: ShopEntryView[] = [];
      for (const entry of shop.entries) {
        // showIf 过滤（渐进语义：条件为真才上架）
        if (entry.showIf !== undefined) {
          let compiled = cache.get(entry.showIf);
          if (compiled === undefined) {
            compiled = compileExpr(entry.showIf, options.functionRegistry);
            cache.set(entry.showIf, compiled);
          }
          const shown = evalExpr(compiled, {
            state: scopeOf(options),
            rng: options.rng,
            registry: options.functionRegistry,
          });
          if (shown === false || shown === undefined || shown === null) continue;
        }
        const stock = options.stockOf?.(shopId, entry.item);
        const priceBuy = priceOf(shopId, entry.item, 'buy');
        const priceSell = priceOf(shopId, entry.item, 'sell');
        views.push({
          itemId: entry.item,
          priceBuy: priceBuy.amount,
          priceSell: priceSell.amount,
          ...(stock !== undefined ? { stock } : {}),
        });
      }
      return views;
    },
  };
}
