import { describe, expect, it } from 'vitest';
import { createRng, type AchievementDef, type GameId } from '@game/shared';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { newGameState } from '../../src/state/index.js';
import { AchievementEvaluator } from '../../src/achievements/evaluator.js';

/**
 * A1 测试（18 号子任务 1/2/8）：评估器增量/全量、progress 投影、隐藏成就、收集率。
 *
 * 脏标记口径与任务系统同款（§4.5）：条件 refs 命中 touched 前缀才求值；
 * touched 为空短路（行为级证明不轮询）。
 */

const ACHIEVEMENTS = new Map<GameId, AchievementDef>([
  [
    'ach_first_blood',
    {
      id: 'ach_first_blood',
      nameKey: 'ach.first.name',
      when: 'flag.won_battle',
      points: 5,
      type: 'normal',
    },
  ],
  [
    'ach_explorer',
    {
      id: 'ach_explorer',
      nameKey: 'ach.explorer.name',
      when: 'attr.insight >= 5',
      points: 10,
      type: 'normal',
    },
  ],
  [
    'ach_rich',
    {
      id: 'ach_rich',
      nameKey: 'ach.rich.name',
      when: 'wallet.town_silver >= 100',
      points: 20,
      type: 'progress',
      progressExpr: 'wallet.town_silver',
      goal: 100,
    },
  ],
  [
    'ach_secret',
    {
      id: 'ach_secret',
      nameKey: 'ach.secret.name',
      when: 'flag.secret_found',
      points: 50,
      type: 'hidden',
    },
  ],
]);

/** 反查表（refPath → 成就 id 集；与 loader compile 同形） */
const REFS = new Map<string, ReadonlySet<GameId>>([
  ['flag.won_battle', new Set(['ach_first_blood'])],
  ['attr.insight', new Set(['ach_explorer'])],
  ['wallet.town_silver', new Set(['ach_rich'])],
  ['flag.secret_found', new Set(['ach_secret'])],
]);

function makeEvaluator() {
  return new AchievementEvaluator({
    achievements: ACHIEVEMENTS,
    refs: REFS,
    functionRegistry: createBuiltinFunctionRegistry(),
    rng: createRng(7),
  });
}

function makeState() {
  const state = newGameState(
    {
      versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
      attrs: { hp: 30, insight: 0 },
    },
    createRng(1),
  );
  // wallet 为封闭域：新档需播种货币键（与宿主 bootstrap 同口径）
  state.player.wallet['town_silver'] = 0;
  return state;
}

describe('18-A1 evaluateTouched：增量评估（FR-ACHV-02）', () => {
  it('touched 命中条件路径 → 求值并解锁', () => {
    const evaluator = makeEvaluator();
    const state = makeState();
    state.world.flags['won_battle'] = true;
    const unlocked = evaluator.evaluateTouched(state, ['world.flags.won_battle'], new Set());
    expect(unlocked).toEqual([{ id: 'ach_first_blood', points: 5 }]);
  });

  it('touched 未命中 → 不求值（脏标记精确）', () => {
    const evaluator = makeEvaluator();
    const state = makeState();
    state.world.flags['won_battle'] = true; // 条件已达成，但 touched 不含该路径
    expect(evaluator.evaluateTouched(state, ['player.attrs.hp'], new Set())).toEqual([]);
  });

  it('touched 为空数组 → 短路（零求值，行为级不轮询）', () => {
    const evaluator = makeEvaluator();
    const state = makeState();
    state.world.flags['won_battle'] = true;
    expect(evaluator.evaluateTouched(state, [], new Set())).toEqual([]);
  });

  it('已解锁的成就不再产出（单调：已解锁集合由宿主注入）', () => {
    const evaluator = makeEvaluator();
    const state = makeState();
    state.world.flags['won_battle'] = true;
    expect(
      evaluator.evaluateTouched(state, ['world.flags.won_battle'], new Set(['ach_first_blood'])),
    ).toEqual([]);
  });

  it('attr 条件命中 player.attrs 与 player.derived 双前缀（派生属性机制）', () => {
    const evaluator = makeEvaluator();
    const state = makeState();
    state.player.attrs['insight'] = 6;
    expect(evaluator.evaluateTouched(state, ['player.attrs.insight'], new Set())).toEqual([
      { id: 'ach_explorer', points: 10 },
    ]);
    expect(evaluator.evaluateTouched(state, ['player.derived.insight'], new Set())).toEqual([
      { id: 'ach_explorer', points: 10 },
    ]);
  });
});

describe('18-A1 all：全量评估（每时段兜底）', () => {
  it('遍历全部成就，返回所有达成且未解锁者', () => {
    const evaluator = makeEvaluator();
    const state = makeState();
    state.world.flags['won_battle'] = true;
    state.world.flags['secret_found'] = true;
    const unlocked = evaluator.all(state, new Set());
    expect(unlocked.map((entry) => entry.id).sort()).toEqual(['ach_first_blood', 'ach_secret']);
  });

  it('progress 型达成时携带终态进度快照（FR-ACHV-01）', () => {
    const evaluator = makeEvaluator();
    const state = makeState();
    state.player.wallet['town_silver'] = 150;
    const unlocked = evaluator.all(state, new Set());
    expect(unlocked).toContainEqual({
      id: 'ach_rich',
      points: 20,
      progress: { cur: 100, goal: 100 },
    });
  });
});

describe('18-A1 progressOf：进度投影（进度条数据源）', () => {
  it('progress 型返回 cur/goal（cur 封顶 goal），未达成 unlocked=false', () => {
    const evaluator = makeEvaluator();
    const state = makeState();
    state.player.wallet['town_silver'] = 30;
    expect(evaluator.progressOf(state, 'ach_rich')).toEqual({
      id: 'ach_rich',
      cur: 30,
      goal: 100,
      unlocked: false,
    });
  });

  it('非 progress 型返回 null', () => {
    const evaluator = makeEvaluator();
    expect(evaluator.progressOf(makeState(), 'ach_first_blood')).toBeNull();
  });
});

describe('18-A1 gallery：图鉴投影（FR-ACHV-04 隐藏成就）', () => {
  it('hidden 未解锁 → 仅占位（不下发 nameKey，不暴露存在性以外信息）', () => {
    const evaluator = makeEvaluator();
    const gallery = evaluator.gallery(makeState(), new Set());
    const secret = gallery.find((entry) => entry.id === 'ach_secret');
    expect(secret).toEqual({ id: 'ach_secret', hidden: true, unlocked: false, points: 50 });
    expect(secret?.nameKey).toBeUndefined();
  });

  it('hidden 已解锁 → 正常展示（nameKey 下发）', () => {
    const evaluator = makeEvaluator();
    const gallery = evaluator.gallery(makeState(), new Set(['ach_secret']));
    expect(gallery.find((entry) => entry.id === 'ach_secret')?.nameKey).toBe('ach.secret.name');
  });

  it('progress 型在图鉴中携带进度投影', () => {
    const evaluator = makeEvaluator();
    const gallery = evaluator.gallery(makeState(), new Set());
    expect(gallery.find((entry) => entry.id === 'ach_rich')?.progress).toMatchObject({
      cur: 0,
      goal: 100,
    });
  });

  it('收集率：含隐藏项在分母内', () => {
    const evaluator = makeEvaluator();
    expect(evaluator.collectionRate(new Set())).toEqual({ unlocked: 0, total: 4, rate: 0 });
    expect(evaluator.collectionRate(new Set(['ach_rich', 'ach_secret']))).toEqual({
      unlocked: 2,
      total: 4,
      rate: 0.5,
    });
  });
});
