import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { effectDataSchema, effectParamSchemas, effectSchemas } from '../../src/index.js';
import type { EffectData } from '../../src/index.js';

/**
 * 25 个内置指令各 1 条最小正例（§3.3 注册表清单顺序），外加
 * 结构/递归/引用元数据的负例与抽检。参数级校验归 05 号注册表，
 * 本层只守护「指令键 + 宽松参数结构 + refId 元数据」。
 */
const SAMPLES: readonly EffectData[] = [
  { set: { key: 'attr.hp', value: 'attr.hp + 10' } },
  { add: { key: 'attr.insight', amount: 2 } },
  { flag: { name: 'heard_rumor' } },
  { money: { town_silver: '20 + rand(0,10)' } },
  { give: { item: 'warm_bun', count: 2 } },
  { take: { item: 'warm_bun' } },
  { equip: { item: 'guard_coat' } },
  { unequip: { slot: 'weapon' } },
  { wear: { item: 'guard_coat' } },
  { remove: { item: 'guard_coat' } },
  { set_body: { part: 'ears', value: 'pointed' } },
  { favor: { npc: 'old_guard', amount: 15 } },
  { reputation: { faction: 'town', amount: -5 } },
  { advance_time: { cost: 1 } },
  { quest: { id: 'wall_rubbing', action: 'advance' } },
  {
    check: {
      rule: 'coc',
      value: 'skill.brawl',
      difficulty: 'hard',
      bonusDice: 1,
      onSuccess: [{ goto: 'tavern_win' }],
      onFail: [{ goto: 'tavern_lose' }],
    },
  },
  {
    battle: {
      encounter: 'street_thug',
      onVictory: [{ money: { town_silver: 30 } }, { goto: 'market_street' }],
      onDefeat: [{ goto: 'alley_wake' }],
    },
  },
  { goto: 'town_gate' },
  { back: null },
  { ending: 'quiet_town' },
  { loop_transition: null },
  { unlock: { kind: 'gallery', id: 'arrival' } },
  { media: { type: 'bgm', assetId: 'bgm_rain' } },
  { notify: { textKey: 'ui.toast.levelup', vars: { level: 3 } } },
  { call: { fn: 'x.festival.calendar', with: { day: 'time.day' } } },
];

describe('effectDataSchema（设计 §3.3 内置指令联合，02 任务 A2）', () => {
  it('25 个内置指令键各有参数 schema 且与设计清单一致', () => {
    expect(Object.keys(effectParamSchemas)).toEqual([
      'set',
      'add',
      'flag',
      'money',
      'give',
      'take',
      'equip',
      'unequip',
      'wear',
      'remove',
      'set_body',
      'favor',
      'reputation',
      'advance_time',
      'quest',
      'check',
      'battle',
      'goto',
      'back',
      'ending',
      'loop_transition',
      'unlock',
      'media',
      'notify',
      'call',
    ]);
    expect(effectSchemas).toHaveLength(25);
  });

  it('每个内置指令的最小正例均可解析', () => {
    for (const sample of SAMPLES) {
      expect(effectDataSchema.parse(sample)).toEqual(sample);
    }
  });

  it('临时变身 revertAfter（§4.8）与 wear 换装预设（§4.7）可解析', () => {
    expect(
      effectDataSchema.parse({
        set_body: { part: 'ears', value: 'pointed', revertAfter: { slots: 6 } },
      }),
    ).toEqual({ set_body: { part: 'ears', value: 'pointed', revertAfter: { slots: 6 } } });
    expect(effectDataSchema.parse({ wear: { preset: 'going_out' } })).toEqual({
      wear: { preset: 'going_out' },
    });
  });

  it('unlock 四类 kind 均可解析（gallery/ending/codex/achievement）', () => {
    expect(effectDataSchema.parse({ unlock: { kind: 'ending', id: 'quiet_town' } })).toBeTruthy();
    expect(effectDataSchema.parse({ unlock: { kind: 'codex', id: 'raven_note' } })).toBeTruthy();
    expect(
      effectDataSchema.parse({ unlock: { kind: 'achievement', id: 'first_rumor' } }),
    ).toBeTruthy();
  });

  it('media 五类 intent 均可解析（bg/cg/sprite 带 transition，bgm/sfx 不带）', () => {
    expect(
      effectDataSchema.parse({ media: { type: 'bg', assetId: 'bg_town', transition: 'fade' } }),
    ).toBeTruthy();
    expect(effectDataSchema.parse({ media: { type: 'sfx', assetId: 'sfx_door' } })).toBeTruthy();
  });

  it('check 的分支子效果递归校验（§3.3 child 事务）', () => {
    const nested = {
      check: {
        value: 'attr.insight',
        onSuccess: [
          {
            check: {
              value: 'attr.stamina',
              onCritical: [{ goto: 'double_win' }],
            },
          },
        ],
      },
    };
    expect(effectDataSchema.parse(nested)).toEqual(nested);
  });

  it('非法样例：未知指令键被拒绝', () => {
    expect(() => effectDataSchema.parse({ set_hp: { key: 'attr.hp', value: 1 } })).toThrow(
      z.ZodError,
    );
    expect(() => effectDataSchema.parse({ unknown_cmd: {} })).toThrow(z.ZodError);
  });

  it('非法样例：单条指令携带两个指令键被拒绝（strict 单键语义）', () => {
    expect(() => effectDataSchema.parse({ goto: 'x', set: { key: 'a', value: 1 } })).toThrow(
      z.ZodError,
    );
  });

  it('非法样例：goto 参数非字符串 / back 参数非 null / 缺少必备参数', () => {
    expect(() => effectDataSchema.parse({ goto: 42 })).toThrow(z.ZodError);
    expect(() => effectDataSchema.parse({ back: true })).toThrow(z.ZodError);
    expect(() => effectDataSchema.parse({ set: { key: 'attr.hp' } })).toThrow(z.ZodError);
    expect(() => effectDataSchema.parse({ favor: { npc: 'old_guard' } })).toThrow(z.ZodError);
  });

  it('非法样例：wear 同时缺 item 与 preset（§4.7 二者必有其一）', () => {
    expect(() => effectDataSchema.parse({ wear: {} })).toThrow(z.ZodError);
  });

  it('非法样例：quest.action 越界 / check.difficulty 越界 / media bgm 携带 transition', () => {
    expect(() => effectDataSchema.parse({ quest: { id: 'q', action: 'restart' } })).toThrow(
      z.ZodError,
    );
    expect(() =>
      effectDataSchema.parse({ check: { value: 'attr.hp', difficulty: 'impossible' } }),
    ).toThrow(z.ZodError);
    expect(() =>
      effectDataSchema.parse({
        media: { type: 'bgm', assetId: 'bgm_rain', transition: 'fade' },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：unlock 未知 kind / call 缺 fn / money 值非表达式或数值', () => {
    expect(() => effectDataSchema.parse({ unlock: { kind: 'perk', id: 'p' } })).toThrow(z.ZodError);
    expect(() => effectDataSchema.parse({ call: { with: {} } })).toThrow(z.ZodError);
    expect(() => effectDataSchema.parse({ money: { town_silver: true } })).toThrow(z.ZodError);
  });

  it('引用字段携带 refKind 元数据（give.item→item、favor.npc→npc、goto→scene）', () => {
    expect(z.globalRegistry.get(effectParamSchemas.give.shape.item)).toMatchObject({
      refKind: 'item',
    });
    expect(z.globalRegistry.get(effectParamSchemas.favor.shape.npc)).toMatchObject({
      refKind: 'npc',
    });
    expect(z.globalRegistry.get(effectParamSchemas.goto)).toMatchObject({ refKind: 'scene' });
  });

  it('EffectData 类型为单键对象联合（类型层抽检）', () => {
    expectTypeOf<Extract<EffectData, { goto: unknown }>>().toEqualTypeOf<{ goto: string }>();
    expectTypeOf<Extract<EffectData, { back: unknown }>>().toEqualTypeOf<{ back: null }>();
    expectTypeOf<Extract<EffectData, { set: unknown }>>().toEqualTypeOf<{
      set: { key: string; value: string | number | boolean };
    }>();
  });
});
