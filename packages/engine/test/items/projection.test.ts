import { describe, expect, it } from 'vitest';
import type { ItemDef } from '@game/shared';
import { projectBag } from '../../src/items/projection.js';

/**
 * 13 任务 6：背包 UI 数据投影（FR-ITEM-02）。
 *
 * 纯函数层：bag + 物品目录 → 视图（关键道具分区 / 按种类聚合 / 排序 / 搜索）。
 * UI 框架无关（runtime-ui 消费的唯一数据源口径）。
 */

const CATALOG: ReadonlyMap<string, ItemDef> = new Map(
  (
    [
      { id: 'item_herb', nameKey: 'items.herb.name', type: 'normal', stack: 9 },
      { id: 'item_bun', nameKey: 'items.bun.name', type: 'consumable', stack: 5 },
      { id: 'item_sword', nameKey: 'items.sword.name', type: 'equip', equipSlot: 'weapon' },
      { id: 'item_ring', nameKey: 'items.ring.name', type: 'equip', equipSlot: 'finger' },
      {
        id: 'item_amulet',
        nameKey: 'items.amulet.name',
        type: 'normal',
        key: true,
      },
    ] as ItemDef[]
  ).map((def) => [def.id, def]),
);

describe('13-6 projectBag：分类 / 聚合 / 排序 / 搜索', () => {
  it('按种类聚合计数；关键道具独立分区（FR-ITEM-02）', () => {
    const bag = [
      { itemId: 'item_herb', count: 5 },
      { itemId: 'item_herb', count: 3 },
      { itemId: 'item_sword', count: 1 },
      { itemId: 'item_amulet', count: 1 },
    ];
    const view = projectBag(bag, CATALOG);
    expect(view.normalItems.map((e) => [e.itemId, e.count])).toEqual([
      ['item_herb', 8],
      ['item_sword', 1],
    ]);
    expect(view.keyItems.map((e) => e.itemId)).toEqual(['item_amulet']);
    expect(view.capacityUsed).toBe(4);
    expect(view.capacityLimit).toBeUndefined();
  });

  it('排序：count 降序 / id 字典序（缺省目录声明序）', () => {
    const bag = [
      { itemId: 'item_bun', count: 2 },
      { itemId: 'item_herb', count: 9 },
    ];
    expect(projectBag(bag, CATALOG, { sort: 'count' }).normalItems.map((e) => e.itemId)).toEqual([
      'item_herb',
      'item_bun',
    ]);
    expect(projectBag(bag, CATALOG, { sort: 'id' }).normalItems.map((e) => e.itemId)).toEqual([
      'item_bun',
      'item_herb',
    ]);
  });

  it('搜索：itemId 与本地化名称双口径（nameOf 注入，FR-ITEM-02）', () => {
    const bag = [
      { itemId: 'item_herb', count: 1 },
      { itemId: 'item_sword', count: 1 },
    ];
    const nameOf = (id: string) => (id === 'item_sword' ? '铁剑' : id);
    expect(projectBag(bag, CATALOG, { query: '剑', nameOf }).normalItems).toEqual([
      {
        itemId: 'item_sword',
        count: 1,
        type: 'equip',
        nameKey: 'items.sword.name',
        stack: undefined,
        key: false,
      },
    ]);
    expect(projectBag(bag, CATALOG, { query: 'item_herb', nameOf }).normalItems).toHaveLength(1);
    expect(projectBag(bag, CATALOG, { query: '不存在', nameOf }).normalItems).toEqual([]);
  });

  it('容量信息：capacity 透传为 capacityLimit，used = 原始条目数', () => {
    const bag = [
      { itemId: 'item_herb', count: 9 },
      { itemId: 'item_herb', count: 2 },
    ];
    const view = projectBag(bag, CATALOG, { capacity: 10 });
    expect(view.capacityUsed).toBe(2);
    expect(view.capacityLimit).toBe(10);
  });
});
