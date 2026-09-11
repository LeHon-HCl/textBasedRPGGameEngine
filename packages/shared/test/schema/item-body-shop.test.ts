import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { bodyDefSchema, itemDefSchema, shopDefSchema } from '../../src/index.js';
import type { BodyDef, ItemDef, ShopDef } from '../../src/index.js';

describe('itemDefSchema（设计 §2.4 ItemDef，02 任务 B1）', () => {
  const VALID_BUN = {
    id: 'warm_bun',
    nameKey: 'items.warm_bun.name',
    descKey: 'items.warm_bun.desc',
    type: 'consumable',
    stack: 5,
    useEffect: { effects: [{ add: { key: 'attr.hp', amount: 10 } }] },
    price: 5,
  } as const;

  const VALID_COAT = {
    id: 'guard_coat',
    nameKey: 'items.guard_coat.name',
    type: 'garment',
    garment: { part: 'torso', layer: 2, coverage: 80 },
    price: 12,
  } as const;

  it('解析消耗品（stack/useEffect/price）', () => {
    const parsed = itemDefSchema.parse(VALID_BUN);
    expect(parsed.stack).toBe(5);
    expect(parsed.useEffect?.effects).toEqual([{ add: { key: 'attr.hp', amount: 10 } }]);
  });

  it('解析服装（garment part/layer/coverage，FR-ITEM-04）', () => {
    const parsed = itemDefSchema.parse(VALID_COAT);
    expect(parsed.garment).toEqual({ part: 'torso', layer: 2, coverage: 80 });
  });

  it('解析装备（equipSlot）与关键道具（key 分区标记）', () => {
    expect(() =>
      itemDefSchema.parse({
        id: 'rusted_sword',
        nameKey: 'items.rusted_sword.name',
        type: 'equip',
        equipSlot: 'weapon',
        icon: 'icon_sword',
      }),
    ).not.toThrow();
    expect(() =>
      itemDefSchema.parse({
        id: 'old_seal',
        nameKey: 'items.old_seal.name',
        type: 'normal',
        key: true,
      }),
    ).not.toThrow();
  });

  it('z.infer 类型抽检', () => {
    expectTypeOf<ItemDef['type']>().toEqualTypeOf<'normal' | 'consumable' | 'equip' | 'garment'>();
    expectTypeOf<ItemDef['garment']>().toMatchTypeOf<{ part: string; layer: number } | undefined>();
  });

  it('非法样例：layer 越界（§4.7 层级 1 内 2 中 3 外）', () => {
    expect(() =>
      itemDefSchema.parse({
        ...VALID_COAT,
        garment: { part: 'torso', layer: 4 },
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      itemDefSchema.parse({
        ...VALID_COAT,
        garment: { part: 'torso', layer: 0 },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：type=equip 缺 equipSlot / type=garment 缺 garment（语义约束）', () => {
    expect(() => itemDefSchema.parse({ id: 'sword', nameKey: 'i.s.n', type: 'equip' })).toThrow(
      z.ZodError,
    );
    expect(() => itemDefSchema.parse({ id: 'hat', nameKey: 'i.h.n', type: 'garment' })).toThrow(
      z.ZodError,
    );
  });

  it('非法样例：type 越界枚举 / stack 非正 / price 为负 / 未知键', () => {
    expect(() => itemDefSchema.parse({ ...VALID_BUN, type: 'quest' })).toThrow(z.ZodError);
    expect(() => itemDefSchema.parse({ ...VALID_BUN, stack: 0 })).toThrow(z.ZodError);
    expect(() => itemDefSchema.parse({ ...VALID_BUN, price: -1 })).toThrow(z.ZodError);
    expect(() => itemDefSchema.parse({ ...VALID_BUN, stack_max: 3 })).toThrow(z.ZodError);
  });
});

describe('bodyDefSchema（设计 §2.4 BodyDef，02 任务 B1）', () => {
  const VALID_BODY = {
    parts: {
      ears: { values: ['normal', 'pointed'], default: 'normal' },
    },
    pronouns: {
      rule: 'by_part',
      part: 'ears',
      map: { normal: ['他', '她'], pointed: ['她', '她'] },
    },
  } as const;

  it('解析部位模板与代词规则（FR-BODY-01/04）', () => {
    const parsed = bodyDefSchema.parse(VALID_BODY);
    expect(parsed.parts.ears?.values).toEqual(['normal', 'pointed']);
    expect(parsed.pronouns?.map.pointed).toEqual(['她', '她']);
  });

  it('无代词规则的最简身体模板合法', () => {
    expect(() =>
      bodyDefSchema.parse({ parts: { ears: { values: ['x'], default: 'x' } } }),
    ).not.toThrow();
  });

  it('z.infer 类型抽检', () => {
    expectTypeOf<BodyDef['parts']>().toMatchTypeOf<Record<string, object>>();
  });

  it('非法样例：default 不在 values 内（语义约束）', () => {
    expect(() =>
      bodyDefSchema.parse({
        parts: { ears: { values: ['normal', 'pointed'], default: 'furry' } },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：values 为空 / pronouns rule 越界 / map 值为空数组', () => {
    expect(() => bodyDefSchema.parse({ parts: { ears: { values: [], default: 'x' } } })).toThrow(
      z.ZodError,
    );
    expect(() =>
      bodyDefSchema.parse({
        ...VALID_BODY,
        pronouns: { ...VALID_BODY.pronouns, rule: 'by_height' },
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      bodyDefSchema.parse({
        ...VALID_BODY,
        pronouns: { ...VALID_BODY.pronouns, map: { normal: [] } },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：部位名不符合 GameId 命名（set_body 校验的数据前提）', () => {
    expect(() =>
      bodyDefSchema.parse({
        parts: { 'Long Ears': { values: ['x'], default: 'x' } },
      }),
    ).toThrow(z.ZodError);
  });
});

describe('shopDefSchema（设计 §2.4 ShopDef，02 任务 B1）', () => {
  const VALID_SHOP = {
    id: 'market_stall',
    nameKey: 'shops.market_stall.name',
    entries: [
      { item: 'warm_bun', stock: 5, restock: 2 },
      { item: 'guard_coat', showIf: 'faction.town >= 0' },
    ],
    priceBuy: 'faction.town >= 10 ? 8 : 10',
    priceSell: '4',
    currency: 'town_silver',
  } as const;

  it('解析商店（entries/定价表达式/库存补货/货币）', () => {
    const parsed = shopDefSchema.parse(VALID_SHOP);
    expect(parsed.entries[0]).toEqual({ item: 'warm_bun', stock: 5, restock: 2 });
    expect(parsed.priceBuy).toBe('faction.town >= 10 ? 8 : 10');
    expect(parsed.currency).toBe('town_silver');
  });

  it('非法样例：entries 为空 / 缺 priceSell / stock 为负 / 未知键', () => {
    expect(() => shopDefSchema.parse({ ...VALID_SHOP, entries: [] })).toThrow(z.ZodError);
    const withoutSell = structuredClone(VALID_SHOP) as Record<string, unknown>;
    delete withoutSell.priceSell;
    expect(() => shopDefSchema.parse(withoutSell)).toThrow(z.ZodError);
    expect(() =>
      shopDefSchema.parse({
        ...VALID_SHOP,
        entries: [{ item: 'warm_bun', stock: -1 }],
      }),
    ).toThrow(z.ZodError);
    expect(() => shopDefSchema.parse({ ...VALID_SHOP, price_buy: '5' })).toThrow(z.ZodError);
  });

  it('非法样例：entry 缺 item 引用', () => {
    expect(() => shopDefSchema.parse({ ...VALID_SHOP, entries: [{ stock: 3 }] })).toThrow(
      z.ZodError,
    );
  });

  it('z.infer 类型抽检（entry.item 为物品引用）', () => {
    expectTypeOf<ShopDef['entries'][number]['item']>().toBeString();
    expectTypeOf<ShopDef['priceBuy']>().toBeString();
  });
});
