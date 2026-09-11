import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { profileSchema, saveBlobSchema } from '../../src/index.js';
import type { Profile, SaveBlob, SerializedState } from '../../src/index.js';

/** 与 §3.1 状态树同构的最小合法投影（mini-game 语境） */
const VALID_STATE = {
  loop: 1,
  player: {
    attrs: { hp: 90, stamina: 28, insight: 3 },
    skills: { brawl: { value: 40, exp: 120 } },
    statuses: [{ id: 'soaked', remaining: 2, source: 'ev_rain' }],
    body: { ears: 'normal' },
    equip: { weapon: 'rusted_sword' },
    outfit: { torso: { '2': 'guard_coat' } },
    bag: [{ itemId: 'warm_bun', count: 3 }],
    wallet: { town_silver: 42 },
    derived: { max_carry: 76 },
    bootstrap: { perks: ['street_smart'], name: '旅人' },
  },
  world: {
    time: { day: 3, slotIndex: 1, week: 1 },
    unlockedAreas: ['old_town'],
    flags: { heard_rumor: true, rent_due: 5 },
    counters: { ev_market_rumor: 2 },
    eventCooldowns: { ev_market_rumor: { lastDay: 3, fired: 1 } },
  },
  npcs: { old_guard: { favor: 21, stage: 'friendly', met: true, flags: { talked: true } } },
  factions: { town: 4 },
  quests: {
    wall_rubbing: {
      state: 'active',
      stage: 'inspect_wall',
      objectives: { wall: 1 },
      startedDay: 2,
    },
  },
  seen: {
    scenes: ['arrival', 'market_street'],
    gallery: ['town_gate'],
    cg: ['cg_market'],
    endings: [],
    codex: [],
  },
  readStats: {
    playSeconds: 3600,
    eventCounts: { ev_market_rumor: 2 },
    checks: { attempts: 4, successes: 2 },
    battles: { wins: 1, losses: 0, escapes: 0 },
  },
  settings: {
    lang: 'zh-CN',
    textSpeed: 2,
    fontSize: 16,
    lineHeight: 1.6,
    bgmOn: true,
    sfxOn: true,
    imagesOn: true,
    reducedMotion: false,
    disabledTags: [],
    wizardDone: true,
  },
} as const;

const VALID_BLOB = {
  formatVersion: 1,
  engineVersion: '0.1.0',
  gameVersion: '1.0.0',
  schemaVersion: 1,
  state: VALID_STATE,
  rngState: 2147483647,
  meta: {
    createdAt: 1726000000000,
    playSeconds: 3600,
    location: 'market_street',
    day: 3,
    loop: 1,
  },
} as const;

const VALID_PROFILE = {
  schemaVersion: 1,
  achievements: {
    first_rumor: { unlockedAt: 1726000000000 },
    sharp_eye: { unlockedAt: 1726000100000, progress: { cur: 12, goal: 20 } },
  },
  points: 8,
  purchasedPerks: [{ id: 'street_smart', at: 1726000200000 }],
  endings: ['quiet_town'],
} as const;

describe('saveBlobSchema（设计 §2.4 SaveBlob + SerializedState 投影，02 任务 B3）', () => {
  it('解析完整存档 blob（三层版本 + state + rngState + meta）', () => {
    const parsed = saveBlobSchema.parse(VALID_BLOB);
    expect(parsed.state.player.wallet).toEqual({ town_silver: 42 });
    expect(parsed.state.world.flags.heard_rumor).toBe(true);
    expect(parsed.rngState).toBe(2147483647);
  });

  it('SerializedState 类型覆盖 §3.1 状态树的入档面', () => {
    expectTypeOf<SerializedState['loop']>().toBeNumber();
    expectTypeOf<SerializedState['npcs']>().toMatchTypeOf<Record<string, object>>();
    expectTypeOf<SerializedState['quests']['wall_rubbing']>().toMatchTypeOf<object>();
    expectTypeOf<SaveBlob['state']>().toEqualTypeOf<SerializedState>();
  });

  it('可序列化往返：parse 产物 JSON 稳定（存档体即 JSON 文档，FR-SAVE-04）', () => {
    const parsed = saveBlobSchema.parse(VALID_BLOB);
    const reparsed = saveBlobSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it('非法样例：flag 值越出 boolean|number|string 值域（§3.1）', () => {
    expect(() =>
      saveBlobSchema.parse({
        ...VALID_BLOB,
        state: {
          ...VALID_STATE,
          world: { ...VALID_STATE.world, flags: { weird: ['array'] } },
        },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：bag 条目 count < 1 / outfit 层值非 item 引用字符串', () => {
    expect(() =>
      saveBlobSchema.parse({
        ...VALID_BLOB,
        state: {
          ...VALID_STATE,
          player: { ...VALID_STATE.player, bag: [{ itemId: 'warm_bun', count: 0 }] },
        },
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      saveBlobSchema.parse({
        ...VALID_BLOB,
        state: {
          ...VALID_STATE,
          player: { ...VALID_STATE.player, outfit: { torso: { '2': 7 } } },
        },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：quest.state 越出状态机枚举（§4.5）', () => {
    expect(() =>
      saveBlobSchema.parse({
        ...VALID_BLOB,
        state: {
          ...VALID_STATE,
          quests: { wall_rubbing: { state: 'paused', objectives: {} } },
        },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：rngState 负数（uint32 域，DD-09）', () => {
    expect(() => saveBlobSchema.parse({ ...VALID_BLOB, rngState: -1 })).toThrow(z.ZodError);
  });

  it('非法样例：版本字段缺失或非法（FR-MIGR-01/02 终验前置）', () => {
    expect(() => saveBlobSchema.parse({ ...VALID_BLOB, engineVersion: 'dev' })).toThrow(z.ZodError);
    expect(() => saveBlobSchema.parse({ ...VALID_BLOB, formatVersion: 0 })).toThrow(z.ZodError);
  });

  it('非法样例：state 携带未登记顶层键（迁移登记校验的 schema 面，FR-SCR-05）', () => {
    expect(() =>
      saveBlobSchema.parse({
        ...VALID_BLOB,
        state: { ...VALID_STATE, companions: [] },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：meta 缺 location / checksum 非字符串', () => {
    const badMeta = structuredClone(VALID_BLOB.meta) as Record<string, unknown>;
    delete badMeta.location;
    expect(() => saveBlobSchema.parse({ ...VALID_BLOB, meta: badMeta })).toThrow(z.ZodError);
    expect(() => saveBlobSchema.parse({ ...VALID_BLOB, checksum: 42 })).toThrow(z.ZodError);
  });
});

describe('profileSchema（设计 §2.4 Profile，02 任务 B3）', () => {
  it('解析 Profile（achievements 键为成就引用/points/purchasedPerks/endings）', () => {
    const parsed = profileSchema.parse(VALID_PROFILE);
    expect(parsed.points).toBe(8);
    expect(parsed.achievements.sharp_eye?.progress).toEqual({ cur: 12, goal: 20 });
    expect(parsed.endings).toEqual(['quiet_town']);
  });

  it('z.infer 类型抽检', () => {
    expectTypeOf<Profile['points']>().toBeNumber();
    expectTypeOf<Profile['purchasedPerks'][number]['id']>().toBeString();
  });

  it('非法样例：points 为负 / 成就条目缺 unlockedAt / schemaVersion 为 0', () => {
    expect(() => profileSchema.parse({ ...VALID_PROFILE, points: -1 })).toThrow(z.ZodError);
    expect(() =>
      profileSchema.parse({
        ...VALID_PROFILE,
        achievements: { first_rumor: { progress: { cur: 1, goal: 2 } } },
      }),
    ).toThrow(z.ZodError);
    expect(() => profileSchema.parse({ ...VALID_PROFILE, schemaVersion: 0 })).toThrow(z.ZodError);
  });

  it('非法样例：未知顶层键被拒绝（Profile 迁移登记面，FR-MIGR-06）', () => {
    expect(() => profileSchema.parse({ ...VALID_PROFILE, perks: [] })).toThrow(z.ZodError);
  });
});
