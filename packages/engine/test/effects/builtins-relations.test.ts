import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import { FACTIONS, NPCS, makeBuiltinRuntime, makeCtx } from './fixtures.js';
import { BASE_VERSIONS } from './fixtures.js';

/** 带目录与初始关系的运行时（关系类用例） */
function makeRelationRuntime(init?: {
  npcBootstrap?: Record<string, { favor: number; stage?: string; met?: boolean }>;
  factionBootstrap?: Record<string, number>;
  reputationBounds?: { min: number; max: number };
}) {
  return makeBuiltinRuntime({
    bootstrap: {
      versions: BASE_VERSIONS,
      attrs: { hp: 30 },
      npcs: init?.npcBootstrap ?? { npc_raven: { favor: 0 } },
      factions: init?.factionBootstrap ?? { faction_town: 0, faction_guild: 10 },
    },
    registryOptions: {
      npcs: NPCS,
      factions: FACTIONS,
      ...(init?.reputationBounds !== undefined ? { reputationBounds: init.reputationBounds } : {}),
    },
  });
}

describe('05-B3 favor：好感 clamp 与阶段事件（FR-NPCR-02）', () => {
  it('区间收敛：超出 [min, max] 的增减被 clamp 到边界', () => {
    const { rt } = makeRelationRuntime();
    rt.exec([{ favor: { npc: 'npc_raven', amount: 500 } }], makeCtx());
    expect(rt.state.npcs['npc_raven']?.favor).toBe(100);
    rt.exec([{ favor: { npc: 'npc_raven', amount: -500 } }], makeCtx());
    expect(rt.state.npcs['npc_raven']?.favor).toBe(-100);
  });

  it('阶段阈值驱动 stage 更新，阶段变化 emit favor_stage_changed', () => {
    const { rt } = makeRelationRuntime();
    const outcome = rt.exec([{ favor: { npc: 'npc_raven', amount: 40 } }], makeCtx());
    expect(rt.state.npcs['npc_raven']?.favor).toBe(40);
    expect(rt.state.npcs['npc_raven']?.stage).toBe('stage_friendly');
    expect(outcome.events).toEqual([
      { type: 'favor_stage_changed', npc: 'npc_raven', from: undefined, to: 'stage_friendly' },
    ]);
    const second = rt.exec([{ favor: { npc: 'npc_raven', amount: 40 } }], makeCtx());
    expect(second.events).toEqual([
      { type: 'favor_stage_changed', npc: 'npc_raven', from: 'stage_friendly', to: 'stage_bonded' },
    ]);
  });

  it('好感跌出全部阶段：stage 置空并发出 to=undefined 的阶段事件', () => {
    const { rt } = makeRelationRuntime({
      npcBootstrap: { npc_wren: { favor: 10, stage: 'stage_active' } },
    });
    const outcome = rt.exec([{ favor: { npc: 'npc_wren', amount: -60 } }], makeCtx());
    expect(rt.state.npcs['npc_wren']?.favor).toBe(-50);
    expect(rt.state.npcs['npc_wren']?.stage).toBeUndefined();
    expect(outcome.events).toEqual([
      { type: 'favor_stage_changed', npc: 'npc_wren', from: 'stage_active', to: undefined },
    ]);
  });

  it('未登场 NPC 自动建档（met 保持 false）；无好感系统的 NPC 只改数值', () => {
    const { rt } = makeRelationRuntime({ npcBootstrap: {} });
    const outcome = rt.exec([{ favor: { npc: 'npc_mira', amount: '5 * 2' } }], makeCtx());
    expect(rt.state.npcs['npc_mira']).toMatchObject({ favor: 10, met: false });
    expect(outcome.events).toEqual([]);
    expect(outcome.patches.map((p) => p.path[0])).toContain('npcs');
  });

  it('未注入 NPC 目录时不收敛、无阶段事件（目录由宿主注入）', () => {
    const { rt } = makeBuiltinRuntime({
      bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 30 }, npcs: { npc_raven: { favor: 0 } } },
    });
    rt.exec([{ favor: { npc: 'npc_raven', amount: 9999 } }], makeCtx());
    expect(rt.state.npcs['npc_raven']?.favor).toBe(9999);
    expect(rt.state.npcs['npc_raven']?.stage).toBeUndefined();
  });
});

describe('05-B3 reputation：声望 clamp 与波段事件（FR-NPCR-04）', () => {
  it('波段阈值驱动事件；未跨阈值不发事件', () => {
    const { rt } = makeRelationRuntime();
    const outcome = rt.exec([{ reputation: { faction: 'faction_town', amount: 60 } }], makeCtx());
    expect(rt.state.factions['faction_town']).toBe(60);
    expect(outcome.events).toEqual([
      {
        type: 'reputation_band_changed',
        faction: 'faction_town',
        from: 'band_neutral',
        to: 'band_honored',
      },
    ]);
    const noBand = rt.exec([{ reputation: { faction: 'faction_town', amount: 10 } }], makeCtx());
    expect(noBand.events).toEqual([]);
  });

  it('全局 reputationBounds 收敛；无阈值表阵营不产事件', () => {
    const { rt } = makeRelationRuntime({ reputationBounds: { min: -100, max: 100 } });
    rt.exec([{ reputation: { faction: 'faction_guild', amount: 500 } }], makeCtx());
    expect(rt.state.factions['faction_guild']).toBe(100);
    rt.exec([{ reputation: { faction: 'faction_town', amount: -40 } }], makeCtx());
    expect(rt.state.factions['faction_town']).toBe(-40);
  });

  it('未知阵营（封闭域）即 EFFECT_FAILED，状态不变', () => {
    const { rt } = makeRelationRuntime();
    try {
      rt.exec([{ reputation: { faction: 'faction_ghost', amount: 5 } }], makeCtx());
      expect.unreachable('未知阵营应失败');
    } catch (err) {
      const engineErr = err as EngineError;
      expect(engineErr.code).toBe('EFFECT_FAILED');
      const cause = engineErr.cause as EngineError;
      expect(cause.where.op).toBe('reputation');
      expect(cause.where.faction).toBe('faction_ghost');
      expect(cause.message).toContain('未知阵营');
    }
    expect(rt.state.factions['faction_ghost']).toBeUndefined();
  });
});
