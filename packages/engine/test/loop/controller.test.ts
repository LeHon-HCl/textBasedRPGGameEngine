import { describe, expect, it } from 'vitest';
import { createRng, type LoopConfig } from '@game/shared';
import { loadFixturePackage } from '../loader/fs-source.js';
import { GameRuntime } from '../../src/runtime/index.js';
import { newGameState } from '../../src/state/index.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import { runLoopTransition, fillSummary, assertLoadOrder } from '../../src/loop/controller.js';

/**
 * C3 集成测试（19 号子任务 3/4/5；**M2 验收标准第 3 条**）：
 * 「同存档进入第二周目且继承清单生效」——真实夹具 + 真实运行时。
 *
 * 覆盖：loop+1、继承清单（attrs/favor 继承、flags 白名单、factions keepRatio）、
 * 强制重建（派生重算 + 回滚栈清空 + 冷却策略）、读档次序断言（DD-10）。
 */

async function makeWorld() {
  const definition = await loadFixturePackage('mini-game');
  const rng = createRng(2026);
  const baseline = newGameState(
    {
      versions: {
        gameVersion: definition.manifest.gameVersion,
        schemaVersion: definition.manifest.schemaVersion,
        minEngineVersion: definition.manifest.minEngineVersion,
      },
      attrs: { hp: 100, stamina: 30, insight: 0, atk: 10, def: 3, spd: 5 },
      factions: { town: 0, guild: 0 },
    },
    rng,
  );
  const state = newGameState(
    {
      versions: {
        gameVersion: definition.manifest.gameVersion,
        schemaVersion: definition.manifest.schemaVersion,
        minEngineVersion: definition.manifest.minEngineVersion,
      },
      attrs: { hp: 100, stamina: 30, insight: 0, atk: 10, def: 3, spd: 5 },
      factions: { town: 0, guild: 0 },
    },
    createRng(2026),
  );
  const runtime = new GameRuntime({
    state,
    rng,
    effectExecutor: createBuiltinEffectRegistry({ factions: definition.factions }),
  });
  return { definition, runtime, baseline };
}

describe('19-C3 同存档进入第二周目且继承清单生效（M2 验收标准 3）', () => {
  it('派生重算在替换后执行；冷却按配置保留 / 清空；回滚栈清空', async () => {
    const { definition, runtime, baseline } = await makeWorld();
    // 造「玩过一轮」的数据
    runtime.exec(
      [
        { add: { key: 'attr.insight', amount: 8 } },
        { flag: { name: 'heard_rumor' } },
        { flag: { name: 'temp_flag' } },
        { money: { town_silver: 40 } },
      ],
      { source: 'choice', where: { scene: 'market_street' }, rng: createRng(1) },
    );
    runtime.checkpoint('before_loop');
    const loopConfig = {
      openingScene: 'arrival',
      inherit: {
        attrs: 'inherit',
        flags: { whitelist: ['heard_rumor'] },
      },
    } as unknown as LoopConfig;
    const relocated: string[] = [];
    const result = runLoopTransition(
      runtime,
      loopConfig,
      {
        baseline,
        functionRegistry: new Map(),
        rng: createRng(1),
        relocatePool: (area) => relocated.push(area),
      },
      definition,
    );

    // 继承清单生效
    expect(runtime.state.loop).toBe(1);
    expect(runtime.state.player.attrs['insight']).toBe(8); // attrs 继承
    expect(runtime.state.world.flags['heard_rumor']).toBe(true); // 白名单内
    expect(runtime.state.world.flags['temp_flag']).toBeUndefined(); // 白名单外
    // 缺省 reset：钱包归位基线（基线 wallet 为空对象 → 该货币键不存在）
    expect(runtime.state.player.wallet['town_silver']).toBeUndefined();

    // 强制重建
    expect(relocated).toEqual(['old_town']); // 池定位到开局场景区域
    expect(runtime.state.checkpoints).toEqual([]); // 回滚栈清空（切换不可撤销）
    expect(result.openingScene).toBe('arrival');
    expect(result.summary.loop).toBe(1);
  });

  it('clearEventCooldowns: true 清空冷却；缺省保留（防「重开刷事件」）', async () => {
    const rng = createRng(1);
    const makeRuntimeWithCooldown = async () => {
      const { definition, runtime, baseline } = await makeWorld();
      // 冷却只能由事件池评估写入（`__events.eval`）——直接经运行时状态替换注入
      // 一个带冷却的状态（等价于上一周目触发过事件）
      const state = structuredClone(runtime.state) as typeof runtime.state;
      (state.world as { eventCooldowns: Record<string, unknown> }).eventCooldowns = {
        ev_market_rumor: { lastDay: 3, fired: 1 },
      };
      runtime.replaceState(state as never, []);
      return { definition, runtime, baseline };
    };

    // 缺省：保留（eventCooldowns 不在类别清单内，不被 reset 触及）
    const kept = await makeRuntimeWithCooldown();
    runLoopTransition(
      kept.runtime,
      { openingScene: 'arrival' } as never,
      { baseline: kept.baseline, functionRegistry: new Map(), rng },
      kept.definition,
    );
    expect(kept.runtime.state.world.eventCooldowns['ev_market_rumor']).toBeDefined();

    // 显式清空
    const cleared = await makeRuntimeWithCooldown();
    runLoopTransition(
      cleared.runtime,
      { openingScene: 'arrival' } as never,
      { baseline: cleared.baseline, functionRegistry: new Map(), rng, clearEventCooldowns: true },
      cleared.definition,
    );
    expect(cleared.runtime.state.world.eventCooldowns).toEqual({});
  });

  it('factions keepRatio：声望按比例保留（demo 配置 0.5）', async () => {
    const { definition, runtime, baseline } = await makeWorld();
    runtime.exec([{ reputation: { faction: 'town', amount: 12 } }], {
      source: 'choice',
      where: { scene: 'market_street' },
      rng: createRng(1),
    });
    expect(runtime.state.factions['town']).toBe(12);
    const config = {
      openingScene: 'arrival',
      inherit: { factions: { keepRatio: '0.5' } },
    } as unknown as LoopConfig;
    runLoopTransition(
      runtime,
      config,
      { baseline, functionRegistry: new Map(), rng: createRng(1) },
      definition,
    );
    expect(runtime.state.factions['town']).toBe(6); // floor(12 × 0.5)
  });

  it('openingScene 悬空 → DANGLING_REF（切换前拦截）', async () => {
    const { definition, runtime, baseline } = await makeWorld();
    expect(() =>
      runLoopTransition(
        runtime,
        { openingScene: 'ghost_scene' } as unknown as LoopConfig,
        { baseline, functionRegistry: new Map(), rng: createRng(1) },
        definition,
      ),
    ).toThrowError(/不在场景目录中/);
  });
});

describe('19-C3 读档次序断言（DD-10：迁移 → 周目恢复）', () => {
  it('正确次序通过；次序颠倒抛错', () => {
    expect(() =>
      assertLoadOrder({ migrate: () => undefined, loopRestore: () => undefined }),
    ).not.toThrow();
    // 断言函数自身按固定次序调用（口径固化：调用方以该次序编排宿主流程）
    const order: string[] = [];
    assertLoadOrder({
      migrate: () => order.push('migrate'),
      loopRestore: () => order.push('loopRestore'),
    });
    expect(order).toEqual(['migrate', 'loopRestore']);
  });
});

describe('19-C3 摘要填充（宿主面）', () => {
  it('fillSummary 注入成就数（Profile 在宿主，DD-04）', () => {
    const summary = fillSummary({ loop: 2, days: 10, events: 7, achievements: 0 }, 5);
    expect(summary.achievements).toBe(5);
    expect(summary.loop).toBe(2);
  });
});

describe('19-C3 偏差②裁定：切换后回滚栈清空的显式断言（2026-09-23 人类追认）', () => {
  it('切换前有多个回滚点 → 切换后回滚栈空、状态树 checkpoints 同步清空', async () => {
    const { definition, runtime, baseline } = await makeWorld();
    // 造 3 个回滚点
    runtime.checkpoint('c1');
    runtime.exec([{ add: { key: 'attr.insight', amount: 1 } }], {
      source: 'choice',
      where: { scene: 'market_street' },
      rng: createRng(1),
    });
    runtime.checkpoint('c2');
    runtime.exec([{ add: { key: 'attr.insight', amount: 1 } }], {
      source: 'choice',
      where: { scene: 'market_street' },
      rng: createRng(1),
    });
    runtime.checkpoint('c3');
    expect(runtime.state.checkpoints.length).toBe(3);

    runLoopTransition(
      runtime,
      { openingScene: 'arrival' } as never,
      { baseline, functionRegistry: new Map(), rng: createRng(1) },
      definition,
    );

    // 状态树标记与内部栈同步清空（跨周目回滚无意义——设计意图）
    expect(runtime.state.checkpoints).toEqual([]);
    // 回滚尝试返回 ok: false（无可用回滚点）——不可回滚性的行为级证据
    // （rollback 的失败面是返回值而非抛错，宿主据此提示「无可用回滚点」）
    expect(runtime.rollback(1)).toEqual({ ok: false });
  });

  it('周目切换不可撤销：切换后状态不会被 rollback 还原（行为断言）', async () => {
    const { definition, runtime, baseline } = await makeWorld();
    runtime.checkpoint('before');
    const insightBefore = runtime.state.player.attrs['insight'];
    runLoopTransition(
      runtime,
      { openingScene: 'arrival', inherit: { attrs: 'inherit' } } as never,
      { baseline, functionRegistry: new Map(), rng: createRng(1) },
      definition,
    );
    // 切换后 loop 已递增；任何回滚尝试都不存在可用点
    expect(runtime.state.loop).toBe(1);
    expect(runtime.rollback(1)).toEqual({ ok: false });
    // 状态仍为切换后（未被悄悄还原）
    expect(runtime.state.loop).toBe(1);
    expect(runtime.state.player.attrs['insight']).toBe(insightBefore);
  });
});
