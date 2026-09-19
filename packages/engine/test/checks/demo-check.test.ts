import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import { newGameState } from '../../src/state/index.js';
import { loadFixturePackage } from '../loader/fs-source.js';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import { BASE_VERSIONS } from '../effects/fixtures.js';
import type { ExecContext } from '../../src/runtime/exec-context.js';

/**
 * demo 检定端到端（15 号 commit 8）：mini-game 夹具山道口的 read_marks 检定，
 * 经**真实加载管线**（loadFixturePackage → 冻结注册表，内置解析链生效）执行——
 * 验证「数据里的 check → coc 规则 → 分支效果」在官方 demo 内容里真实可用。
 */

/** 队列 Rng 桩（与 coc.test.ts 同款；这里固定 d100 的 [十位, 个位]） */
function queueRng(dice: number[]) {
  const queue = [...dice];
  return {
    next: () => {
      throw new Error('not used');
    },
    int: (minIncl: number) => {
      const value = queue.shift();
      if (value === undefined) throw new Error('queue exhausted');
      if (value < minIncl) throw new Error(`out of range: ${value}`);
      return value;
    },
    pick: () => {
      throw new Error('not used');
    },
    weighted: () => {
      throw new Error('not used');
    },
    chance: () => {
      throw new Error('not used');
    },
    getState: () => 0,
    setState: () => {},
    fork: () => queueRng(queue),
  } as unknown as import('@game/shared').Rng;
}

/** 构造带 insight 属性的运行时（effectExecutor 用夹具冻结注册表） */
async function makeFixtureRuntime(insight: number, dice: number[]) {
  const definition = await loadFixturePackage('mini-game');
  const state = newGameState(
    { versions: BASE_VERSIONS, attrs: { hp: 100, stamina: 30, insight } },
    createRng(1),
  );
  const rt = new GameRuntime({
    state,
    rng: createRng(1),
    effectExecutor: definition.effectRegistry,
  });
  const scene = definition.scenes.get('hillside_trailhead');
  if (scene === undefined) throw new Error('hillside_trailhead 缺失');
  const choice = scene.def.choices.find((entry) => entry.id === 'read_marks');
  if (choice === undefined) throw new Error('read_marks 选项缺失（检定入口未接入）');
  const ctx: ExecContext = {
    source: 'choice',
    where: { scene: 'hillside_trailhead' },
    rng: queueRng(dice),
  };
  return { rt, choice, ctx };
}

describe('demo 检定端到端：hillside_trailhead#read_marks（15 号 commit 8）', () => {
  it('insight 10 → 技能 50：roll 5 命中大成功线 → 成功分支解锁采石场', async () => {
    const { rt, choice, ctx } = await makeFixtureRuntime(10, [0, 5]); // roll 5 ≤ 50
    const outcome = rt.exec(choice.effects ?? [], ctx);
    expect(rt.state.world.flags['quarry_open']).toBe(true);
    // check_result 之外，成功分支的 notify 也产生一条事件
    expect(outcome.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'check_result', rule: 'coc', level: 'critical' }),
      ]),
    );
  });

  it('insight 0 → 技能 0：任何 roll 都失败 → 失败分支只通知、不解锁', async () => {
    const { rt, choice, ctx } = await makeFixtureRuntime(0, [3, 7]);
    const outcome = rt.exec(choice.effects ?? [], ctx);
    expect(rt.state.world.flags['quarry_open']).toBeUndefined();
    expect(outcome.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'check_result', rule: 'coc', outcome: 'fail' }),
      ]),
    );
  });
});
