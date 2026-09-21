import { describe, expect, it } from 'vitest';
import { createRng, type AchievementDef, type GameId } from '@game/shared';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { newGameState } from '../../src/state/index.js';
import { GameRuntime } from '../../src/runtime/index.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import { AchievementEvaluator } from '../../src/achievements/evaluator.js';
import { createMemoryProfileStore, recordAchievements } from '../../src/achievements/profile.js';

/**
 * A3 边界测试（18 号子任务 9）：**回滚不回滚成就**（FR-READ-03 解耦）。
 *
 * 设计口径（§5.4 / FR-READ-03）：
 * - 成就解锁走 **Profile（宿主侧持久化）**，不随存档回滚——回滚恢复 GameState，
 *   而 Profile 是跨存档的独立存储；
 * - 因此「解锁 → 回滚状态 → 成就仍在」是正确行为；本测试锁定该解耦：
 *   同一状态重新评估时，评估器仍会报「达成」，但 `recordAchievements` 幂等
 *   不入账（Profile 已有记录）——两者共同保证「回滚不撤销成就、也不重复加分」。
 */

const ACHIEVEMENTS = new Map<GameId, AchievementDef>([
  [
    'ach_flag',
    { id: 'ach_flag', nameKey: 'ach.flag.name', when: 'flag.done', points: 15, type: 'normal' },
  ],
]);

const REFS = new Map<string, ReadonlySet<GameId>>([['flag.done', new Set(['ach_flag'])]]);

function makeEvaluator() {
  return new AchievementEvaluator({
    achievements: ACHIEVEMENTS,
    refs: REFS,
    functionRegistry: createBuiltinFunctionRegistry(),
    rng: createRng(7),
  });
}

function makeRuntime() {
  const state = newGameState(
    {
      versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
      attrs: { hp: 30 },
    },
    createRng(1),
  );
  return new GameRuntime({
    state,
    rng: createRng(7),
    effectExecutor: createBuiltinEffectRegistry(),
  });
}

describe('18-A3 回滚与成就解耦（FR-READ-03）', () => {
  it('回滚状态后重新评估仍报达成，但 Profile 入账幂等（不重复加分）', async () => {
    const runtime = makeRuntime();
    const evaluator = makeEvaluator();
    const store = createMemoryProfileStore();

    // 1. 触发条件 → 评估达成 → 宿主入账
    runtime.checkpoint('before_flag');
    runtime.exec([{ flag: { name: 'done' } }], {
      source: 'choice',
      where: { scene: 'test' },
      rng: createRng(1),
    });
    const first = evaluator.evaluateTouched(runtime.state, ['world.flags.done'], new Set());
    expect(first).toEqual([{ id: 'ach_flag', points: 15 }]);
    await recordAchievements(store, first, 1000);
    expect((await store.load()).points).toBe(15);

    // 2. 回滚到触发前（状态树恢复）
    runtime.rollback(1);
    expect(runtime.state.world.flags['done']).toBeUndefined();

    // 3. 成就仍在 Profile（回滚不撤销跨存档收集）——以已解锁集合注入评估器
    const profile = await store.load();
    const unlockedNow = new Set(Object.keys(profile.achievements));
    expect(unlockedNow.has('ach_flag')).toBe(true);
    expect(evaluator.evaluateTouched(runtime.state, ['world.flags.done'], unlockedNow)).toEqual([]);

    // 4. 再次触发同一条件：评估器报达成，但 recordAchievements 幂等（点数不变）
    runtime.exec([{ flag: { name: 'done' } }], {
      source: 'choice',
      where: { scene: 'test' },
      rng: createRng(1),
    });
    const again = evaluator.all(runtime.state, new Set()); // 模拟宿主未持有解锁集合
    expect(again).toEqual([{ id: 'ach_flag', points: 15 }]);
    const recorded = await recordAchievements(store, again, 2000);
    expect(recorded).toBe(0); // 幂等：不入账
    expect((await store.load()).points).toBe(15); // 点数不重复
  });

  it('回滚后未解锁条件不误报（评估只看当前状态）', () => {
    const runtime = makeRuntime();
    const evaluator = makeEvaluator();
    runtime.checkpoint('x');
    runtime.exec([{ flag: { name: 'done' } }], {
      source: 'choice',
      where: { scene: 'test' },
      rng: createRng(1),
    });
    runtime.rollback(1);
    expect(evaluator.evaluateTouched(runtime.state, ['world.flags.done'], new Set())).toEqual([]);
  });
});
