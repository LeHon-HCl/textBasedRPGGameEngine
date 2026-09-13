import { describe, expect, it } from 'vitest';
import type { ItemDef } from '@game/shared';
import { BASE_VERSIONS, makeBuiltinRuntime, makeCtx } from '../effects/fixtures.js';
import { equipModDetails } from '../../src/items/equip.js';

/**
 * 13 任务 2：装备栏 equipMods 并入派生属性重算（§4.7，FR-ITEM-03/FR-STAT-03）。
 *
 * 口径：装备修正 =「基础值（numeric 或派生公式值）+ Σ 已穿/已装备物品的
 * equipMods[attr] 表达式值」，结果写入 player.derived[attr]（求值作用域
 * attrs 域 = {...attrs, ...derived}，修正对表达式与面板统一可见）。
 * equipModDetails 为面板修正明细的纯函数投影（每栏位每物品的已解析修正值）。
 */

/** 装备目录夹具：weapon 修正派生 max_hp 与数值 hp；finger 修正 hp */
const EQUIP_ITEMS: ReadonlyMap<string, ItemDef> = new Map(
  (
    [
      {
        id: 'item_sword',
        nameKey: 'items.sword.name',
        type: 'equip',
        equipSlot: 'weapon',
        equipMods: { max_hp: '5', hp: '2' },
      },
      {
        id: 'item_ring',
        nameKey: 'items.ring.name',
        type: 'equip',
        equipSlot: 'finger',
        equipMods: { hp: 'attr.con' },
      },
      { id: 'item_plain', nameKey: 'items.plain.name', type: 'equip', equipSlot: 'weapon' },
    ] as ItemDef[]
  ).map((def) => [def.id, def]),
);

/** 运行时 attrDefs：派生 max_hp = 10 + con*3（运行时重算依据） */
const ATTR_DEFS = {
  numeric: {},
  level: {},
  derived: { max_hp: { formula: '10 + attr.con * 3' } },
};

/** 运行时夹具：派生 max_hp = 10 + con*3（con=2 → 16），hp=30 */
function makeEquipRuntime(bag: NonNullable<NonNullable<Parameters<typeof makeBuiltinRuntime>[0]>['bootstrap']>['bag']) {
  return makeBuiltinRuntime({
    bootstrap: {
      versions: BASE_VERSIONS,
      attrs: { hp: 30, con: 2 },
      derivedFormulas: { max_hp: '10 + attr.con * 3' },
      bag,
    },
    registryOptions: { items: EQUIP_ITEMS },
    itemDefs: EQUIP_ITEMS,
    attrDefs: ATTR_DEFS,
  });
}

describe('13-2 equipMods 并入派生属性重算', () => {
  it('装备修正叠加在派生公式值之上（max_hp 16 → 21），卸下还原', () => {
    const { rt } = makeEquipRuntime([{ itemId: 'item_sword', count: 1 }]);
    expect(rt.state.player.derived['max_hp']).toBe(16);
    rt.exec([{ equip: { item: 'item_sword' } }], makeCtx());
    expect(rt.state.player.derived['max_hp']).toBe(21);
    rt.exec([{ unequip: { slot: 'weapon' } }], makeCtx());
    expect(rt.state.player.derived['max_hp']).toBe(16);
  });

  it('装备修正作用于数值属性：derived[hp] = 基础 30 + Σ修正（表达式可读 attr.hp）', () => {
    const { rt } = makeEquipRuntime([{ itemId: 'item_sword', count: 1 }]);
    rt.exec([{ equip: { item: 'item_sword' } }], makeCtx());
    expect(rt.state.player.derived['hp']).toBe(32);
  });

  it('多装备同属性修正叠加；修正表达式可引用作用域（attr.con）', () => {
    const { rt } = makeEquipRuntime([
      { itemId: 'item_sword', count: 1 },
      { itemId: 'item_ring', count: 1 },
    ]);
    rt.exec(
      [{ equip: { item: 'item_sword' } }, { equip: { item: 'item_ring' } }],
      makeCtx(),
    );
    expect(rt.state.player.derived['hp']).toBe(34); // 30 + 2(sword) + 2(con)
  });

  it('wear 服装同样触发修正重算（outfit 域在触发域清单中）', () => {
    const garmentItems: ReadonlyMap<string, ItemDef> = new Map(
      (
        [
          {
            id: 'item_coat',
            nameKey: 'items.coat.name',
            type: 'garment',
            garment: { part: 'chest', layer: 2 },
            equipMods: { max_hp: '3' },
          },
        ] as ItemDef[]
      ).map((def) => [def.id, def]),
    );
    const { rt } = makeBuiltinRuntime({
      bootstrap: {
        versions: BASE_VERSIONS,
        attrs: { hp: 30, con: 2 },
        derivedFormulas: { max_hp: '10 + attr.con * 3' },
        bag: [{ itemId: 'item_coat', count: 1 }],
      },
      registryOptions: { items: garmentItems },
      itemDefs: garmentItems,
      attrDefs: ATTR_DEFS,
    });
    expect(rt.state.player.derived['max_hp']).toBe(16);
    rt.exec([{ wear: { item: 'item_coat' } }], makeCtx());
    expect(rt.state.player.derived['max_hp']).toBe(19);
  });

  it('修正明细投影：equipModDetails 列出栏位/物品/已解析修正值（FR-STAT-03 面板）', () => {
    const { rt } = makeEquipRuntime([
      { itemId: 'item_sword', count: 1 },
      { itemId: 'item_ring', count: 1 },
    ]);
    rt.exec(
      [{ equip: { item: 'item_sword' } }, { equip: { item: 'item_ring' } }],
      makeCtx(),
    );
    const details = equipModDetails(rt.state, EQUIP_ITEMS);
    expect(details).toEqual([
      { slot: 'weapon', itemId: 'item_sword', mods: { max_hp: 5, hp: 2 } },
      { slot: 'finger', itemId: 'item_ring', mods: { hp: 2 } },
    ]);
  });

  it('无装备修正时 recomputeDerived 行为不变（无派生定义 = 无操作）', () => {
    const { rt } = makeBuiltinRuntime({
      bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 30 } },
      registryOptions: { items: EQUIP_ITEMS },
      itemDefs: EQUIP_ITEMS,
    });
    expect(rt.state.player.derived).toEqual({});
  });
});
