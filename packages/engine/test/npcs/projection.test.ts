import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { NpcDef } from '@game/shared';
import { newGameState } from '../../src/state/new-game.js';
import type { GameState, NewGameNpcInit } from '../../src/state/index.js';
import { projectRelationships } from '../../src/npcs/projection.js';

/**
 * 12 任务 7：关系面板数据投影（FR-NPCR-05；纯函数，供 25 号 UI 消费）。
 *
 * 展示已结识 NPC、关系阶段；好感数值显隐策略由游戏配置（缺省隐藏数值只显示
 * 阶段）；当前所在地点读日程缓存（不在场 → null）。投影不读语言包、不改状态。
 */

const VERSIONS = { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' };

const NPCS: ReadonlyMap<string, NpcDef> = new Map(
  (
    [
      {
        id: 'npc_raven',
        nameKey: 'npc.raven.name',
        favor: {
          min: -100,
          max: 100,
          stages: [
            { id: 'stranger', at: -100, nameKey: 'npc.raven.stage.stranger' },
            { id: 'friendly', at: 30, nameKey: 'npc.raven.stage.friendly' },
          ],
        },
      },
      { id: 'npc_wren', nameKey: 'npc.wren.name' },
    ] as NpcDef[]
  ).map((def) => [def.id, def]),
);

/** 构造状态（含关系记录与日程缓存；缓存直接注入以隔离投影） */
function makeState(init: {
  npcs?: Record<string, NewGameNpcInit>;
  cache?: Record<string, string>;
}): GameState {
  const state = newGameState(
    { versions: VERSIONS, attrs: { hp: 10 }, npcs: init.npcs ?? {} },
    createRng(1),
  );
  state.world.npcLocationCache = { ...(init.cache ?? {}) };
  return state;
}

describe('12-7 projectRelationships：已结识筛选与阶段解析', () => {
  it('缺省只列已结识（met=true）；includeUnmet 纳入全部', () => {
    const state = makeState({
      npcs: {
        npc_raven: { favor: 40, stage: 'friendly', met: true },
        npc_wren: { favor: 0, met: false },
      },
    });
    expect(projectRelationships(state, NPCS).entries.map((e) => e.npcId)).toEqual(['npc_raven']);
    expect(
      projectRelationships(state, NPCS, { includeUnmet: true }).entries.map((e) => e.npcId),
    ).toEqual(['npc_raven', 'npc_wren']);
  });

  it('阶段 id 经目录解析出 nameKey；未知阶段 id → undefined', () => {
    const state = makeState({
      npcs: {
        npc_raven: { favor: 40, stage: 'friendly', met: true },
        npc_wren: { favor: 0, stage: 'ghost_stage', met: true },
      },
    });
    const entries = projectRelationships(state, NPCS).entries;
    expect(entries[0]?.stage).toEqual({ id: 'friendly', nameKey: 'npc.raven.stage.friendly' });
    expect(entries[1]?.stage).toBeUndefined();
  });

  it('无目录条目时回退约定 nameKey（引擎不中断投影）', () => {
    const state = makeState({ npcs: { npc_unknown: { favor: 1, met: true } } });
    const entry = projectRelationships(state, NPCS).entries[0];
    expect(entry?.nameKey).toBe('npcs.npc_unknown');
  });

  it('当前地点读日程缓存；不在场 → null', () => {
    const state = makeState({
      npcs: { npc_raven: { favor: 0, met: true }, npc_wren: { favor: 0, met: true } },
      cache: { npc_raven: 'location_dock' },
    });
    const entries = projectRelationships(state, NPCS).entries;
    expect(entries.find((e) => e.npcId === 'npc_raven')?.at).toBe('location_dock');
    expect(entries.find((e) => e.npcId === 'npc_wren')?.at).toBeNull();
  });
});

describe('12-7 projectRelationships：好感显隐与排序', () => {
  it('缺省隐藏好感数值（只显示阶段）；showFavor=true 才透出', () => {
    const state = makeState({
      npcs: { npc_raven: { favor: 42, stage: 'friendly', met: true } },
    });
    expect(projectRelationships(state, NPCS).entries[0]?.favor).toBeUndefined();
    expect(projectRelationships(state, NPCS, { showFavor: true }).entries[0]?.favor).toBe(42);
  });

  it('排序：id 字典序 / favor 降序（显隐策略不影响排序键）', () => {
    const state = makeState({
      npcs: {
        npc_raven: { favor: 10, met: true },
        npc_wren: { favor: 50, met: true },
      },
    });
    expect(
      projectRelationships(state, NPCS, { sort: 'favor', showFavor: false }).entries.map(
        (e) => e.npcId,
      ),
    ).toEqual(['npc_wren', 'npc_raven']);
    expect(
      projectRelationships(state, NPCS, { sort: 'id', includeUnmet: true }).entries.map(
        (e) => e.npcId,
      ),
    ).toEqual(['npc_raven', 'npc_wren']);
  });

  it('投影为纯函数：不改动状态树', () => {
    const state = makeState({
      npcs: { npc_raven: { favor: 42, stage: 'friendly', met: true } },
      cache: { npc_raven: 'gate' },
    });
    const before = JSON.stringify(state);
    projectRelationships(state, NPCS, { showFavor: true });
    expect(JSON.stringify(state)).toBe(before);
  });
});
