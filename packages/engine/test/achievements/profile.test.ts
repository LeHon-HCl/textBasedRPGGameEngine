import { describe, expect, it } from 'vitest';
import { createRng, type GameId, type PerkDef } from '@game/shared';
import { newGameState } from '../../src/state/index.js';
import { GameRuntime } from '../../src/runtime/index.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import {
  chargePerk,
  compensatePerk,
  createEmptyProfile,
  createMemoryProfileStore,
  recordAchievements,
  resetPoints,
  validatePerkPurchase,
} from '../../src/achievements/profile.js';
import { applyPerkEffects, bootstrapPerks, purchasePerk } from '../../src/achievements/perks.js';

/**
 * B 线测试（18 号子任务 3/4/5/6/7）：ProfileStore、两步协议失败序、
 * resetPoints、新档 bootstrap、成就入账幂等。
 */

const PERKS = new Map<GameId, PerkDef>([
  [
    'perk_tough',
    {
      id: 'perk_tough',
      nameKey: 'perks.tough.name',
      cost: 10,
      effects: [{ add: { key: 'attr.hp', amount: 20 } }, { flag: { name: 'perk_tough_taken' } }],
    },
  ],
  [
    'perk_rich',
    {
      id: 'perk_rich',
      nameKey: 'perks.rich.name',
      cost: 20,
      effects: [{ money: { town_silver: 100 } }],
      requires: ['perk_tough'],
    },
  ],
  [
    'perk_lucky',
    {
      id: 'perk_lucky',
      nameKey: 'perks.lucky.name',
      cost: 5,
      effects: [{ flag: { name: 'lucky' } }],
      conflicts: ['perk_tough'],
      repeatable: true,
    },
  ],
]);

function profileWith(points: number, purchased: { id: string; at: number }[] = []) {
  return { ...createEmptyProfile(), points, purchasedPerks: purchased };
}

describe('18-B ProfileStore（内存实现 + 乐观锁串行队列）', () => {
  it('load 返回深拷贝快照（外部改动不影响内部）', async () => {
    const store = createMemoryProfileStore({ initial: profileWith(50) });
    const snapshot = await store.load();
    snapshot.points = 999;
    expect((await store.load()).points).toBe(50);
  });

  it('并发 mutate 串行执行：无丢失更新（乐观锁口径）', async () => {
    const store = createMemoryProfileStore({ initial: profileWith(0) });
    // 10 个并发 +1：若丢失更新则结果 < 10
    await Promise.all(
      Array.from({ length: 10 }, () => store.mutate((p) => ({ ...p, points: p.points + 1 }))),
    );
    expect((await store.load()).points).toBe(10);
  });

  it('mutate 抛错不写回，且不阻塞后续调用', async () => {
    const store = createMemoryProfileStore({ initial: profileWith(5) });
    await expect(
      store.mutate(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrowError('boom');
    await store.mutate((p) => ({ ...p, points: 7 }));
    expect((await store.load()).points).toBe(7);
  });

  it('写回内容经 profileSchema 校验（非法结构拒绝）', async () => {
    const store = createMemoryProfileStore();
    await expect(store.mutate((p) => ({ ...p, points: -1 }))).rejects.toThrowError();
  });
});

describe('18-B 两步协议：扣点与补偿（FR-ACHV-06，失败序覆盖）', () => {
  it('validatePerkPurchase 四类拒绝：点数不足/前置缺失/互斥/不可重复', () => {
    const perkTough = PERKS.get('perk_tough') as PerkDef;
    expect(validatePerkPurchase(profileWith(5), perkTough)).toBe('insufficient_points');
    const perkRich = PERKS.get('perk_rich') as PerkDef;
    expect(validatePerkPurchase(profileWith(100), perkRich)).toBe('requires_missing');
    const perkLucky = PERKS.get('perk_lucky') as PerkDef;
    expect(validatePerkPurchase(profileWith(100, [{ id: 'perk_tough', at: 1 }]), perkLucky)).toBe(
      'conflicts',
    );
    expect(validatePerkPurchase(profileWith(100, [{ id: 'perk_tough', at: 1 }]), perkTough)).toBe(
      'not_repeatable',
    );
    // repeatable 可重复购买
    expect(
      validatePerkPurchase(profileWith(100, [{ id: 'perk_lucky', at: 1 }]), perkLucky),
    ).toBeNull();
  });

  it('chargePerk：成功扣点 + 记录；被拒时 Profile 不变', async () => {
    const store = createMemoryProfileStore({ initial: profileWith(30) });
    const perkTough = PERKS.get('perk_tough') as PerkDef;
    expect(await chargePerk(store, perkTough, 1000)).toBe('ok');
    let profile = await store.load();
    expect(profile.points).toBe(20);
    expect(profile.purchasedPerks).toEqual([{ id: 'perk_tough', at: 1000 }]);

    expect(await chargePerk(store, perkTough, 2000)).toBe('not_repeatable');
    profile = await store.load();
    expect(profile.points).toBe(20); // 未变
  });

  it('compensatePerk：回加点数 + 移除记录；重复补偿幂等', async () => {
    const store = createMemoryProfileStore({ initial: profileWith(30) });
    const perkTough = PERKS.get('perk_tough') as PerkDef;
    await chargePerk(store, perkTough, 1000);
    expect(await compensatePerk(store, perkTough)).toBe(true);
    expect((await store.load()).points).toBe(30);
    expect(await compensatePerk(store, perkTough)).toBe(false); // 幂等
    expect((await store.load()).points).toBe(30);
  });

  it('purchasePerk 完整流程：成功两步入账', async () => {
    const store = createMemoryProfileStore({ initial: profileWith(30) });
    let bootstrapped = 0;
    const outcome = await purchasePerk({
      store,
      perk: PERKS.get('perk_tough') as PerkDef,
      now: 1000,
      bootstrap: () => {
        bootstrapped += 1;
      },
    });
    expect(outcome).toEqual({ perkId: 'perk_tough', charged: true, bootstrapped: true });
    expect(bootstrapped).toBe(1);
    expect((await store.load()).points).toBe(20);
  });

  it('失败序：扣点成功但建档失败 → 补偿回加 + 错误冒泡', async () => {
    const store = createMemoryProfileStore({ initial: profileWith(30) });
    await expect(
      purchasePerk({
        store,
        perk: PERKS.get('perk_tough') as PerkDef,
        now: 1000,
        bootstrap: () => {
          throw new Error('建档失败（模拟）');
        },
      }),
    ).rejects.toThrowError('建档失败（模拟）');
    const profile = await store.load();
    expect(profile.points).toBe(30); // 点数已回加
    expect(profile.purchasedPerks).toEqual([]); // 记录已移除
  });

  it('失败序：第一步被拒 → 不建档、不补偿', async () => {
    const store = createMemoryProfileStore({ initial: profileWith(3) });
    let bootstrapped = 0;
    const outcome = await purchasePerk({
      store,
      perk: PERKS.get('perk_tough') as PerkDef,
      now: 1000,
      bootstrap: () => {
        bootstrapped += 1;
      },
    });
    expect(outcome).toEqual({
      perkId: 'perk_tough',
      charged: false,
      bootstrapped: false,
      rejection: 'insufficient_points',
    });
    expect(bootstrapped).toBe(0);
    expect((await store.load()).points).toBe(3);
  });
});

describe('18-B 新档 bootstrap：PerkDef.effects 执行一次（OQ-06 仅新档）', () => {
  it('applyPerkEffects 汇总已购 Perk 的效果序列；缺项抛 DANGLING_REF', () => {
    const state = newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
        attrs: { hp: 30 },
      },
      createRng(1),
    );
    const runtime = new GameRuntime({
      state,
      rng: createRng(7),
      effectExecutor: createBuiltinEffectRegistry(),
    });
    const profile = profileWith(0, [{ id: 'perk_tough', at: 1 }]);
    expect(applyPerkEffects(runtime, profile, PERKS)).toEqual([
      { add: { key: 'attr.hp', amount: 20 } },
      { flag: { name: 'perk_tough_taken' } },
    ]);
    expect(() =>
      applyPerkEffects(runtime, profileWith(0, [{ id: 'perk_ghost', at: 1 }]), PERKS),
    ).toThrowError(/不在目录中/);
  });

  it('bootstrapPerks：效果真实入档（属性 + flag）', () => {
    const state = newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
        attrs: { hp: 30 },
      },
      createRng(1),
    );
    const runtime = new GameRuntime({
      state,
      rng: createRng(7),
      effectExecutor: createBuiltinEffectRegistry(),
    });
    bootstrapPerks(runtime, profileWith(0, [{ id: 'perk_tough', at: 1 }]), PERKS, createRng(1));
    expect(runtime.state.player.attrs['hp']).toBe(50);
    expect(runtime.state.world.flags['perk_tough_taken']).toBe(true);
  });
});

describe('18-B resetPoints 与成就入账', () => {
  it('resetPoints：回收已购 + 余额重算（recompute 回调）', async () => {
    const store = createMemoryProfileStore({
      initial: {
        ...profileWith(5, [
          { id: 'perk_tough', at: 1 },
          { id: 'perk_lucky', at: 2 },
        ]),
        achievements: { ach_a: { unlockedAt: 1 }, ach_b: { unlockedAt: 2 } },
      },
    });
    // 余额重算 = 已解锁成就点数总和（目录面由调用方计算）
    await resetPoints(store, (profile) => Object.keys(profile.achievements).length * 10);
    const profile = await store.load();
    expect(profile.points).toBe(20);
    expect(profile.purchasedPerks).toEqual([]);
    expect(Object.keys(profile.achievements)).toHaveLength(2); // 成就记录保留
  });

  it('recordAchievements：入账点数 + 幂等（重复不重复加分）', async () => {
    const store = createMemoryProfileStore({ initial: profileWith(0) });
    const first = await recordAchievements(
      store,
      [
        { id: 'ach_a', points: 5 },
        { id: 'ach_b', points: 10, progress: { cur: 100, goal: 100 } },
      ],
      1000,
    );
    expect(first).toBe(2);
    expect((await store.load()).points).toBe(15);
    const second = await recordAchievements(store, [{ id: 'ach_a', points: 5 }], 2000);
    expect(second).toBe(0);
    const profile = await store.load();
    expect(profile.points).toBe(15);
    expect(profile.achievements['ach_b']?.progress).toEqual({ cur: 100, goal: 100 });
  });
});
