import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '@game/shared';
import type { EffectData } from '@game/shared';
import { compileExpr, evalExpr, createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { buildExprScope } from '../../src/state/index.js';
import { BASE_VERSIONS, makeBuiltinRuntime, makeCtx } from '../effects/fixtures.js';

/**
 * 12 任务 4：NPC 记忆命名空间（FR-NPCR-03）。
 *
 * - 写入面：`set` / `add` 的 key 支持 `npc.<id>.flags.<name>`（独立命名空间，
 *   与 world.flags 隔离；未知 NPC 自动建档）；
 * - 读取面：表达式 `npc.<id>.flags.<name>`（显式）与 `npc.<id>.<name>`（简写，
 *   favor/stage/met 优先）映射到同一命名空间（03 号白名单既有形态）。
 */

function makeRuntime(
  npcs?: Record<string, { favor: number; flags?: Record<string, boolean | number | string> }>,
) {
  return makeBuiltinRuntime({
    bootstrap: {
      versions: BASE_VERSIONS,
      attrs: { hp: 10 },
      ...(npcs !== undefined ? { npcs } : {}),
    },
  });
}

/** 以运行时状态求值表达式（读面） */
function evalOn(rt: ReturnType<typeof makeBuiltinRuntime>['rt'], source: string): unknown {
  const registry = createBuiltinFunctionRegistry();
  const expr = compileExpr(source, registry);
  return evalExpr(expr, {
    state: buildExprScope(rt.state),
    rng: createRng(1),
    registry,
  });
}

describe('12-4 NPC 记忆写入：set / add 的 npc.<id>.flags.<name> key', () => {
  it('set 写入独立命名空间，不影响 world.flags 与 NPC 其他字段', () => {
    const { rt } = makeRuntime({ npc_raven: { favor: 5 } });
    rt.exec([{ set: { key: 'npc.npc_raven.flags.said_hi', value: true } }], makeCtx());
    expect(rt.state.npcs['npc_raven']).toMatchObject({
      favor: 5,
      met: false,
      flags: { said_hi: true },
    });
    expect(rt.state.world.flags).toEqual({});
  });

  it('set 值为表达式原文（宽松求值）：写入 number', () => {
    const { rt } = makeRuntime({ npc_raven: { favor: 0 } });
    rt.exec([{ set: { key: 'npc.npc_raven.flags.gift_count', value: '3 + 4' } }], makeCtx());
    expect(rt.state.npcs['npc_raven']?.flags['gift_count']).toBe(7);
  });

  it('add 在数字记忆上累加；未设置按 0 起算', () => {
    const { rt } = makeRuntime({ npc_raven: { favor: 0 } });
    rt.exec([{ add: { key: 'npc.npc_raven.flags.talks', amount: 2 } }], makeCtx());
    rt.exec([{ add: { key: 'npc.npc_raven.flags.talks', amount: 3 } }], makeCtx());
    expect(rt.state.npcs['npc_raven']?.flags['talks']).toBe(5);
  });

  it('未知 NPC 自动建档（favor 0 / met false），flags 命名空间可用', () => {
    const { rt } = makeRuntime();
    rt.exec([{ set: { key: 'npc.npc_ghost.flags.saw', value: true } }], makeCtx());
    expect(rt.state.npcs['npc_ghost']).toMatchObject({
      favor: 0,
      met: false,
      flags: { saw: true },
    });
  });

  it('写入 touch 声明为 npcs 前缀（迁移登记面）', () => {
    const { registry } = makeRuntime();
    expect(
      registry.lookup('set')?.touch({ key: 'npc.npc_raven.flags.x', value: 1 } as never).writes,
    ).toEqual(['npcs']);
    expect(
      registry.lookup('add')?.touch({ key: 'npc.npc_raven.flags.x', amount: 1 } as never).writes,
    ).toEqual(['npcs']);
  });

  it('非法 npc key 形态 → EFFECT_FAILED（显性化，不静默落到其他域）', () => {
    const { rt } = makeRuntime({ npc_raven: { favor: 0 } });
    for (const key of [
      'npc.npc_raven',
      'npc.npc_raven.flags',
      'npc.npc_raven.mem.x',
      'npc..flags.x',
    ]) {
      try {
        rt.exec([{ set: { key, value: 1 } } as unknown as EffectData], makeCtx());
        expect.unreachable(`key='${key}' 应当失败`);
      } catch (err) {
        const engineErr = err as EngineError;
        expect(engineErr.code).toBe('EFFECT_FAILED');
        expect((engineErr.cause as EngineError).where['key']).toBe(key);
      }
    }
  });
});

describe('12-4 NPC 记忆读取：表达式映射（显式与简写）', () => {
  it('npc.<id>.flags.<name> 与简写 npc.<id>.<name> 读同一命名空间', () => {
    const { rt } = makeRuntime({ npc_raven: { favor: 5, flags: { said_hi: true, talks: 2 } } });
    expect(evalOn(rt, 'npc.npc_raven.flags.said_hi')).toBe(true);
    expect(evalOn(rt, 'npc.npc_raven.flags.talks')).toBe(2);
    expect(evalOn(rt, 'npc.npc_raven.said_hi')).toBe(true);
    // 保留字段优先于同名 flag（简写口径）
    expect(evalOn(rt, 'npc.npc_raven.favor')).toBe(5);
  });

  it('写入后立即可读（同一存档状态，无需额外同步）', () => {
    const { rt } = makeRuntime({ npc_raven: { favor: 0 } });
    rt.exec([{ set: { key: 'npc.npc_raven.flags.met_at_gate', value: true } }], makeCtx());
    expect(evalOn(rt, 'npc.npc_raven.flags.met_at_gate')).toBe(true);
  });

  it('未设置的记忆 flag → undefined（渐进域；条件真值化为假）', () => {
    const { rt } = makeRuntime({ npc_raven: { favor: 0 } });
    expect(evalOn(rt, 'npc.npc_raven.flags.never_set')).toBeUndefined();
  });
});
