import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '@game/shared';
import type { NpcDef } from '@game/shared';
import {
  compileExpr,
  createBuiltinFunctionRegistry,
  evalCondition,
  evalExpr,
} from '../../src/expr-eval/index.js';
import { buildExprScope } from '../../src/state/index.js';
import { newGameState } from '../../src/state/new-game.js';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import { BASE_VERSIONS, makeCtx } from '../effects/fixtures.js';
import { createNpcScheduleDeriver } from '../../src/npcs/deriver.js';

/**
 * 12 任务 5：`npc.<id>.at` 缓存映射（§4.6「同地点交互条件的 O(1) 查询面」）。
 *
 * 作者以 `npc.raven.at == 'location.dock'` 表达同地点校验；`at` 读
 * world.npcLocationCache（在场者有条目），不在场 / cache 无投影 → null。
 */

const NPCS: ReadonlyMap<string, NpcDef> = new Map(
  (
    [
      {
        id: 'npc_guard',
        nameKey: 'npc.guard.name',
        schedule: [{ at: {}, location: 'gate' }],
      },
      { id: 'npc_drifter', nameKey: 'npc.drifter.name' },
    ] as NpcDef[]
  ).map((def) => [def.id, def]),
);

/** 装配带日程派生器的运行时并预热缓存（首笔事务建立基线） */
function makeWarmRuntime() {
  const registry = createBuiltinEffectRegistry({
    npcs: NPCS,
    functionRegistry: createBuiltinFunctionRegistry(),
  });
  const state = newGameState(
    {
      versions: BASE_VERSIONS,
      attrs: { hp: 10 },
      time: { day: 1, slotIndex: 0 },
      // NPC 实体为表达式封闭域：需建档才能读 npc.<id>.*（日程缓存只补 at）
      npcs: { npc_guard: { favor: 0 }, npc_drifter: { favor: 0 } },
    },
    createRng(1),
  );
  const rt = new GameRuntime({
    state,
    rng: createRng(2),
    effectExecutor: registry,
    derivers: [createNpcScheduleDeriver({ npcs: NPCS })],
  });
  // 预热：任意一笔事务触发派生器重建（缓存初始为空）
  rt.exec([{ flag: { name: 'warmup' } }], { source: 'choice', where: {}, rng: createRng(3) });
  return rt;
}

function evalAt(rt: ReturnType<typeof makeWarmRuntime>, source: string): unknown {
  const registry = createBuiltinFunctionRegistry();
  return evalExpr(compileExpr(source, registry), {
    state: buildExprScope(rt.state),
    rng: createRng(1),
    registry,
  });
}

describe('12-5 npc.<id>.at：日程缓存读取', () => {
  it('在场 NPC → 缓存地点；无日程/不在场 → null', () => {
    const rt = makeWarmRuntime();
    expect(evalAt(rt, 'npc.npc_guard.at')).toBe('gate');
    expect(evalAt(rt, 'npc.npc_drifter.at')).toBeNull();
  });

  it('同地点交互条件可进顶层条件（== 比较）', () => {
    const rt = makeWarmRuntime();
    const registry = createBuiltinFunctionRegistry();
    const condition = (source: string): boolean =>
      evalCondition(compileExpr(source, registry), {
        state: buildExprScope(rt.state),
        rng: createRng(1),
        registry,
      });
    expect(condition("npc.npc_guard.at == 'gate'")).toBe(true);
    expect(condition("npc.npc_guard.at == 'market'")).toBe(false);
  });

  it('at 为保留字段：同名自定义 flag 不遮蔽缓存读数', () => {
    const rt = makeWarmRuntime();
    rt.exec([{ set: { key: 'npc.npc_guard.flags.at', value: 'shadow' } }], makeCtx());
    expect(evalAt(rt, 'npc.npc_guard.at')).toBe('gate');
    // 显式命名空间仍可读到同名 flag
    expect(evalAt(rt, 'npc.npc_guard.flags.at')).toBe('shadow');
  });

  it('自定义 flag 简写不受影响（非 at 字段）', () => {
    const rt = makeWarmRuntime();
    rt.exec([{ set: { key: 'npc.npc_guard.flags.said_hi', value: true } }], makeCtx());
    expect(evalAt(rt, 'npc.npc_guard.said_hi')).toBe(true);
    expect(evalAt(rt, 'npc.npc_guard.favor')).toBe(0);
  });

  it('未知 NPC 实体仍是封闭域（EVAL_ERROR），与 at 无关', () => {
    const rt = makeWarmRuntime();
    try {
      evalAt(rt, 'npc.npc_ghost.at');
      expect.unreachable('未知 NPC 应当失败');
    } catch (err) {
      expect((err as EngineError).code).toBe('EVAL_ERROR');
    }
  });
});
