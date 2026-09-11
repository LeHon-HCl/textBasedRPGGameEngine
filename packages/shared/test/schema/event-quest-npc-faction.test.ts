import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { eventDefSchema, factionDefSchema, npcDefSchema, questDefSchema } from '../../src/index.js';
import type { EventDef, FactionDef, NpcDef, QuestDef } from '../../src/index.js';

describe('eventDefSchema（设计 §2.4 EventDef，02 任务 A3）', () => {
  const VALID_EVENT = {
    id: 'ev_market_rumor',
    where: { area: 'old_town', location: 'market' },
    when: { slots: ['morning', 'afternoon'] },
    trigger: { type: 'random', weight: 5, require: '!flag.heard_rumor', cooldown: { days: 2 } },
    priority: 0,
    mutexGroup: 'rumor_line',
    tags: ['general'],
    scene: 'ev_market_rumor_scene',
  } as const;

  it('解析 random 型事件（weight/require/cooldown）', () => {
    const parsed = eventDefSchema.parse(VALID_EVENT);
    expect(parsed.trigger).toMatchObject({ type: 'random', weight: 5 });
    expect(parsed.where.location).toBe('market');
  });

  it('解析 condition 型（require 必填 + priority）与 explore 型事件', () => {
    expect(() =>
      eventDefSchema.parse({
        ...VALID_EVENT,
        id: 'ev_wall_whisper',
        trigger: { type: 'condition', require: 'flag.wall_rubbing_taken' },
        priority: 10,
      }),
    ).not.toThrow();
    expect(() =>
      eventDefSchema.parse({
        ...VALID_EVENT,
        id: 'ev_hidden_cache',
        trigger: { type: 'explore', weight: 3, once: 'save' },
      }),
    ).not.toThrow();
  });

  it('cooldown 允许天数表达式（FR-XPLR-04 概率型冷却）', () => {
    expect(() =>
      eventDefSchema.parse({
        ...VALID_EVENT,
        trigger: { type: 'random', weight: 1, cooldown: { days: '2 + loop' } },
      }),
    ).not.toThrow();
  });

  it('z.infer 类型抽检（scene 为场景引用字符串）', () => {
    expectTypeOf<EventDef['scene']>().toBeString();
    expectTypeOf<EventDef['trigger']>().toMatchTypeOf<
      | { type: 'condition'; require: string }
      | { type: 'random'; weight: number }
      | { type: 'explore'; weight: number }
    >();
  });

  it('非法样例：random 型缺 weight / weight 非正', () => {
    expect(() =>
      eventDefSchema.parse({ ...VALID_EVENT, trigger: { type: 'random', require: 'true' } }),
    ).toThrow(z.ZodError);
    expect(() =>
      eventDefSchema.parse({ ...VALID_EVENT, trigger: { type: 'random', weight: 0 } }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：condition 型缺 require / 未知 trigger 类型', () => {
    expect(() => eventDefSchema.parse({ ...VALID_EVENT, trigger: { type: 'condition' } })).toThrow(
      z.ZodError,
    );
    expect(() =>
      eventDefSchema.parse({ ...VALID_EVENT, trigger: { type: 'timed', weight: 1 } }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：cooldown 空对象 / once 越界枚举', () => {
    expect(() =>
      eventDefSchema.parse({
        ...VALID_EVENT,
        trigger: { type: 'random', weight: 1, cooldown: {} },
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      eventDefSchema.parse({
        ...VALID_EVENT,
        trigger: { type: 'random', weight: 1, once: 'session' },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：where 缺 area / 缺 scene / 未知顶层键', () => {
    expect(() => eventDefSchema.parse({ ...VALID_EVENT, where: { location: 'market' } })).toThrow(
      z.ZodError,
    );
    const withoutScene = structuredClone(VALID_EVENT) as Record<string, unknown>;
    delete withoutScene.scene;
    expect(() => eventDefSchema.parse(withoutScene)).toThrow(z.ZodError);
    expect(() => eventDefSchema.parse({ ...VALID_EVENT, scene_id: 'x' })).toThrow(z.ZodError);
  });
});

describe('questDefSchema（设计 §2.4 QuestDef，02 任务 A3）', () => {
  const VALID_QUEST = {
    id: 'wall_rubbing',
    giver: 'old_guard',
    acceptIf: 'flag.heard_rumor',
    stages: [
      {
        id: 'inspect_wall',
        objectiveKey: 'quests.wall_rubbing.obj_inspect',
        completeWhen: 'flag.wall_rubbing_taken',
      },
      {
        id: 'report',
        objectiveKey: 'quests.wall_rubbing.obj_report',
        completeWhen: 'npc.old_guard.talked',
      },
    ],
    rewards: [{ money: { town_silver: 20 } }, { favor: { npc: 'old_guard', amount: 15 } }],
    failWhen: 'time.day > 10 && !flag.wall_rubbing_taken',
    requires: ['first_rumor_quest'],
    conflicts: ['rat_problem'],
  } as const;

  it('解析完整任务（giver/acceptIf/stages/rewards/failWhen/requires/conflicts）', () => {
    const parsed = questDefSchema.parse(VALID_QUEST);
    expect(parsed.stages).toHaveLength(2);
    expect(parsed.rewards).toHaveLength(2);
    expect(parsed.requires).toEqual(['first_rumor_quest']);
  });

  it('z.infer 类型抽检（giver 为 NPC 引用字符串）', () => {
    expectTypeOf<QuestDef['giver']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<QuestDef['conflicts']>().toEqualTypeOf<string[] | undefined>();
  });

  it('非法样例：stages 为空数组', () => {
    expect(() => questDefSchema.parse({ ...VALID_QUEST, stages: [] })).toThrow(z.ZodError);
  });

  it('非法样例：stage 缺 objectiveKey / completeWhen', () => {
    expect(() =>
      questDefSchema.parse({
        ...VALID_QUEST,
        stages: [{ id: 's1', objectiveKey: 'q.obj' }],
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      questDefSchema.parse({
        ...VALID_QUEST,
        stages: [{ id: 's1', objectiveKey: 'q.obj', completeWhen: 42 }],
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：rewards 含未知指令 / conflicts 元素非字符串（引用命名悬空归加载期检查）', () => {
    expect(() => questDefSchema.parse({ ...VALID_QUEST, rewards: [{ fly: {} }] })).toThrow(
      z.ZodError,
    );
    expect(() => questDefSchema.parse({ ...VALID_QUEST, conflicts: [42] })).toThrow(z.ZodError);
  });
});

describe('npcDefSchema（设计 §2.4 NpcDef，02 任务 A3）', () => {
  const VALID_NPC = {
    id: 'old_guard',
    nameKey: 'npcs.old_guard.name',
    sprites: ['sprite_old_guard_base'],
    schedule: [
      { at: { slots: ['morning', 'afternoon'] }, location: 'gate' },
      { at: { slots: ['evening'] }, location: 'market', showIf: 'faction.town >= 0' },
    ],
    favor: {
      min: -20,
      max: 60,
      stages: [
        { id: 'stranger', at: 0, nameKey: 'npcs.favor.stranger' },
        { id: 'friendly', at: 20, nameKey: 'npcs.favor.friendly' },
      ],
    },
  } as const;

  it('解析完整 NPC（sprites/schedule/favor 阈值分段）', () => {
    const parsed = npcDefSchema.parse(VALID_NPC);
    expect(parsed.schedule).toHaveLength(2);
    expect(parsed.favor?.stages[1]?.at).toBe(20);
  });

  it('无 schedule / 无 favor 的最简 NPC 合法', () => {
    expect(() => npcDefSchema.parse({ id: 'hawker', nameKey: 'npcs.hawker.name' })).not.toThrow();
  });

  it('z.infer 类型抽检', () => {
    expectTypeOf<NpcDef['schedule']>().toMatchTypeOf<
      Array<{ at: object; location: string; showIf?: string }> | undefined
    >();
  });

  it('非法样例：favor min > max（语义约束）', () => {
    expect(() =>
      npcDefSchema.parse({
        ...VALID_NPC,
        favor: { ...VALID_NPC.favor, min: 100, max: 0 },
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：日程项缺 location / location 非字符串', () => {
    expect(() =>
      npcDefSchema.parse({
        ...VALID_NPC,
        schedule: [{ at: { slots: ['morning'] } }],
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      npcDefSchema.parse({
        ...VALID_NPC,
        schedule: [{ at: {}, location: 42 }],
      }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：favor 阶段缺 nameKey / sprites 元素非字符串', () => {
    expect(() =>
      npcDefSchema.parse({
        ...VALID_NPC,
        favor: { min: 0, max: 10, stages: [{ id: 's', at: 0 }] },
      }),
    ).toThrow(z.ZodError);
    expect(() => npcDefSchema.parse({ ...VALID_NPC, sprites: [7] })).toThrow(z.ZodError);
  });
});

describe('factionDefSchema（设计 §2.4 FactionDef，02 任务 A3）', () => {
  const VALID_FACTION = {
    id: 'town',
    nameKey: 'factions.town.name',
    init: 0,
    thresholds: [
      { id: 'hostile', at: -20, nameKey: 'factions.town.hostile' },
      { id: 'welcoming', at: 10, nameKey: 'factions.town.welcoming' },
    ],
  } as const;

  it('解析阵营（init + 声望波段阈值表）', () => {
    const parsed = factionDefSchema.parse(VALID_FACTION);
    expect(parsed.init).toBe(0);
    expect(parsed.thresholds).toHaveLength(2);
  });

  it('无阈值表的最简阵营合法', () => {
    expect(() =>
      factionDefSchema.parse({ id: 'guild', nameKey: 'factions.guild.name', init: 5 }),
    ).not.toThrow();
  });

  it('z.infer 类型抽检', () => {
    expectTypeOf<FactionDef['init']>().toBeNumber();
    expectTypeOf<FactionDef['thresholds']>().toMatchTypeOf<Array<{ at: number }> | undefined>();
  });

  it('非法样例：缺 init / 阈值缺 nameKey / 未知键', () => {
    expect(() =>
      factionDefSchema.parse({ id: 'town', nameKey: 'factions.town.name', thresholds: [] }),
    ).toThrow(z.ZodError);
    expect(() =>
      factionDefSchema.parse({
        ...VALID_FACTION,
        thresholds: [{ id: 'hostile', at: -20 }],
      }),
    ).toThrow(z.ZodError);
    expect(() => factionDefSchema.parse({ ...VALID_FACTION, initial: 0 })).toThrow(z.ZodError);
  });
});
