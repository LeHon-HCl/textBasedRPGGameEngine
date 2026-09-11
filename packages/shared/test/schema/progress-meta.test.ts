import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  achievementDefSchema,
  contentTagsDefSchema,
  endingDefSchema,
  loopConfigSchema,
  perkDefSchema,
  statsPageDefSchema,
} from '../../src/index.js';
import type {
  AchievementDef,
  ContentTagsDef,
  EndingDef,
  LoopConfig,
  LoopPolicy,
  PerkDef,
  StatsPageDef,
} from '../../src/index.js';

describe('achievementDefSchema（设计 §2.4 AchievementDef，02 任务 B2）', () => {
  const VALID = [
    {
      id: 'first_rumor',
      nameKey: 'achievements.first_rumor.name',
      when: 'flag.heard_rumor',
      points: 5,
      type: 'normal',
      group: 'exploration',
    },
    {
      id: 'sharp_eye',
      nameKey: 'achievements.sharp_eye.name',
      when: 'attr.insight >= 20',
      points: 10,
      type: 'progress',
      progressExpr: 'attr.insight',
      goal: 20,
      group: 'exploration',
    },
    {
      id: 'secret_ending',
      nameKey: 'achievements.secret_ending.name',
      when: 'flag.saw_seal',
      points: 25,
      type: 'hidden',
    },
  ] as const;

  it('解析 normal / progress / hidden 三型成就', () => {
    for (const sample of VALID) {
      expect(achievementDefSchema.parse(sample)).toEqual(sample);
    }
  });

  it('z.infer 类型抽检', () => {
    expectTypeOf<AchievementDef['type']>().toEqualTypeOf<'normal' | 'progress' | 'hidden'>();
    expectTypeOf<AchievementDef['points']>().toBeNumber();
  });

  it('非法样例：type=progress 缺 progressExpr 或 goal（语义约束）', () => {
    const withoutExpr = structuredClone(VALID[1]) as Record<string, unknown>;
    delete withoutExpr.progressExpr;
    expect(() => achievementDefSchema.parse(withoutExpr)).toThrow(z.ZodError);
    const withoutGoal = structuredClone(VALID[1]) as Record<string, unknown>;
    delete withoutGoal.goal;
    expect(() => achievementDefSchema.parse(withoutGoal)).toThrow(z.ZodError);
  });

  it('非法样例：points 为负 / type 越界 / when 缺失', () => {
    expect(() => achievementDefSchema.parse({ ...VALID[0], points: -1 })).toThrow(z.ZodError);
    expect(() => achievementDefSchema.parse({ ...VALID[0], type: 'daily' })).toThrow(z.ZodError);
    const withoutWhen = structuredClone(VALID[0]) as Record<string, unknown>;
    delete withoutWhen.when;
    expect(() => achievementDefSchema.parse(withoutWhen)).toThrow(z.ZodError);
  });
});

describe('perkDefSchema（设计 §2.4 PerkDef，02 任务 B2）', () => {
  const VALID_PERK = {
    id: 'street_smart',
    nameKey: 'perks.street_smart.name',
    descKey: 'perks.street_smart.desc',
    cost: 3,
    effects: [{ add: { key: 'attr.insight', amount: 2 } }],
    conflicts: ['bookworm'],
    repeatable: false,
  } as const;

  it('解析 Perk（cost/effects/requires/conflicts/repeatable）', () => {
    const parsed = perkDefSchema.parse(VALID_PERK);
    expect(parsed.cost).toBe(3);
    expect(parsed.effects).toEqual([{ add: { key: 'attr.insight', amount: 2 } }]);
  });

  it('z.infer 类型抽检', () => {
    expectTypeOf<PerkDef['cost']>().toBeNumber();
    expectTypeOf<PerkDef['effects']>().toMatchTypeOf<Array<object>>();
  });

  it('非法样例：effects 为空 / cost 为负 / repeatable 非布尔', () => {
    expect(() => perkDefSchema.parse({ ...VALID_PERK, effects: [] })).toThrow(z.ZodError);
    expect(() => perkDefSchema.parse({ ...VALID_PERK, cost: -1 })).toThrow(z.ZodError);
    expect(() => perkDefSchema.parse({ ...VALID_PERK, repeatable: 'yes' })).toThrow(z.ZodError);
  });
});

describe('endingDefSchema（设计 §2.4 EndingDef，02 任务 B2）', () => {
  const VALID_ENDING = {
    id: 'quiet_town',
    nameKey: 'endings.quiet_town.name',
    reachWhen: 'flag.left_town && time.day >= 7',
    textKey: 'endings.quiet_town.text',
    nextLoop: true,
    galleryInfo: { hintKey: 'endings.quiet_town.hint' },
  } as const;

  it('解析结局（reachWhen/textKey/nextLoop/final/galleryInfo）', () => {
    const parsed = endingDefSchema.parse(VALID_ENDING);
    expect(parsed.nextLoop).toBe(true);
    expect(parsed.galleryInfo?.hintKey).toBe('endings.quiet_town.hint');
    expect(() =>
      endingDefSchema.parse({ ...VALID_ENDING, id: 'true_end', final: true }),
    ).not.toThrow();
  });

  it('z.infer 类型抽检', () => {
    expectTypeOf<EndingDef['textKey']>().toBeString();
    expectTypeOf<EndingDef['nextLoop']>().toEqualTypeOf<boolean | undefined>();
  });

  it('非法样例：缺 textKey / reachWhen 非字符串 / 未知键', () => {
    const withoutText = structuredClone(VALID_ENDING) as Record<string, unknown>;
    delete withoutText.textKey;
    expect(() => endingDefSchema.parse(withoutText)).toThrow(z.ZodError);
    expect(() => endingDefSchema.parse({ ...VALID_ENDING, reachWhen: 1 })).toThrow(z.ZodError);
    expect(() => endingDefSchema.parse({ ...VALID_ENDING, gallery: {} })).toThrow(z.ZodError);
  });
});

describe('loopConfigSchema（设计 §2.4 LoopConfig，02 任务 B2）', () => {
  it('解析五形态 policy（inherit/reset/keepRatio/whitelist/blacklist）', () => {
    const config = {
      openingScene: 'arrival',
      inherit: {
        attrs: 'inherit',
        flags: { whitelist: ['heard_rumor', 'wall_rubbing_taken'] },
        favor: 'inherit',
        items: { keepRatio: 'wallet.town_silver * 0.1' },
        quests: { blacklist: ['daily_errand'] },
      },
      reset: { body: 'reset' },
    } as const;
    const parsed = loopConfigSchema.parse(config);
    expect(parsed.inherit?.flags).toEqual({ whitelist: ['heard_rumor', 'wall_rubbing_taken'] });
    expect(parsed.inherit?.items).toEqual({ keepRatio: 'wallet.town_silver * 0.1' });
    expect(parsed.reset?.body).toBe('reset');
  });

  it('z.infer 类型抽检（policy 联合）', () => {
    expectTypeOf<LoopPolicy>().toEqualTypeOf<
      | 'inherit'
      | 'reset'
      | { keepRatio: string }
      | { whitelist: string[] }
      | { blacklist: string[] }
    >();
    expectTypeOf<LoopConfig['openingScene']>().toBeString();
  });

  it('非法样例：类别越界 / keepRatio 非表达式 / 缺 openingScene', () => {
    expect(() =>
      loopConfigSchema.parse({
        openingScene: 'arrival',
        inherit: { money: 'inherit' },
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      loopConfigSchema.parse({
        openingScene: 'arrival',
        inherit: { attrs: { keepRatio: 0.5 } },
      }),
    ).toThrow(z.ZodError);
    expect(() => loopConfigSchema.parse({ inherit: { attrs: 'inherit' } })).toThrow(z.ZodError);
  });
});

describe('contentTagsDefSchema（设计 §2.4 ContentTagsDef，02 任务 B2）', () => {
  it('解析标签集（id/nameKey/defaultOn）', () => {
    const parsed = contentTagsDefSchema.parse({
      tags: [{ id: 'general', nameKey: 'tags.general.name', defaultOn: true }],
    });
    expect(parsed.tags[0]?.id).toBe('general');
  });

  it('z.infer 类型抽检', () => {
    expectTypeOf<ContentTagsDef['tags'][number]['defaultOn']>().toBeBoolean();
  });

  it('非法样例：defaultOn 缺失 / id 不符命名 / tags 非数组', () => {
    expect(() =>
      contentTagsDefSchema.parse({ tags: [{ id: 'general', nameKey: 't.g.n' }] }),
    ).toThrow(z.ZodError);
    expect(() =>
      contentTagsDefSchema.parse({ tags: [{ id: 'General', nameKey: 't.g.n', defaultOn: true }] }),
    ).toThrow(z.ZodError);
    expect(() => contentTagsDefSchema.parse({ tags: 'general' })).toThrow(z.ZodError);
  });
});

describe('statsPageDefSchema（设计 §2.4 StatsPageDef，02 任务 B2）', () => {
  const VALID_PAGE = {
    groups: [
      {
        id: 'overview',
        nameKey: 'stats.overview.name',
        entries: [
          { expr: 'attr.hp', style: 'bar' },
          { key: 'stats.overview.playtime', style: 'text' },
          { expr: 'loop', showIf: 'loop > 1', style: 'radar' },
        ],
      },
    ],
  } as const;

  it('解析分组与条目（expr|key 二选一 + showIf + style）', () => {
    const parsed = statsPageDefSchema.parse(VALID_PAGE);
    expect(parsed.groups[0]?.entries).toHaveLength(3);
  });

  it('z.infer 类型抽检', () => {
    expectTypeOf<StatsPageDef['groups']>().toMatchTypeOf<Array<{ entries: unknown[] }>>();
    expectTypeOf<StatsPageDef['groups'][number]['nameKey']>().toBeString();
  });

  it('非法样例：条目 expr/key 均缺失或同时出现 / groups 为空', () => {
    expect(() =>
      statsPageDefSchema.parse({
        groups: [{ id: 'g', nameKey: 's.g.n', entries: [{ style: 'bar' }] }],
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      statsPageDefSchema.parse({
        groups: [
          {
            id: 'g',
            nameKey: 's.g.n',
            entries: [{ expr: 'attr.hp', key: 'stats.x' }],
          },
        ],
      }),
    ).toThrow(z.ZodError);
    expect(() => statsPageDefSchema.parse({ groups: [] })).toThrow(z.ZodError);
  });

  it('非法样例：style 越界枚举', () => {
    expect(() =>
      statsPageDefSchema.parse({
        groups: [{ id: 'g', nameKey: 's.g.n', entries: [{ expr: 'attr.hp', style: 'pie' }] }],
      }),
    ).toThrow(z.ZodError);
  });
});
