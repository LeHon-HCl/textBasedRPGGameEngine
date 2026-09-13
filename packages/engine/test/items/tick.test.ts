import { describe, expect, it } from 'vitest';
import type { ItemDef } from '@game/shared';
import { BASE_VERSIONS, makeBuiltinRuntime, makeCtx } from '../effects/fixtures.js';
import { DEFAULT_TIME_CONFIG, TimePipeline } from '../../src/time/index.js';
import { createItemTickProvider } from '../../src/items/tick.js';

/**
 * 13 任务 5：耐久/时效 tick（FR-ITEM-06，§4.7「管线步骤 2/3 tick」）。
 *
 * 口径（内部指令 __items.tick，挂时间管线步骤 2 statusTick 槽位）：
 * - expiresAfterSlots（过期·时段）：穿着期间累计 wornSlots，达到即 emit
 *   item_expired{reason:'expired'} 并清除元数据（只报一次）；
 * - durability（耐久·日磨损）：每跨天 -1，归零 emit item_expired{reason:
 *   'durability'} 并清除元数据；garment 未声明两字段的物品不受 tick 影响；
 * - 引擎不自动脱下过期衣物——后果由作者经事件订阅决定（FR-ITEM-06）。
 */

const TICK_ITEMS: ReadonlyMap<string, ItemDef> = new Map(
  (
    [
      {
        id: 'item_perishable',
        nameKey: 'items.perishable.name',
        type: 'garment',
        garment: { part: 'head', layer: 1, expiresAfterSlots: 4 },
      },
      {
        id: 'item_fragile',
        nameKey: 'items.fragile.name',
        type: 'garment',
        garment: { part: 'chest', layer: 1, durability: 2 },
      },
      {
        id: 'item_eternal',
        nameKey: 'items.eternal.name',
        type: 'garment',
        garment: { part: 'chest', layer: 2 },
      },
    ] as ItemDef[]
  ).map((def) => [def.id, def]),
);

/** 运行时 + 挂了物品 tick 的时间管线（4 时段缺省日历） */
function makeTickRuntime(
  bag: NonNullable<NonNullable<Parameters<typeof makeBuiltinRuntime>[0]>['bootstrap']>['bag'],
) {
  const { rt } = makeBuiltinRuntime({
    bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 30 }, bag },
    registryOptions: { items: TICK_ITEMS, timeConfig: DEFAULT_TIME_CONFIG },
  });
  const pipeline = new TimePipeline({
    runtime: rt,
    config: DEFAULT_TIME_CONFIG,
    statusTick: createItemTickProvider(),
  });
  return { rt, pipeline };
}

describe('13-5 耐久/时效 tick 挂管线', () => {
  it('expiresAfterSlots：累计穿着时段达阈值 → item_expired{expired}，只报一次', () => {
    const { rt, pipeline } = makeTickRuntime([{ itemId: 'item_perishable', count: 1 }]);
    rt.exec([{ wear: { item: 'item_perishable' } }], makeCtx());
    expect(rt.state.player.wornMeta['item_perishable']).toEqual({ wornSlots: 0 });
    const events = [];
    for (let i = 0; i < 2; i++) events.push(...pipeline.advance(2).events);
    expect(events).toEqual([{ type: 'item_expired', item: 'item_perishable', reason: 'expired' }]);
    // 元数据已清除：后续推进不再重复报
    expect(pipeline.advance(4).events).toEqual([]);
  });

  it('durability：每跨天 -1，归零 → item_expired{durability}', () => {
    const { rt, pipeline } = makeTickRuntime([{ itemId: 'item_fragile', count: 1 }]);
    rt.exec([{ wear: { item: 'item_fragile' } }], makeCtx());
    // 第 1 天内推进 3 时段：不跨天，耐久不动
    expect(pipeline.advance(3).events).toEqual([]);
    expect(rt.state.player.wornMeta['item_fragile']).toEqual({ wornSlots: 3, durability: 2 });
    // 跨第 2 天：耐久 2→1
    expect(pipeline.advance(1).events).toEqual([]);
    expect(rt.state.player.wornMeta['item_fragile']?.durability).toBe(1);
    // 跨第 3 天：耐久归零 → 过期事件
    expect(pipeline.advance(4).events).toEqual([
      { type: 'item_expired', item: 'item_fragile', reason: 'durability' },
    ]);
  });

  it('未声明两字段的 garment 不受 tick 影响', () => {
    const { rt, pipeline } = makeTickRuntime([{ itemId: 'item_eternal', count: 1 }]);
    rt.exec([{ wear: { item: 'item_eternal' } }], makeCtx());
    expect(pipeline.advance(12).events).toEqual([]);
    expect(rt.state.player.wornMeta['item_eternal']).toEqual({ wornSlots: 12 });
  });

  it('remove 后元数据同步清除；再穿戴重新计时', () => {
    const { rt, pipeline } = makeTickRuntime([{ itemId: 'item_perishable', count: 1 }]);
    rt.exec([{ wear: { item: 'item_perishable' } }], makeCtx());
    pipeline.advance(2);
    rt.exec([{ remove: { item: 'item_perishable' } }], makeCtx());
    expect(rt.state.player.wornMeta['item_perishable']).toBeUndefined();
    rt.exec([{ wear: { item: 'item_perishable' } }], makeCtx());
    expect(rt.state.player.wornMeta['item_perishable']).toEqual({ wornSlots: 0 });
    expect(pipeline.advance(2).events).toEqual([]);
    expect(pipeline.advance(2).events).toEqual([
      { type: 'item_expired', item: 'item_perishable', reason: 'expired' },
    ]);
  });
});
