import { describe, expect, it } from 'vitest';
import { EngineError, createRng } from '@game/shared';
import { newGameState } from '../../src/state/index.js';
import { GameRuntime } from '../../src/runtime/index.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import { createScriptHost, findFlowInstruction, HookRegistry, hookRegistrarFor } from '../../src/scripts/host.js';

/**
 * 阶段六 S0 测试（23 号子任务 1/6）：ScriptHost 事务边界 + 钩子注册表。
 *
 * 口径（2026-09-25 裁定）：
 * - `transaction` 返回 `{events, patches}`，**不含 jumps**；
 * - 脚本提交流程指令（goto/back/ending/loop_transition）→ SCRIPT_CONTRACT；
 * - 钩子按注册序触发；单个 handler 抛错只记诊断、不阻断后续。
 */

function makeRuntime() {
  const state = newGameState(
    {
      versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
      attrs: { hp: 30, insight: 0 },
    },
    createRng(1),
  );
  return new GameRuntime({
    state,
    rng: createRng(7),
    effectExecutor: createBuiltinEffectRegistry(),
  });
}

describe('23-S0 ScriptHost.transaction（脚本唯一状态入口）', () => {
  it('提交状态效果：真实入账 + 返回 events/patches（不含 jumps）', () => {
    const runtime = makeRuntime();
    const host = createScriptHost({ runtime });
    const result = host.transaction([{ set: { key: 'attr.insight', value: 5 } }]);
    expect(runtime.state.player.attrs['insight']).toBe(5);
    expect(result.patches.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('jumps'); // 返回面不含 jumps（裁定）
  });

  it('原子性：批次中任一指令失败 → 整批回滚（脚本事务与游戏事务同款）', () => {
    const runtime = makeRuntime();
    const host = createScriptHost({ runtime });
    expect(() =>
      host.transaction([
        { set: { key: 'attr.insight', value: 9 } },
        { money: { town_silver: -999 } }, // 余额不足 → 失败
      ]),
    ).toThrowError();
    expect(runtime.state.player.attrs['insight']).toBe(0); // 已回滚
  });

  it('**拒绝流程指令**：goto/back/ending/loop_transition → SCRIPT_CONTRACT', () => {
    const runtime = makeRuntime();
    const host = createScriptHost({ runtime });
    for (const effects of [
      [{ goto: 'market_street' }],
      [{ back: null }],
      [{ ending: 'quiet_town' }],
      [{ loop_transition: null }],
    ]) {
      expect(() => host.transaction(effects as never), JSON.stringify(effects)).toThrowError(
        EngineError,
      );
      try {
        host.transaction(effects as never);
      } catch (error) {
        expect((error as EngineError).code).toBe('SCRIPT_CONTRACT');
      }
    }
  });

  it('拒绝穿透分支子效果：check 的 onSuccess 里写 goto 同样被拦', () => {
    const runtime = makeRuntime();
    const host = createScriptHost({ runtime });
    expect(() =>
      host.transaction([
        {
          check: {
            value: '10',
            onSuccess: [{ goto: 'market_street' }],
          },
        },
      ] as never),
    ).toThrowError(/SCRIPT_CONTRACT|不得提交/);
  });

  it('findFlowInstruction：纯状态批次返回 null；嵌套检测正确', () => {
    expect(findFlowInstruction([{ set: { key: 'attr.hp', value: 1 } }])).toBeNull();
    expect(
      findFlowInstruction([{ check: { value: '1', onFail: [{ ending: 'x' }] } } as never]),
    ).toBe('ending');
  });
});

describe('23-S0 HookRegistry（注册序 + 错误隔离）', () => {
  it('按注册序触发；多 handler 各自独立事务', () => {
    const runtime = makeRuntime();
    const host = createScriptHost({ runtime });
    const registry = new HookRegistry();
    const order: string[] = [];
    registry.register('script_a', 'slot_advance', () => {
      order.push('a');
      return [{ add: { key: 'attr.insight', amount: 1 } }];
    });
    registry.register('script_b', 'slot_advance', () => {
      order.push('b');
      return [{ add: { key: 'attr.insight', amount: 10 } }];
    });

    const committed = registry.fire(host, { hook: 'slot_advance' });
    expect(order).toEqual(['a', 'b']); // 注册序
    expect(committed).toBe(2);
    expect(runtime.state.player.attrs['insight']).toBe(11); // 两者都入账
  });

  it('错误隔离：单个 handler 抛错只记诊断，后续 handler 照常执行', () => {
    const runtime = makeRuntime();
    const host = createScriptHost({ runtime });
    const registry = new HookRegistry();
    registry.register('bad', 'day_rollover', () => {
      throw new Error('脚本内部错误');
    });
    registry.register('good', 'day_rollover', () => [{ set: { key: 'flag.survived', value: true } }]);

    registry.fire(host, { hook: 'day_rollover' });
    expect(runtime.state.world.flags['survived']).toBe(true); // 后续 handler 未受影响
    expect(registry.diagnostics()).toHaveLength(1);
    expect(registry.diagnostics()[0]?.scriptId).toBe('bad');
    expect(registry.diagnostics()[0]?.error.message).toBe('脚本内部错误');
  });

  it('handler 返回空/undefined：不产生事务，committed 为 0', () => {
    const runtime = makeRuntime();
    const host = createScriptHost({ runtime });
    const registry = new HookRegistry();
    registry.register('noop', 'load_complete', () => undefined);
    registry.register('empty', 'load_complete', () => []);
    expect(registry.fire(host, { hook: 'load_complete' })).toBe(0);
    expect(registry.diagnostics()).toHaveLength(0);
  });

  it('未注册的钩子触发：零 handler，无诊断', () => {
    const runtime = makeRuntime();
    const host = createScriptHost({ runtime });
    const registry = new HookRegistry();
    expect(registry.fire(host, { hook: 'battle_round_end' })).toBe(0);
    expect(registry.registeredHooks()).toEqual([]);
  });

  it('hookRegistrarFor：绑定模块 id 的注册函数', () => {
    const registry = new HookRegistry();
    const register = hookRegistrarFor(registry, 'x.my_script');
    register('loop_transition', () => undefined);
    expect(registry.count('loop_transition')).toBe(1);
  });
});
