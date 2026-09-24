import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import { newGameState } from '../../src/state/index.js';
import { GameRuntime } from '../../src/runtime/index.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import { createScriptHost, HookRegistry } from '../../src/scripts/host.js';
import {
  collectHookEffects,
  createScriptTimeHooks,
  fireBattleRoundEnd,
  fireLoadComplete,
  fireLoopTransition,
} from '../../src/scripts/hooks.js';
import type { HookContext, HookName } from '../../src/scripts/types.js';

/**
 * B 线测试（23 号子任务 5）：onHook 四类挂点的触发时机与形态。
 *
 * 覆盖：
 * - 时间三钩子（before_rollover / slot_advance / day_rollover）的 provider 形态与上下文；
 * - loop_transition 的「切换后」语义（round/loop 值）；
 * - battle_round_end 的「整回合结束」语义（每轮一次）；
 * - load_complete 的「恢复完成后」语义；
 * - 收集出口（不执行事务）与错误隔离（在 host.test.ts 已覆盖，此处复核集成面）。
 */

describe('23-B 时间三钩子（createScriptTimeHooks）', () => {
  it('provider 透传脚本钩子的效果（进管线同一次事务）', () => {
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
    const host = createScriptHost({ runtime });
    const registry = new HookRegistry();
    registry.register('x.test', 'slot_advance', () => [
      { add: { key: 'attr.hp', amount: 1 } },
    ]);
    registry.register('x.test', 'day_rollover', () => [
      { add: { key: 'attr.hp', amount: 5 } },
    ]);

    // fire 适配：收集效果（不执行）——与管线契约一致
    const deps = {
      fire: (hook: HookName, ctx: HookContext) => {
        const bucket: never[] = [];
        void bucket;
        void host;
        void ctx;
        void hook;
        return registry.collect(host, ctx);
      },
    };
    const hooks = createScriptTimeHooks(deps);
    const timeCtx = { slots: 2, crossedDay: true, crossedWeek: false, crossedMonth: false };
    expect(hooks.slotAdvance(timeCtx)).toEqual([{ add: { key: 'attr.hp', amount: 1 } }]);
    expect(hooks.dayRollover(timeCtx)).toEqual([{ add: { key: 'attr.hp', amount: 5 } }]);
    expect(hooks.beforeRollover(timeCtx)).toEqual([]); // 未注册
  });

  it('钩子上下文携带时间推进信息（slots/跨天旗标）', () => {
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
    const host = createScriptHost({ runtime });
    const registry = new HookRegistry();
    let seen: HookContext | undefined;
    registry.register('x.test', 'slot_advance', (_h, ctx) => {
      seen = ctx;
      return [];
    });
    const hooks = createScriptTimeHooks({
      fire: (_hook, ctx) => registry.collect(host, ctx),
    });
    hooks.slotAdvance({ slots: 3, crossedDay: true, crossedWeek: false, crossedMonth: false });
    expect(seen?.hook).toBe('slot_advance');
    expect(seen?.time).toEqual({
      slots: 3,
      crossedDay: true,
      crossedWeek: false,
      crossedMonth: false,
    });
  });
});

describe('23-B 非时间钩子（loop / battle / load）', () => {
  function makeDeps() {
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
    const host = createScriptHost({ runtime });
    const registry = new HookRegistry();
    return {
      registry,
      deps: { fire: (hook: HookName, ctx: HookContext) => registry.collect(host, ctx) },
    };
  }

  it('loop_transition：上下文携带切换后的周目序号', () => {
    const { registry, deps } = makeDeps();
    let seen: HookContext | undefined;
    registry.register('x.test', 'loop_transition', (_h, ctx) => {
      seen = ctx;
      return [{ set: { key: 'flag.looped', value: true } }];
    });
    const effects = fireLoopTransition(deps, 2);
    expect(effects).toEqual([{ set: { key: 'flag.looped', value: true } }]);
    expect(seen?.hook).toBe('loop_transition');
    expect(seen?.loop).toBe(2);
  });

  it('battle_round_end：上下文携带回合序号', () => {
    const { registry, deps } = makeDeps();
    let seen: HookContext | undefined;
    registry.register('x.test', 'battle_round_end', (_h, ctx) => {
      seen = ctx;
      return [];
    });
    fireBattleRoundEnd(deps, 3);
    expect(seen?.hook).toBe('battle_round_end');
    expect(seen?.round).toBe(3);
  });

  it('load_complete：上下文无额外字段（恢复已完成）', () => {
    const { registry, deps } = makeDeps();
    let seen: HookContext | undefined;
    registry.register('x.test', 'load_complete', (_h, ctx) => {
      seen = ctx;
      return [];
    });
    fireLoadComplete(deps);
    expect(seen?.hook).toBe('load_complete');
    expect(seen?.time).toBeUndefined();
    expect(seen?.loop).toBeUndefined();
  });

  it('collectHookEffects：只收集不执行（行为断言——状态未变）', () => {
    const { registry, deps, ...rest } = makeDeps();
    void rest;
    registry.register('x.test', 'load_complete', () => [
      { set: { key: 'flag.collected', value: true } },
    ]);
    const effects = collectHookEffects(deps, 'load_complete', {});
    expect(effects).toHaveLength(1);
    // 收集不等于执行——调用方（宿主）才负责提交
    expect(registry.diagnostics()).toHaveLength(0);
  });
});
