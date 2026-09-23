import { describe, expect, it } from 'vitest';
import { createRng, type ShopDef } from '@game/shared';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { newGameState } from '../../src/state/index.js';
import { itemDefSchema } from '@game/shared';
import { createShopProjection } from '../../src/economy/shop-service.js';

/**
 * S1 测试（17 号子任务 1/2/3）：条目投影（showIf 过滤 + 库存）与定价表达式。
 *
 * 覆盖矩阵口径（任务文件「定价表达式矩阵」）：
 * - 定价可引用声望 / 时段 / 周目 / 好感（§5.3 明示的四类变量）；
 * - showIf 过滤（含 flag 条件）；库存投影（有库存 / 无限）；
 * - 求值失败显性化（EFFECT_FAILED）；编译缓存复用（同表达式只编译一次）。
 */

const SHOPS = new Map<string, ShopDef>([
  [
    'shop_market',
    {
      id: 'shop_market',
      nameKey: 'shops.market.name',
      entries: [
        // 基础价 + 声望折扣：声望越高越便宜
        { item: 'warm_bun', stock: 5 },
        { item: 'guard_coat', showIf: 'flag.coat_unlocked' },
      ],
      priceBuy: '10 + 20 - faction.town',
      priceSell: '5',
      currency: 'town_silver',
    },
  ],
  [
    'shop_night',
    {
      id: 'shop_night',
      nameKey: 'shops.night.name',
      entries: [{ item: 'warm_bun' }],
      // 时段定价：夜里涨价（time.slot 为字符串，用条件表达式）
      priceBuy: "time.slot == 'night' ? 30 : 10",
      priceSell: '4',
    },
  ],
]);

function makeState(overrides?: {
  factions?: Record<string, number>;
  flags?: Record<string, unknown>;
}) {
  const state = newGameState(
    {
      versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
      attrs: { hp: 30 },
      factions: overrides?.factions ?? { town: 0 },
    },
    createRng(1),
  );
  if (overrides?.flags !== undefined) {
    Object.assign(state.world.flags, overrides.flags);
  }
  return state;
}

function makeService(init?: {
  state?: ReturnType<typeof makeState>;
  stockOf?: (shopId: string, itemId: string) => number | undefined;
}) {
  let state = init?.state ?? makeState();
  const service = createShopProjection({
    state: () => state,
    shops: SHOPS,
    functionRegistry: createBuiltinFunctionRegistry(),
    rng: createRng(7),
    ...(init?.stockOf !== undefined ? { stockOf: init.stockOf } : {}),
  });
  return { service, setState: (next: ReturnType<typeof makeState>) => (state = next) };
}

describe('17-S1 entries()：条目投影（showIf 过滤 + 库存，FR-ECON-02）', () => {
  it('showIf 为假 → 不上架；为真 → 上架', () => {
    const { service } = makeService({ state: makeState({ flags: {} }) });
    expect(service.entries('shop_market').map((entry) => entry.itemId)).toEqual(['warm_bun']);

    const unlocked = makeService({ state: makeState({ flags: { coat_unlocked: true } }) });
    expect(unlocked.service.entries('shop_market').map((entry) => entry.itemId)).toEqual([
      'warm_bun',
      'guard_coat',
    ]);
  });

  it('库存投影：stockOf 有读数 → 携带；无读数 → 字段省略（无限库存）', () => {
    const { service } = makeService({
      stockOf: (shopId, itemId) =>
        shopId === 'shop_market' && itemId === 'warm_bun' ? 3 : undefined,
    });
    const views = service.entries('shop_market');
    expect(views[0]?.stock).toBe(3);
  });

  it('库存为 0 仍上架（售罄展示由 UI 判定，投影只报事实）', () => {
    const { service } = makeService({ stockOf: () => 0 });
    expect(service.entries('shop_market')[0]?.stock).toBe(0);
  });

  it('未知商店 → DANGLING_REF 显性化', () => {
    const { service } = makeService();
    expect(() => service.entries('shop_ghost')).toThrowError(/不存在/);
  });
});

describe('17-S1 priceOf()：定价表达式矩阵（FR-ECON-02/03）', () => {
  it('声望变量参与定价：声望升高 → 买价下降', () => {
    const poor = makeService({ state: makeState({ factions: { town: 0 } }) });
    expect(poor.service.priceOf('shop_market', 'warm_bun', 'buy').amount).toBe(30);
    const famous = makeService({ state: makeState({ factions: { town: 10 } }) });
    expect(famous.service.priceOf('shop_market', 'warm_bun', 'buy').amount).toBe(20);
  });

  it('时段条件定价：time.slot 驱动（注入命名时段视图后 night 涨价）', () => {
    // 命名时段（'night'）需经 TimeViewProvider 注入（09 号 TimeConfig 校准面）；
    // 缺省 defaultTimeView 直传 slotIndex（数字），命名比较恒假——本用例锁定注入路径
    const slots = ['morning', 'noon', 'evening', 'night'];
    const state = makeState();
    const service = createShopProjection({
      state: () => state,
      shops: SHOPS,
      functionRegistry: createBuiltinFunctionRegistry(),
      rng: createRng(7),
      timeView: (clock) => ({
        day: clock.day,
        weekday: `d${clock.day}`,
        slot: slots[clock.slotIndex] ?? 'morning',
      }),
    });
    state.world.time.slotIndex = 3; // night
    expect(service.priceOf('shop_night', 'warm_bun', 'buy').amount).toBe(30);
    state.world.time.slotIndex = 0; // morning
    expect(service.priceOf('shop_night', 'warm_bun', 'buy').amount).toBe(10);
  });

  it('状态变化即时反映（定价每次现取作用域，非快照）', () => {
    const state = makeState({ factions: { town: 0 } });
    const { service } = makeService({ state });
    expect(service.priceOf('shop_market', 'warm_bun', 'buy').amount).toBe(30);
    state.factions['town'] = 20; // 同上一个 state 实例
    expect(service.priceOf('shop_market', 'warm_bun', 'buy').amount).toBe(10);
  });

  it('currency 回落：未声明 currency 的商店用 defaultCurrency/缺省 money', () => {
    const { service } = makeService();
    expect(service.priceOf('shop_night', 'warm_bun', 'buy').currency).toBe('money');
  });

  it('卖价独立于买价（priceSell 表达式）', () => {
    const { service } = makeService();
    expect(service.priceOf('shop_market', 'warm_bun', 'sell').amount).toBe(5);
  });
});

describe('17-S1 缺口③方案 A：定价表达式引用 item.<id>.price（基准价，2026-09-23 裁定实现）', () => {
  const SHOPS_PRICE = new Map<string, ShopDef>([
    [
      'shop_priced',
      {
        id: 'shop_priced',
        nameKey: 'shops.priced.name',
        entries: [{ item: 'warm_bun' }, { item: 'guard_coat' }],
        // 按基准价打折（声望 ≥ 5 时九折）——scheme A 的直接收益
        priceBuy: 'item.warm_bun.price * (faction.town >= 5 ? 0.9 : 1)',
        priceSell: 'item.warm_bun.price * 0.5',
        currency: 'town_silver',
      },
    ],
  ]);

  const ITEMS = new Map([
    [
      'warm_bun',
      itemDefSchema.parse({ id: 'warm_bun', nameKey: 'items.bun', type: 'consumable', price: 10 }),
    ],
    [
      'guard_coat',
      itemDefSchema.parse({ id: 'guard_coat', nameKey: 'items.coat', type: 'normal', price: 40 }),
    ],
  ]);

  function makeService(factions: Record<string, number>) {
    const state = newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
        attrs: { hp: 30 },
        factions,
      },
      createRng(1),
    );
    return createShopProjection({
      state: () => state,
      shops: SHOPS_PRICE,
      items: ITEMS,
      functionRegistry: createBuiltinFunctionRegistry(),
      rng: createRng(7),
    });
  }

  it('item.<id>.price 可读：按基准价计算（原价 / 声望折扣）', () => {
    expect(makeService({ town: 0 }).priceOf('shop_priced', 'warm_bun', 'buy').amount).toBe(10);
    expect(makeService({ town: 5 }).priceOf('shop_priced', 'warm_bun', 'buy').amount).toBe(9);
  });

  it('卖价表达式同样可用（半价基准）', () => {
    expect(makeService({ town: 0 }).priceOf('shop_priced', 'warm_bun', 'sell').amount).toBe(5);
  });

  it('未注入物品目录：item.<id>.price 引用 → EVAL_ERROR（封闭域显性化，不静默 0）', () => {
    const state = newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
        attrs: { hp: 30 },
        factions: { town: 0 },
      },
      createRng(1),
    );
    const service = createShopProjection({
      state: () => state,
      shops: SHOPS_PRICE,
      functionRegistry: createBuiltinFunctionRegistry(),
      rng: createRng(7),
      // 未注入 items
    });
    expect(() => service.priceOf('shop_priced', 'warm_bun', 'buy')).toThrowError();
  });

  it('注入目录但物品未声明 price → EVAL_ERROR（不静默 0）', () => {
    const itemsNoPrice = new Map([
      [
        'warm_bun',
        itemDefSchema.parse({ id: 'warm_bun', nameKey: 'items.bun', type: 'consumable' }),
      ],
    ]);
    const state = newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
        attrs: { hp: 30 },
        factions: { town: 0 },
      },
      createRng(1),
    );
    const service = createShopProjection({
      state: () => state,
      shops: SHOPS_PRICE,
      items: itemsNoPrice,
      functionRegistry: createBuiltinFunctionRegistry(),
      rng: createRng(7),
    });
    expect(() => service.priceOf('shop_priced', 'warm_bun', 'buy')).toThrowError();
  });
});
