import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import { newGameState } from '../../src/state/new-game.js';
import type { NewGameBootstrap } from '../../src/state/new-game.js';
import { defaultTimeView } from '../../src/state/expr-scope.js';

/**
 * newGameState 状态树初始化用例（04 任务 A1，设计 §3.1 字段清单）。
 *
 * 断言口径：新档初始化是纯数据投影——bootstrap 各域逐字段落位、缺省域为
 * 空档缺省值、派生属性在初始化时经公式求值（rng 贯穿求值上下文，DD-09）。
 */

const BASE_VERSIONS = { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' };

const MINIMAL_BOOTSTRAP: NewGameBootstrap = { versions: BASE_VERSIONS };

const FULL_BOOTSTRAP: NewGameBootstrap = {
  versions: BASE_VERSIONS,
  attrs: { hp: 30, con: 3 },
  derivedFormulas: { max_hp: '10 + attr.con * 3' },
  skills: { stealth: { value: 3, exp: 40 } },
  body: { race: 'human', build: 'slim' },
  npcs: {
    raven: { favor: 7, stage: 'warm', met: true, flags: { mood: 'calm' } },
    sela: { favor: 0 },
  },
  factions: { mages: 12 },
  time: { day: 5, slotIndex: 2 },
  unlockedAreas: ['old_town'],
  flags: { door_opened: true, chapter: 2 },
  counters: { herbs_picked: 4 },
  bag: [{ itemId: 'potion', count: 3 }],
  wallet: { gold: 100 },
  perks: ['iron_will'],
  playerName: '阿澈',
  settings: { lang: 'zh-TW', fontSize: 18 },
};

describe('04-A1 newGameState：最小 bootstrap 产出 §3.1 全字段状态树', () => {
  const state = newGameState(MINIMAL_BOOTSTRAP, createRng(42));

  it('顶层字段与 §3.1 字段清单完全一致', () => {
    expect(Object.keys(state).sort()).toEqual(
      [
        'checkpoints',
        'factions',
        'loop',
        'npcs',
        'player',
        'quests',
        'readStats',
        'seen',
        'settings',
        'versions',
        'world',
      ].sort(),
    );
  });

  it('版本三元组：manifest 版本 + 引擎实际版本（FR-MIGR-01）', () => {
    expect(state.versions).toEqual({
      engineVersion: '0.0.0',
      gameVersion: '1.0.0',
      schemaVersion: 1,
    });
  });

  it('loop 归零，player 缺省域为空档缺省值', () => {
    expect(state.loop).toBe(0);
    expect(state.player).toEqual({
      attrs: {},
      skills: {},
      statuses: [],
      body: {},
      equip: {},
      outfit: {},
      bag: [],
      wallet: {},
      derived: {},
      outfitPresets: {},
      wornMeta: {},
      bodyTemp: {},
      bodyProgress: {},
      bootstrap: { perks: [], name: '' },
    });
  });

  it('world 缺省域：时间起点第 1 天第 0 时段，缓存与冷却为空', () => {
    expect(state.world).toEqual({
      time: { day: 1, slotIndex: 0 },
      unlockedAreas: [],
      flags: {},
      counters: {},
      npcLocationCache: {},
      eventCooldowns: {},
      shopStock: {},
      shopRestock: {},
    });
  });

  it('npcs / factions / quests / seen 为空档', () => {
    expect(state.npcs).toEqual({});
    expect(state.factions).toEqual({});
    expect(state.quests).toEqual({});
    expect(state.seen).toEqual({ scenes: [], gallery: [], cg: [], endings: [], codex: [] });
  });

  it('readStats 全零起步（FR-STAP-03）', () => {
    expect(state.readStats).toEqual({
      playSeconds: 0,
      eventCounts: {},
      checks: { attempts: 0, successes: 0 },
      battles: { wins: 0, losses: 0, escapes: 0 },
    });
  });

  it('settings 缺省值全字段（FR-UI-05）', () => {
    expect(state.settings).toEqual({
      lang: 'zh-CN',
      textSpeed: 1,
      fontSize: 16,
      lineHeight: 1.6,
      bgmOn: true,
      sfxOn: true,
      imagesOn: true,
      reducedMotion: false,
      disabledTags: [],
      wizardDone: false,
    });
  });

  it('checkpoints 为空栈（回滚栈元数据随 checkpoint 增长）', () => {
    expect(state.checkpoints).toEqual([]);
  });
});

describe('04-A1 newGameState：bootstrap 投影逐域落位', () => {
  const state = newGameState(FULL_BOOTSTRAP, createRng(42));

  it('player 各初始域直传落位', () => {
    expect(state.player.attrs).toEqual({ hp: 30, con: 3 });
    expect(state.player.skills).toEqual({ stealth: { value: 3, exp: 40 } });
    expect(state.player.body).toEqual({ race: 'human', build: 'slim' });
    expect(state.player.bag).toEqual([{ itemId: 'potion', count: 3 }]);
    expect(state.player.wallet).toEqual({ gold: 100 });
  });

  it('perks 与玩家命名进入 player.bootstrap（任务书 A1：含 bootstrap.perks）', () => {
    expect(state.player.bootstrap).toEqual({ perks: ['iron_will'], name: '阿澈' });
  });

  it('NPC 初始好感与阶段落位；未声明 stage/met 时取缺省', () => {
    expect(state.npcs.raven).toEqual({
      favor: 7,
      stage: 'warm',
      met: true,
      flags: { mood: 'calm' },
    });
    expect(state.npcs.sela).toEqual({ favor: 0, met: false, flags: {} });
  });

  it('faction 初始声望与时间起点直传', () => {
    expect(state.factions).toEqual({ mages: 12 });
    expect(state.world.time).toEqual({ day: 5, slotIndex: 2 });
  });

  it('unlockedAreas / flags / counters 初始值落位', () => {
    expect(state.world.unlockedAreas).toEqual(['old_town']);
    expect(state.world.flags).toEqual({ door_opened: true, chapter: 2 });
    expect(state.world.counters).toEqual({ herbs_picked: 4 });
  });

  it('设置以 bootstrap.settings 逐项覆盖缺省值（未覆盖项保持缺省）', () => {
    expect(state.settings.lang).toBe('zh-TW');
    expect(state.settings.fontSize).toBe(18);
    expect(state.settings.textSpeed).toBe(1);
    expect(state.settings.bgmOn).toBe(true);
  });

  it('派生属性公式在初始化时求值（FR-STAT-05：初始 derived 非空）', () => {
    expect(state.player.derived).toEqual({ max_hp: 19 });
  });

  it('初始化对 bootstrap 输入做逐层拷贝（后续改写 bootstrap 不影响状态）', () => {
    const skills = { stealth: { value: 1, exp: 0 } };
    const bag = [{ itemId: 'potion', count: 1 }];
    const flags: Record<string, boolean | number | string> = { a: 1 };
    const time = { day: 3, slotIndex: 1 };
    const created = newGameState(
      { versions: BASE_VERSIONS, skills, bag, flags, time },
      createRng(1),
    );
    skills.stealth.value = 99;
    bag[0] = { itemId: 'potion', count: 99 };
    flags.a = 99;
    time.day = 99;
    expect(created.player.skills.stealth).toEqual({ value: 1, exp: 0 });
    expect(created.player.bag).toEqual([{ itemId: 'potion', count: 1 }]);
    expect(created.world.flags).toEqual({ a: 1 });
    expect(created.world.time).toEqual({ day: 3, slotIndex: 1 });
  });
});

describe('04-A1 newGameState：派生属性初始化的求值管线（A3 公共路径）', () => {
  it('无 derivedFormulas 时不求值（derived 保持空）', () => {
    const state = newGameState({ versions: BASE_VERSIONS, attrs: { con: 5 } }, createRng(42));
    expect(state.player.derived).toEqual({});
  });

  it('公式经内置函数注册表求值（作用域注入：attr/body 等 root 可读）', () => {
    const state = newGameState(
      {
        versions: BASE_VERSIONS,
        attrs: { con: 2 },
        body: { build: 'sturdy' },
        derivedFormulas: {
          max_hp: '10 + attr.con * 3',
          guard: 'body.build == "sturdy" ? 5 : 1',
        },
      },
      createRng(42),
    );
    expect(state.player.derived.max_hp).toBe(16);
    expect(state.player.derived.guard).toBe(5);
  });

  it('公式引用其他派生属性时按依赖序求值（拓扑序）', () => {
    const state = newGameState(
      {
        versions: BASE_VERSIONS,
        attrs: { con: 2 },
        derivedFormulas: {
          // 声明顺序故意倒置：hp_ratio 依赖 max_hp，仍须先算 max_hp
          hp_ratio: 'attr.max_hp / 10',
          max_hp: '10 + attr.con * 3',
        },
      },
      createRng(42),
    );
    expect(state.player.derived.max_hp).toBe(16);
    expect(state.player.derived.hp_ratio).toBe(1.6);
  });

  it('公式含随机函数时消耗传入 rng 的序列（同种子可复现，DD-09）', () => {
    const a = newGameState(
      { versions: BASE_VERSIONS, derivedFormulas: { roll: 'randInt(1, 100)' } },
      createRng(42),
    );
    const b = newGameState(
      { versions: BASE_VERSIONS, derivedFormulas: { roll: 'randInt(1, 100)' } },
      createRng(42),
    );
    expect(a.player.derived.roll).toBe(b.player.derived.roll);
    expect(a.player.derived.roll).toBe(createRng(42).int(1, 100));
  });

  it('公式结果非有限数值时抛 EVAL_ERROR（严格语义，无静默默认值）', () => {
    expect(() =>
      newGameState(
        { versions: BASE_VERSIONS, derivedFormulas: { broken: 'flag("nope") + 1' } },
        createRng(42),
      ),
    ).toThrowError(/EVAL_ERROR/);
  });

  it('派生公式循环依赖为防御性 EXPR_COMPILE（FR-STAT-05：正常在加载期排除）', () => {
    expect(() =>
      newGameState(
        {
          versions: BASE_VERSIONS,
          derivedFormulas: { a: 'attr.b + 1', b: 'attr.a + 1' },
        },
        createRng(42),
      ),
    ).toThrowError(/EXPR_COMPILE/);
  });
});

describe('04-A1 默认时间视图投影（03 号 time 根接线，09 号 TimeConfig 校准前的缺省）', () => {
  it('weekday = (day-1)%7+1、slot = slotIndex 直传（ExprTimeView 契约为 string）', () => {
    expect(defaultTimeView({ day: 1, slotIndex: 0 })).toEqual({ day: 1, weekday: '1', slot: '0' });
    expect(defaultTimeView({ day: 7, slotIndex: 3 })).toEqual({ day: 7, weekday: '7', slot: '3' });
    expect(defaultTimeView({ day: 8, slotIndex: 1 })).toEqual({ day: 8, weekday: '1', slot: '1' });
    expect(defaultTimeView({ day: 0, slotIndex: 2 })).toEqual({ day: 0, weekday: '7', slot: '2' });
  });

  it('可选 week/month 不参与投影（Clock 透传字段）', () => {
    expect(defaultTimeView({ day: 2, slotIndex: 1, week: 1, month: 0 })).toEqual({
      day: 2,
      weekday: '2',
      slot: '1',
    });
  });
});
