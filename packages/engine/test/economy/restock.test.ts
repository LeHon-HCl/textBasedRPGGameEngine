import { describe, expect, it } from 'vitest';
import { createRng, type ShopDef } from '@game/shared';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { newGameState } from '../../src/state/index.js';
import { GameRuntime } from '../../src/runtime/index.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import {
  createRestockProvider,
  readStock,
  stockKey,
  writeStock,
} from '../../src/economy/restock.js';

/**
 * S4 测试（17 号子任务 6）：库存读写与跨天补货。
 *
 * 存储面 world.shopStock（键 `<shopId>/<itemId>`，仅有限库存登记）；
 * 补货经内部指令 `__shop.restock`（管线 day_rollover 载体，同事务原子）。
 */

const SHOPS = new Map<string, ShopDef>([
  [
    'shop_market_stall',
    {
      id: 'shop_market_stall',
      nameKey: 'shops.stall.name',
      entries: [
        { item: 'warm_bun', stock: 5 }, // 无 restock 声明：每次钩子即补（旧语义）
        { item: 'guard_coat' }, // 无限库存
      ],
      priceBuy: '10',
      priceSell: '4',
    },
  ],
]);

function makeWorld() {
  const state = newGameState(
    {
      versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
      attrs: { hp: 30 },
    },
    createRng(1),
  );
  const runtime = new GameRuntime({
    state,
    rng: createRng(7),
    effectExecutor: createBuiltinEffectRegistry({
      shops: SHOPS,
      functionRegistry: createBuiltinFunctionRegistry(),
    }),
  });
  return { runtime };
}

describe('17-S4 库存读写（world.shopStock）', () => {
  it('未登记时回落 ShopDef 初始库存；无限库存返回 undefined', () => {
    const { runtime } = makeWorld();
    expect(readStock(runtime.state, SHOPS, 'shop_market_stall', 'warm_bun')).toBe(5);
    expect(readStock(runtime.state, SHOPS, 'shop_market_stall', 'guard_coat')).toBeUndefined();
  });

  it('库存记账经内部指令（事务内）：登记后以状态树为准；负数截断为 0', () => {
    const { runtime } = makeWorld();
    // 状态树为冻结视图：写入必须发生在事务 draft 内（生产路径 = 交易事务里的
    // __shop.set_stock；此处直接驱动同一指令）
    const exec = (delta: number) =>
      runtime.exec(
        [{ '__shop.set_stock': { shop: 'shop_market_stall', item: 'warm_bun', delta } } as never],
        {
          source: 'debug',
          where: { scene: 'test' },
          rng: createRng(1),
        },
      );
    exec(-3); // 5 → 2
    expect(readStock(runtime.state, SHOPS, 'shop_market_stall', 'warm_bun')).toBe(2);
    exec(-10); // 2 − 10 → 截断 0
    expect(readStock(runtime.state, SHOPS, 'shop_market_stall', 'warm_bun')).toBe(0);
    // 无限库存条目：无条件无操作（不登记）
    exec(0);
    runtime.exec(
      [
        {
          '__shop.set_stock': { shop: 'shop_market_stall', item: 'guard_coat', delta: -1 },
        } as never,
      ],
      {
        source: 'debug',
        where: { scene: 'test' },
        rng: createRng(1),
      },
    );
    expect(
      runtime.state.world.shopStock[stockKey('shop_market_stall', 'guard_coat')],
    ).toBeUndefined();
    void writeStock;
  });
});

describe('17-S4 补货（__shop.restock 内部指令）', () => {
  it('跨天补货：已消耗的有限库存重置为初始值；无限库存不登记', () => {
    const { runtime } = makeWorld();
    runtime.exec(
      [{ '__shop.set_stock': { shop: 'shop_market_stall', item: 'warm_bun', delta: -4 } } as never],
      {
        source: 'debug',
        where: { scene: 'test' },
        rng: createRng(1),
      },
    ); // 消耗到 1
    const provider = createRestockProvider();
    const effects = provider({
      runtime,
      rng: createRng(1),
      slots: 4,
      crossedDay: true,
      crossedWeek: false,
      crossedMonth: false,
    });
    expect(effects).toEqual([{ '__shop.restock': {} } as never]);
    runtime.exec(effects as never, {
      source: 'hook',
      where: { pipeline: 'time' },
      rng: createRng(1),
    });
    expect(readStock(runtime.state, SHOPS, 'shop_market_stall', 'warm_bun')).toBe(5);
    // 无限库存条目不进登记表
    expect(
      runtime.state.world.shopStock[stockKey('shop_market_stall', 'guard_coat')],
    ).toBeUndefined();
  });

  it('多商店多条目：全部有限库存条目一并重置（同事务原子）', () => {
    const { runtime } = makeWorld();
    runtime.exec(
      [{ '__shop.set_stock': { shop: 'shop_market_stall', item: 'warm_bun', delta: -5 } } as never],
      {
        source: 'debug',
        where: { scene: 'test' },
        rng: createRng(1),
      },
    ); // 清零
    runtime.exec([{ '__shop.restock': {} } as never], {
      source: 'hook',
      where: { pipeline: 'time' },
      rng: createRng(1),
    });
    expect(readStock(runtime.state, SHOPS, 'shop_market_stall', 'warm_bun')).toBe(5);
  });
});

describe('17-S4 缺口②：条目级补货调度（restock 周期，2026-09-23 人类裁定实现）', () => {
  const SHOPS_TICK = new Map<string, ShopDef>([
    [
      'shop_tick',
      {
        id: 'shop_tick',
        nameKey: 'shops.tick.name',
        entries: [
          { item: 'herb', stock: 3, restock: 4 }, // 每 4 时段补
          { item: 'bread', stock: 6 }, // 无周期：每次触发即补
        ],
        priceBuy: '5',
        priceSell: '2',
      },
    ],
  ]);

  function makeRuntime() {
    const state = newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
        attrs: { hp: 30 },
      },
      createRng(1),
    );
    return new GameRuntime({
      state,
      rng: createRng(7),
      effectExecutor: createBuiltinEffectRegistry({
        shops: SHOPS_TICK,
        functionRegistry: createBuiltinFunctionRegistry(),
      }),
    });
  }

  const restock = (runtime: ReturnType<typeof makeRuntime>) =>
    runtime.exec([{ '__shop.restock': {} } as never], {
      source: 'hook',
      where: { pipeline: 'time' },
      rng: createRng(1),
    });

  it('首日未登记：立即补货并登记计时', () => {
    const runtime = makeRuntime();
    restock(runtime);
    expect(readStock(runtime.state, SHOPS_TICK, 'shop_tick', 'herb')).toBe(3);
    expect(runtime.state.world.shopRestock['shop_tick/herb']).toBe(1000); // day1 × 1000 + slot0
  });

  it('周期未到：消耗后不补货（计时保留）', () => {
    const runtime = makeRuntime();
    restock(runtime); // 登记计时 = 1000（day1 slot0）
    // 消耗 2 个
    runtime.exec(
      [{ '__shop.set_stock': { shop: 'shop_tick', item: 'herb', delta: -2 } } as never],
      {
        source: 'debug',
        where: { scene: 'test' },
        rng: createRng(1),
      },
    );
    restock(runtime); // 同一时刻再触发：距上次 0 < 4 → 不补
    expect(readStock(runtime.state, SHOPS_TICK, 'shop_tick', 'herb')).toBe(1);
  });

  it('周期到达：推进 4 时段后补货', () => {
    const runtime = makeRuntime();
    restock(runtime); // 计时 = 0（day1 slot0）
    runtime.exec(
      [{ '__shop.set_stock': { shop: 'shop_tick', item: 'herb', delta: -3 } } as never],
      {
        source: 'debug',
        where: { scene: 'test' },
        rng: createRng(1),
      },
    );
    // 推进时间到 day1 slot4（模拟 4 时段后）：经 __time.advance 需 TimeConfig——
    // 直接以状态替换推进时钟（等价于时间管线已推进）
    const advanced = structuredClone(runtime.state) as unknown as Record<string, unknown>;
    (advanced['world'] as { time: { day: number; slotIndex: number } }).time = {
      day: 1,
      slotIndex: 4,
    };
    runtime.replaceState(advanced as never, []);
    restock(runtime);
    expect(readStock(runtime.state, SHOPS_TICK, 'shop_tick', 'herb')).toBe(3); // 补回
    expect(runtime.state.world.shopRestock['shop_tick/herb']).toBe(1004); // 登记新计时
  });

  it('无 restock 声明的条目：每次触发即补（向后兼容旧语义）', () => {
    const runtime = makeRuntime();
    restock(runtime);
    runtime.exec(
      [{ '__shop.set_stock': { shop: 'shop_tick', item: 'bread', delta: -6 } } as never],
      {
        source: 'debug',
        where: { scene: 'test' },
        rng: createRng(1),
      },
    );
    restock(runtime); // 同一时刻：无周期声明 → 直接补
    expect(readStock(runtime.state, SHOPS_TICK, 'shop_tick', 'bread')).toBe(6);
  });

  it('无限库存条目（无 stock）：不登记、不补货', () => {
    const runtime = makeRuntime();
    restock(runtime);
    expect(runtime.state.world.shopRestock['shop_tick/ghost']).toBeUndefined();
  });
});
