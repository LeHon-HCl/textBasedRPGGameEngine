import { describe, expect, it } from 'vitest';
import { EngineError, createRng, saveBlobSchema, serializedStateSchema } from '@game/shared';
import type { SaveBlob, SerializedState } from '@game/shared';
import type { GameState } from '../../src/state/game-state.js';
import { newGameState } from '../../src/state/new-game.js';
import type { NewGameBootstrap } from '../../src/state/new-game.js';
import { restoreState, serializeState } from '../../src/state/serialize.js';

/**
 * SerializedState 投影用例（04 任务 A2，设计 §2.4 save.ts 契约 + §3.1）。
 *
 * - serialize 输出经 02 号 serializedStateSchema 终验（入档面唯一契约）；
 * - checkpoints（回滚栈元数据）与 world.npcLocationCache（可重建缓存）不入档；
 * - restore 反向重建：versions 取 blob 三层版本，两处排除域还原为空；
 * - 往返幂等：serialize → restore → serialize 深比较一致。
 */

const BOOTSTRAP: NewGameBootstrap = {
  versions: { gameVersion: '1.2.0', schemaVersion: 3, minEngineVersion: '0.0.1' },
  attrs: { hp: 30, con: 3 },
  derivedFormulas: { max_hp: '10 + attr.con * 3' },
  skills: { stealth: { value: 3, exp: 40 } },
  body: { race: 'human' },
  npcs: { raven: { favor: 7, stage: 'warm', met: true, flags: { mood: 'calm' } } },
  factions: { mages: 12 },
  time: { day: 5, slotIndex: 2, week: 1 },
  unlockedAreas: ['old_town'],
  flags: { door_opened: true, chapter: 2, title: 'novice' },
  counters: { herbs_picked: 4 },
  bag: [{ itemId: 'potion', count: 3 }],
  wallet: { gold: 100 },
  perks: ['iron_will'],
  playerName: '阿澈',
};

/** 在状态上模拟「不入档域」的运行期数据（回滚栈元数据 + 日程缓存） */
function withRuntimeOnlyFields(state: GameState): GameState {
  state.checkpoints.push({ label: '选择前' });
  state.world.npcLocationCache['raven'] = 'location_dock';
  return state;
}

/** 以 serialize 产物组装合法 SaveBlob（02 号 schema 校验） */
function buildBlob(state: GameState, rngState: number): SaveBlob {
  return saveBlobSchema.parse({
    formatVersion: 1,
    engineVersion: '0.0.0',
    gameVersion: '1.2.0',
    schemaVersion: 3,
    state: serializeState(state),
    rngState,
    meta: {
      createdAt: 1700000000000,
      playSeconds: 120,
      location: 'scene_cellar',
      day: 5,
      loop: 0,
    },
  });
}

describe('04-A2 serializeState：入档投影与 schema 终验', () => {
  it('投影恰为 serializedStateSchema 顶层键（无 versions / checkpoints）', () => {
    const state = newGameState(BOOTSTRAP, createRng(42));
    const serialized = serializeState(state);
    expect(Object.keys(serialized).sort()).toEqual(
      [
        'factions',
        'loop',
        'npcs',
        'player',
        'quests',
        'readStats',
        'seen',
        'settings',
        'world',
      ].sort(),
    );
    expect(() => serializedStateSchema.parse(serialized)).not.toThrow();
  });

  it('player/world 切片逐字段对齐 §3.1（含派生缓存与 bootstrap）', () => {
    const state = newGameState(BOOTSTRAP, createRng(42));
    const serialized = serializeState(state);
    expect(serialized.player).toEqual(state.player);
    expect(serialized.world).toEqual({
      time: { day: 5, slotIndex: 2, week: 1 },
      unlockedAreas: ['old_town'],
      flags: { door_opened: true, chapter: 2, title: 'novice' },
      counters: { herbs_picked: 4 },
      eventCooldowns: {},
    });
    expect(serialized.loop).toBe(0);
    expect(serialized.npcs).toEqual(state.npcs);
    expect(serialized.factions).toEqual({ mages: 12 });
  });

  it('checkpoints 与 npcLocationCache 不入档（strictObject 终验兜底）', () => {
    const state = withRuntimeOnlyFields(newGameState(BOOTSTRAP, createRng(42)));
    const serialized = serializeState(state);
    expect(serialized.world).not.toHaveProperty('npcLocationCache');
    expect(serialized).not.toHaveProperty('checkpoints');
  });

  it('状态树违反入档契约时抛 INTERNAL（serialize 侧内部一致性防御）', () => {
    const broken = { ...newGameState(BOOTSTRAP, createRng(42)), loop: -1 } as unknown as GameState;
    expect(() => serializeState(broken)).toThrowError(EngineError);
    try {
      serializeState(broken);
    } catch (err) {
      expect((err as EngineError).code).toBe('INTERNAL');
    }
  });
});

describe('04-A2 restoreState：反向重建', () => {
  it('versions 取 blob 三层版本，排除域还原为空（npcLocationCache/checkpoints）', () => {
    const state = withRuntimeOnlyFields(newGameState(BOOTSTRAP, createRng(42)));
    const blob = buildBlob(state, 123456789);
    const restored = restoreState(blob);
    expect(restored.versions).toEqual({
      engineVersion: '0.0.0',
      gameVersion: '1.2.0',
      schemaVersion: 3,
    });
    expect(restored.world.npcLocationCache).toEqual({});
    expect(restored.checkpoints).toEqual([]);
  });

  it('其余状态域与入档投影逐字段一致', () => {
    const state = withRuntimeOnlyFields(newGameState(BOOTSTRAP, createRng(42)));
    const blob = buildBlob(state, 1);
    const restored = restoreState(blob);
    const serialized = serializeState(state);
    expect(restored.loop).toBe(serialized.loop);
    expect(restored.player).toEqual(serialized.player);
    expect(restored.world.time).toEqual(serialized.world.time);
    expect(restored.world.eventCooldowns).toEqual(serialized.world.eventCooldowns);
    expect(restored.npcs).toEqual(serialized.npcs);
    expect(restored.factions).toEqual(serialized.factions);
    expect(restored.quests).toEqual(serialized.quests);
    expect(restored.seen).toEqual(serialized.seen);
    expect(restored.readStats).toEqual(serialized.readStats);
    expect(restored.settings).toEqual(serialized.settings);
  });

  it('blob.state 未通过 schema 终验时抛 SAVE_CORRUPT（损坏档显性化，FR-SAVE）', () => {
    const blob = buildBlob(newGameState(BOOTSTRAP, createRng(42)), 1);
    const corrupt = {
      ...blob,
      state: { ...blob.state, player: { ...blob.state.player, extra_key: true } },
    } as unknown as SaveBlob;
    expect(() => restoreState(corrupt)).toThrowError(EngineError);
    try {
      restoreState(corrupt);
    } catch (err) {
      expect((err as EngineError).code).toBe('SAVE_CORRUPT');
      expect((err as EngineError).messageKey).toBe('error.state.saveCorrupt');
    }
  });
});

describe('04-A2 往返幂等（serialize → restore → serialize）', () => {
  it('两次 serialize 深比较一致', () => {
    const first: SerializedState = serializeState(
      withRuntimeOnlyFields(newGameState(BOOTSTRAP, createRng(42))),
    );
    const restored = restoreState(buildBlob(newGameState(BOOTSTRAP, createRng(42)), 7));
    // 模拟回滚栈元数据在运行期重新累积后再存档
    restored.checkpoints.push({ label: '另一选择' });
    const second = serializeState(restored);
    expect(second).toEqual(first);
  });

  it('restore 后的独立副本：改写不回流原 blob（structuredClone 边界由调用方冻结保障）', () => {
    const blob = buildBlob(newGameState(BOOTSTRAP, createRng(42)), 1);
    const restored = restoreState(blob);
    restored.player.attrs.hp = 999;
    expect(blob.state.player.attrs.hp).toBe(30);
  });
});
