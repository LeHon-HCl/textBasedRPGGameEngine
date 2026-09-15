import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { areaDefSchema, attrDefsSchema, sceneDefSchema } from '../../src/index.js';
import type { AreaDef, AttrDefs, SceneDef } from '../../src/index.js';

describe('attrDefsSchema（设计 §2.4 AttrDefs 三形态，02 任务 A2）', () => {
  const VALID_ATTRS = {
    numeric: {
      hp: { min: 0, max: 100, init: 100, show: true },
      insight: { min: 0, max: 20, init: 0, show: true },
    },
    level: {
      renown: { levels: ['stats.renown.unknown', 'stats.renown.famed'], init: 0 },
    },
    derived: {
      max_carry: { formula: '20 + attr.stamina * 2' },
    },
  } as const;

  it('解析 numeric/level/derived 三形态并保留字段', () => {
    const parsed = attrDefsSchema.parse(VALID_ATTRS);
    expect(parsed.numeric.hp).toEqual({ min: 0, max: 100, init: 100, show: true });
    expect(parsed.level.renown?.levels).toHaveLength(2);
    expect(parsed.derived.max_carry?.formula).toBe('20 + attr.stamina * 2');
  });

  it('空域（level: {} / derived: {}）合法（fixtures/mini-game 形态）', () => {
    expect(() => attrDefsSchema.parse({ numeric: {}, level: {}, derived: {} })).not.toThrow();
  });

  it('z.infer 类型抽检', () => {
    expectTypeOf<AttrDefs['numeric']>().toEqualTypeOf<
      Record<string, { min: number; max: number; init: number; show: boolean }>
    >();
    expectTypeOf<AttrDefs['derived']>().toEqualTypeOf<Record<string, { formula: string }>>();
  });

  it('非法样例：numeric min > max（语义约束）', () => {
    expect(() =>
      attrDefsSchema.parse({
        ...VALID_ATTRS,
        numeric: { hp: { min: 100, max: 0, init: 50, show: true } },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：numeric init 越出 [min, max]（语义约束）', () => {
    expect(() =>
      attrDefsSchema.parse({
        ...VALID_ATTRS,
        numeric: { hp: { min: 0, max: 100, init: 120, show: true } },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：level init 越界 / levels 为空 / 等级名非文本键字符串', () => {
    expect(() =>
      attrDefsSchema.parse({
        ...VALID_ATTRS,
        level: { renown: { levels: ['a.stats'], init: 5 } },
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      attrDefsSchema.parse({ ...VALID_ATTRS, level: { renown: { levels: [], init: 0 } } }),
    ).toThrow(z.ZodError);
    expect(() =>
      attrDefsSchema.parse({
        ...VALID_ATTRS,
        level: { renown: { levels: [42], init: 0 } },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：属性名不符合 GameId 命名 / derived 缺 formula', () => {
    expect(() =>
      attrDefsSchema.parse({
        ...VALID_ATTRS,
        numeric: { 'Big-Hp': { min: 0, max: 1, init: 0, show: true } },
      }),
    ).toThrow(z.ZodError);
    expect(() => attrDefsSchema.parse({ ...VALID_ATTRS, derived: { x: {} } })).toThrow(z.ZodError);
  });
});

describe('sceneDefSchema（设计 §2.4 SceneDef，02 任务 A2）', () => {
  const VALID_SCENE = {
    id: 'market_street',
    area: 'old_town',
    segments: [
      { key: 'scenes.market_street.enter' },
      { key: 'scenes.market_street.stall', showIf: 'attr.insight > 0' },
    ],
    choices: [
      {
        id: 'listen_rumor',
        textKey: 'scenes.market_street.choice.listen_rumor',
        showIf: 'attr.insight > 0',
        effects: [{ flag: { name: 'heard_rumor' } }],
      },
      {
        id: 'back_arrival',
        textKey: 'scenes.market_street.choice.back_arrival',
        goto: 'arrival',
      },
    ],
    media: { bg: 'bg_market', bgm: 'bgm_market' },
    tags: ['general'],
  } as const;

  it('解析完整场景（segments/choices/effects/goto/media/tags）', () => {
    const parsed = sceneDefSchema.parse(VALID_SCENE);
    expect(parsed.choices[0]?.effects).toEqual([{ flag: { name: 'heard_rumor' } }]);
    expect(parsed.choices[1]?.goto).toBe('arrival');
    expect(parsed.media).toEqual({ bg: 'bg_market', bgm: 'bgm_market' });
  });

  it('entry.require 条件入口（FR-XPLR-04）可解析', () => {
    expect(() =>
      sceneDefSchema.parse({
        ...VALID_SCENE,
        entry: { require: 'attr.courage >= 3 || npc.raven.favor > 20' },
      }),
    ).not.toThrow();
  });

  it('置灰条件与一次性选项（FR-NARR-02）可解析', () => {
    expect(() =>
      sceneDefSchema.parse({
        ...VALID_SCENE,
        choices: [
          ...VALID_SCENE.choices,
          {
            id: 'inspect_wall',
            textKey: 'scenes.market_street.choice.inspect',
            disabledIf: 'attr.stamina < 1',
            disabledReasonKey: 'scenes.market_street.choice.inspect_disabled',
            once: true,
          },
        ],
      }),
    ).not.toThrow();
  });

  it('z.infer 类型抽检（goto 为 string 引用）', () => {
    expectTypeOf<SceneDef['area']>().toBeString();
    expectTypeOf<SceneDef['choices'][number]['goto']>().toEqualTypeOf<string | undefined>();
  });

  it('非法样例：未知键（如沿用旧字段名 next）被 strict 拒绝', () => {
    expect(() =>
      sceneDefSchema.parse({
        ...VALID_SCENE,
        choices: [{ id: 'x', textKey: 't.x', next: 'arrival' }],
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：缺 segments/choices、choice 缺 textKey、goto 非字符串', () => {
    expect(() => sceneDefSchema.parse({ id: 's', area: 'a' })).toThrow(z.ZodError);
    expect(() =>
      sceneDefSchema.parse({
        ...VALID_SCENE,
        choices: [{ id: 'x' }],
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      sceneDefSchema.parse({
        ...VALID_SCENE,
        choices: [{ id: 'x', textKey: 't.x', goto: 42 }],
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：scene.id 不符合 GameId 命名（DUP_ID 检测的数据前提）', () => {
    expect(() => sceneDefSchema.parse({ ...VALID_SCENE, id: 'Market-Street' })).toThrow(z.ZodError);
  });
});

describe('areaDefSchema（设计 §2.4 AreaDef，02 任务 A2）', () => {
  const VALID_AREA = {
    id: 'old_town',
    nameKey: 'areas.old_town.name',
    locations: {
      market: { nameKey: 'areas.old_town.market', moveCost: 1, mapPos: [120, 80] },
      gate: {
        nameKey: 'areas.old_town.gate',
        unlockIf: 'attr.insight >= 2',
        moveCost: 1,
        mapPos: [220, 60],
      },
    },
  } as const;

  it('解析区域与地点（nameKey/unlockIf/moveCost/mapPos）', () => {
    const parsed = areaDefSchema.parse(VALID_AREA);
    expect(parsed.locations.market?.moveCost).toBe(1);
    expect(parsed.locations.gate?.unlockIf).toBe('attr.insight >= 2');
    expect(parsed.locations.gate?.mapPos).toEqual([220, 60]);
  });

  it('z.infer 类型抽检（locations 为 GameId 键记录）', () => {
    expectTypeOf<AreaDef['locations']>().toEqualTypeOf<
      Record<
        string,
        {
          nameKey: string;
          unlockIf?: string | undefined;
          moveCost: number;
          mapPos: [number, number];
          entryScene?: string | undefined;
        }
      >
    >();
  });

  it('解析地点导航字段 entryScene（FR-XPLR-02 地图导航）', () => {
    const parsed = areaDefSchema.parse({
      ...VALID_AREA,
      locations: {
        market: {
          nameKey: 'areas.old_town.market',
          moveCost: 1,
          mapPos: [120, 80],
          entryScene: 'market_street',
        },
      },
    });
    expect(parsed.locations.market?.entryScene).toBe('market_street');
    // 可选：省略时 undefined（加载器按「本区域恰一个非事件场景」推导）
    const withoutEntry = areaDefSchema.parse(VALID_AREA);
    expect(withoutEntry.locations.market?.entryScene).toBeUndefined();
  });

  it('非法样例：location 缺 mapPos / moveCost 为负 / mapPos 非二元数值', () => {
    expect(() =>
      areaDefSchema.parse({
        ...VALID_AREA,
        locations: { market: { nameKey: 'a', moveCost: 1 } },
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      areaDefSchema.parse({
        ...VALID_AREA,
        locations: { market: { nameKey: 'a', moveCost: -1, mapPos: [0, 0] } },
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      areaDefSchema.parse({
        ...VALID_AREA,
        locations: { market: { nameKey: 'a', moveCost: 1, mapPos: [1, 2, 3] } },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：location 名不符 GameId / 区域缺 locations', () => {
    expect(() =>
      areaDefSchema.parse({
        ...VALID_AREA,
        locations: { 'Main Market': { nameKey: 'a', moveCost: 1, mapPos: [0, 0] } },
      }),
    ).toThrow(z.ZodError);
    expect(() => areaDefSchema.parse({ id: 'old_town', nameKey: 'a.n' })).toThrow(z.ZodError);
  });
});
