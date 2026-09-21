import { describe, expect, it } from 'vitest';
import { createRng, type ItemDef, type ShopDef } from '@game/shared';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { newGameState } from '../../src/state/index.js';
import { GameRuntime } from '../../src/runtime/index.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import { createShopService } from '../../src/economy/trade.js';

/**
 * S2 测试（17 号子任务 4/5/7）：交易原子性、回购一致性、trade 事件。
 *
 * 覆盖矩阵口径（任务文件「原子性测试 / 回购一致性」）：
 * - buy：成功入账（钱包 -、背包 +）；钱不够 → 整批回滚（钱物均不变）；
 * - sell：成功（钱包 +、背包 -）；持有不足 → 前置拒绝 + 事务回滚；
 * - 回购一致性：同天同时段卖后买回按卖价；跨时段失效按 priceBuy；
 * - 库存不足前置拒绝；trade 事件携带成交明细；onTrade 后置效果与钱物同批。
 */

const ITEMS = new Map<string, ItemDef>([
  ['warm_bun', { id: 'warm_bun', nameKey: 'items.bun', stack: 5, type: 'consumable' }],
  ['guard_coat', { id: 'guard_coat', nameKey: 'items.coat', type: 'normal', price: 40 }],
]);

const SHOPS = new Map<string, ShopDef>([
  [
    'shop_market',
    {
      id: 'shop_market',
      nameKey: 'shops.market.name',
      entries: [{ item: 'warm_bun', stock: 10 }, { item: 'guard_coat' }],
      priceBuy: '10',
      priceSell: '4',
      currency: 'town_silver',
    },
  ],
]);

function makeWorld(init?: {
  silver?: number;
  bag?: { itemId: string; count: number }[];
  stock?: number;
}) {
  const state = newGameState(
    {
      versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
      attrs: { hp: 30 },
    },
    createRng(1),
  );
  state.player.wallet['town_silver'] = init?.silver ?? 100;
  if (init?.bag !== undefined) {
    state.player.bag = init.bag.map((entry) => ({ ...entry })) as typeof state.player.bag;
  }
  const runtime = new GameRuntime({
    state,
    rng: createRng(7),
    effectExecutor: createBuiltinEffectRegistry({
      items: ITEMS,
      shops: SHOPS,
      functionRegistry: createBuiltinFunctionRegistry(),
    }),
  });
  // 库存读数：状态树登记优先，未登记回落初始库存（与生产 readStock 同口径）
  const initialStock = init?.stock ?? 10;
  const stockOf = () => runtime.state.world.shopStock['shop_market/warm_bun'] ?? initialStock;
  const service = createShopService({
    runtime,
    state: () => runtime.state,
    shops: SHOPS,
    functionRegistry: createBuiltinFunctionRegistry(),
    rng: createRng(7),
    items: ITEMS,
    stockOf,
  });
  return { runtime, service, stockNow: stockOf };
}

/** 背包中某物品总数（断言辅助） */
function heldCount(runtime: GameRuntime, itemId: string): number {
  return runtime.state.player.bag
    .filter((entry) => entry.itemId === itemId)
    .reduce((sum, entry) => sum + entry.count, 0);
}

describe('17-S2 buy：购买原子事务（FR-ECON-04）', () => {
  it('成功：扣钱 + 给物 + trade 事件 + 库存扣减', () => {
    const { runtime, service, stockNow } = makeWorld({ silver: 100 });
    const outcome = service.buy('shop_market', 'warm_bun', 2);
    expect(runtime.state.player.wallet['town_silver']).toBe(80); // 10 × 2
    expect(heldCount(runtime, 'warm_bun')).toBe(2);
    expect(stockNow()).toBe(8);
    expect(outcome.events).toContainEqual({
      type: 'trade',
      shop: 'shop_market',
      item: 'warm_bun',
      mode: 'buy',
      count: 2,
      amount: 20,
      currency: 'town_silver',
    });
  });

  it('钱不够 → EFFECT_FAILED 且整批回滚（钱、物、库存均不变）', () => {
    const { runtime, service, stockNow } = makeWorld({ silver: 5 }); // 买不起 10
    expect(() => service.buy('shop_market', 'warm_bun', 1)).toThrowError();
    expect(runtime.state.player.wallet['town_silver']).toBe(5);
    expect(heldCount(runtime, 'warm_bun')).toBe(0);
    expect(stockNow()).toBe(10); // 失败不扣库存
  });

  it('库存不足 → 前置拒绝（不产生任何副作用）', () => {
    const { runtime, service } = makeWorld({ silver: 1000, stock: 1 });
    expect(() => service.buy('shop_market', 'warm_bun', 3)).toThrowError(/库存不足/);
    expect(heldCount(runtime, 'warm_bun')).toBe(0);
    expect(runtime.state.player.wallet['town_silver']).toBe(1000);
  });

  it('无限库存（条目无 stock 且无 stockOf 读数）：可反复购买', () => {
    const { runtime, service } = makeWorld({ silver: 1000 });
    service.buy('shop_market', 'guard_coat', 1);
    service.buy('shop_market', 'guard_coat', 1);
    expect(heldCount(runtime, 'guard_coat')).toBe(2);
    expect(runtime.state.player.wallet['town_silver']).toBe(980);
  });

  it('数量非法（0 / 负 / 小数）→ 前置拒绝', () => {
    const { service } = makeWorld();
    for (const count of [0, -1, 1.5]) {
      expect(() => service.buy('shop_market', 'warm_bun', count), String(count)).toThrowError();
    }
  });
});

describe('17-S2 sell：出售与回购一致性（FR-ECON-03）', () => {
  it('成功：给钱 + 扣物 + trade 事件', () => {
    const { runtime, service } = makeWorld({
      silver: 0,
      bag: [{ itemId: 'warm_bun', count: 3 }],
    });
    const outcome = service.sell('shop_market', 'warm_bun', 2);
    expect(runtime.state.player.wallet['town_silver']).toBe(8); // 4 × 2
    expect(heldCount(runtime, 'warm_bun')).toBe(1);
    expect(outcome.events).toContainEqual(
      expect.objectContaining({ type: 'trade', mode: 'sell', count: 2, amount: 8 }),
    );
  });

  it('持有不足 → 前置拒绝（钱物不变）', () => {
    const { runtime, service } = makeWorld({ silver: 0, bag: [{ itemId: 'warm_bun', count: 1 }] });
    expect(() => service.sell('shop_market', 'warm_bun', 2)).toThrowError(/持有不足/);
    expect(heldCount(runtime, 'warm_bun')).toBe(1);
    expect(runtime.state.player.wallet['town_silver']).toBe(0);
  });

  it('回购一致性：同天同时段卖后买回，按卖价而非买价', () => {
    // 卖价 4、买价 10：回购应花 4
    const { runtime, service } = makeWorld({
      silver: 0,
      bag: [{ itemId: 'warm_bun', count: 2 }],
    });
    service.sell('shop_market', 'warm_bun', 1); // 钱包 4，背包 1
    service.buy('shop_market', 'warm_bun', 1); // 按回购价 4
    expect(runtime.state.player.wallet['town_silver']).toBe(0); // 4 − 4
    expect(heldCount(runtime, 'warm_bun')).toBe(2); // 1 + 1
  });

  it('跨时段回购登记失效：新时段（服务实例重建）按 priceBuy 成交', () => {
    const { runtime, service } = makeWorld({
      silver: 100,
      bag: [{ itemId: 'warm_bun', count: 2 }],
    });
    service.sell('shop_market', 'warm_bun', 1); // 钱包 104 + 登记（slot 0）
    // 跨时段 = 登记过期：以同一运行时重建服务（新实例无历史登记；真实宿主在
    // 时段推进后重建商店会话，语义等价）
    const nextSlotService = createShopService({
      runtime,
      state: () => runtime.state,
      shops: SHOPS,
      functionRegistry: createBuiltinFunctionRegistry(),
      rng: createRng(7),
      items: ITEMS,
    });
    nextSlotService.buy('shop_market', 'warm_bun', 1); // 按 priceBuy 10
    expect(runtime.state.player.wallet['town_silver']).toBe(94); // 104 − 10
  });

  it('回购登记一次性消费：买回后再次购买回归 priceBuy', () => {
    const { runtime, service } = makeWorld({
      silver: 100,
      bag: [{ itemId: 'warm_bun', count: 2 }],
    });
    service.sell('shop_market', 'warm_bun', 1); // 钱包 104，登记 4
    service.buy('shop_market', 'warm_bun', 1); // 按 4 回购 → 钱包 100
    expect(runtime.state.player.wallet['town_silver']).toBe(100);
    service.buy('shop_market', 'warm_bun', 1); // 再买：回归 10 → 钱包 90
    expect(runtime.state.player.wallet['town_silver']).toBe(90);
  });
});

describe('17-S2 交易后置效果（onTrade，FR-ECON-04）', () => {
  it('onTrade 效果与钱物同批执行（原子：交易成功才生效）', () => {
    const state = newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
        attrs: { hp: 30 },
      },
      createRng(1),
    );
    state.player.wallet['town_silver'] = 100;
    const runtime = new GameRuntime({
      state,
      rng: createRng(7),
      effectExecutor: createBuiltinEffectRegistry({
        items: ITEMS,
        functionRegistry: createBuiltinFunctionRegistry(),
      }),
    });
    const service = createShopService({
      runtime,
      state: () => runtime.state,
      shops: SHOPS,
      functionRegistry: createBuiltinFunctionRegistry(),
      rng: createRng(7),
      items: ITEMS,
      onTrade: () => [{ set: { key: 'flag.bought_bread', value: true } }],
    });
    service.buy('shop_market', 'warm_bun', 1);
    expect(runtime.state.world.flags['bought_bread']).toBe(true);
  });

  it('交易失败时 onTrade 效果一并回滚（同批原子）', () => {
    const state = newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
        attrs: { hp: 30 },
      },
      createRng(1),
    );
    state.player.wallet['town_silver'] = 1; // 买不起
    const runtime = new GameRuntime({
      state,
      rng: createRng(7),
      effectExecutor: createBuiltinEffectRegistry({
        items: ITEMS,
        functionRegistry: createBuiltinFunctionRegistry(),
      }),
    });
    const service = createShopService({
      runtime,
      state: () => runtime.state,
      shops: SHOPS,
      functionRegistry: createBuiltinFunctionRegistry(),
      rng: createRng(7),
      items: ITEMS,
      onTrade: () => [{ set: { key: 'flag.bought_bread', value: true } }],
    });
    expect(() => service.buy('shop_market', 'warm_bun', 1)).toThrowError();
    expect(runtime.state.world.flags['bought_bread']).toBeUndefined();
  });
});
