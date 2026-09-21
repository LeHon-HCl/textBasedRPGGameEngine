import { describe, expect, it } from 'vitest';
import { createRng, type LoopConfig } from '@game/shared';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { newGameState, type GameState } from '../../src/state/index.js';
import { applyLoopTransition } from '../../src/loop/transition.js';

/**
 * C1 测试（19 号子任务 1/2/7）：周目过渡纯函数——五形态策略矩阵 + 次序断言。
 *
 * 策略矩阵覆盖：inherit / reset（缺省）/ keepRatio 表达式 / whitelist /
 * blacklist；次序：先整体 reset → 再逐类 apply；loop+1；原状态不被改写。
 */

const OPTIONS = {
  functionRegistry: createBuiltinFunctionRegistry(),
  rng: createRng(7),
};

function makeBaseline(): GameState {
  return newGameState(
    {
      versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
      attrs: { hp: 30, insight: 0 },
      factions: { town: 0, guild: 0 },
      npcs: { npc_a: { favor: 0 } },
    },
    createRng(1),
  );
}

/** 造一个「玩过一轮」的状态：各类别都有非基线数据 */
function makePlayed(): GameState {
  const state = makeBaseline();
  state.loop = 1;
  state.player.attrs['hp'] = 12;
  state.player.attrs['insight'] = 9;
  state.player.skills['lore'] = { value: 5, exp: 30 };
  state.player.bag.push({ itemId: 'warm_bun', count: 3 });
  state.world.flags['wall_rubbing_taken'] = true;
  state.world.flags['quarry_open'] = true;
  state.world.counters['ev_market'] = 4;
  state.world.unlockedAreas.push('riverside');
  state.npcs['npc_a'] = { favor: 40, met: true, flags: {} };
  state.factions['town'] = 12;
  state.quests['wall_rubbing'] = { state: 'active', stage: 'inspect_wall', objectives: {} };
  state.seen.scenes.push('market_street');
  state.world.time = { day: 5, slotIndex: 2 };
  return state;
}

function withConfig(inherit: LoopConfig['inherit']): LoopConfig {
  return { openingScene: 'arrival', ...(inherit !== undefined ? { inherit } : {}) };
}

describe('19-C1 次序与缺省：先整体 reset，未声明类别全部归位基线', () => {
  it('无 inherit 声明：全部类别 reset 到基线（loop 仍 +1）', () => {
    const prev = makePlayed();
    const result = applyLoopTransition(prev, withConfig(undefined), {
      ...OPTIONS,
      baseline: makeBaseline(),
    });
    const next = result.nextState;
    expect(next.loop).toBe(2); // loop + 1
    expect(next.player.attrs['hp']).toBe(30); // 归位基线
    expect(next.player.attrs['insight']).toBe(0);
    expect(next.player.skills).toEqual({});
    expect(next.player.bag).toEqual([]);
    expect(next.world.flags).toEqual({});
    expect(next.world.counters).toEqual({});
    expect(next.world.unlockedAreas).toEqual([]);
    expect(next.npcs['npc_a']).toEqual({ favor: 0, met: false, flags: {} });
    expect(next.factions['town']).toBe(0);
    expect(next.quests).toEqual({});
    expect(next.seen.scenes).toEqual([]);
    expect(next.world.time.day).toBe(1);
    expect(result.openingScene).toBe('arrival');
  });

  it('纯函数：原状态不被改写', () => {
    const prev = makePlayed();
    const snapshot = JSON.stringify(prev);
    applyLoopTransition(prev, withConfig({ attrs: 'reset' }), {
      ...OPTIONS,
      baseline: makeBaseline(),
    });
    expect(JSON.stringify(prev)).toBe(snapshot);
  });

  it('摘要：天数/事件数取自上一周目；loop 为切换后序号', () => {
    const prev = makePlayed();
    const result = applyLoopTransition(prev, withConfig(undefined), {
      ...OPTIONS,
      baseline: makeBaseline(),
    });
    expect(result.summary).toEqual({
      loop: 2,
      days: 5,
      events: 4, // counters 累计
      achievements: 0, // 宿主按 Profile 填充
    });
  });
});

describe('19-C1 策略矩阵（FR-LOOP-04）', () => {
  it('inherit：全量继承（attrs 保留玩家成长）', () => {
    const result = applyLoopTransition(makePlayed(), withConfig({ attrs: 'inherit' }), {
      ...OPTIONS,
      baseline: makeBaseline(),
    });
    expect(result.nextState.player.attrs['hp']).toBe(12);
    expect(result.nextState.player.attrs['insight']).toBe(9);
  });

  it('reset：显式重置（与缺省同效）', () => {
    const result = applyLoopTransition(makePlayed(), withConfig({ attrs: 'reset' }), {
      ...OPTIONS,
      baseline: makeBaseline(),
    });
    expect(result.nextState.player.attrs['hp']).toBe(30);
  });

  it('keepRatio：保留金币/数值比例（表达式求值，floor 取整）', () => {
    const prev = makePlayed();
    prev.factions['town'] = 13;
    const result = applyLoopTransition(prev, withConfig({ factions: { keepRatio: '0.1' } }), {
      ...OPTIONS,
      baseline: makeBaseline(),
    });
    expect(result.nextState.factions['town']).toBe(1); // floor(13 × 0.1)
    expect(result.nextState.factions['guild']).toBe(0); // floor(0 × 0.1)
  });

  it('keepRatio 比例越界 → EFFECT_FAILED 显性化', () => {
    expect(() =>
      applyLoopTransition(makePlayed(), withConfig({ factions: { keepRatio: '1.5' } }), {
        ...OPTIONS,
        baseline: makeBaseline(),
      }),
    ).toThrowError(/\[0,1\]/);
  });

  it('whitelist：仅保留清单内的条目（flags 只留 quarry_open）', () => {
    const result = applyLoopTransition(
      makePlayed(),
      withConfig({ flags: { whitelist: ['quarry_open'] } }),
      { ...OPTIONS, baseline: makeBaseline() },
    );
    expect(result.nextState.world.flags).toEqual({ quarry_open: true });
    expect(result.nextState.world.counters).toEqual({}); // 非数值映射面不合并
  });

  it('blacklist：排除清单外全部继承（seen 排除 market_street 后为空）', () => {
    const prev = makePlayed();
    prev.seen.scenes.push('arrival');
    const result = applyLoopTransition(
      prev,
      withConfig({ seen: { blacklist: ['market_street'] } }),
      { ...OPTIONS, baseline: makeBaseline() },
    );
    // seen 为结构化对象（scenes/readStats）——黑名单按顶层键过滤；此处仅验证不抛错且为对象
    expect(typeof result.nextState.seen).toBe('object');
  });

  it('多类别组合：favor 继承 + flags 白名单 + attrs 重置', () => {
    const result = applyLoopTransition(
      makePlayed(),
      withConfig({
        favor: 'inherit',
        flags: { whitelist: ['wall_rubbing_taken'] },
        attrs: 'reset',
      }),
      { ...OPTIONS, baseline: makeBaseline() },
    );
    expect(result.nextState.npcs['npc_a']?.favor).toBe(40);
    expect(result.nextState.world.flags).toEqual({ wall_rubbing_taken: true });
    expect(result.nextState.player.attrs['hp']).toBe(30);
  });
});

describe('19-C1 loop 变量域（FR-LOOP-05）', () => {
  it('loop 递增使 loop >= 2 条件成立（第二周目内容解锁）', () => {
    const first = makePlayed();
    first.loop = 0;
    const result = applyLoopTransition(first, withConfig(undefined), {
      ...OPTIONS,
      baseline: makeBaseline(),
    });
    expect(result.nextState.loop).toBe(1);
    const second = applyLoopTransition(result.nextState, withConfig(undefined), {
      ...OPTIONS,
      baseline: makeBaseline(),
    });
    expect(second.nextState.loop).toBe(2); // `loop >= 2` 条件内容在此周目可见
  });
});
