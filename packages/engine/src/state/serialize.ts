import { EngineError } from '@game/shared';
import { serializedStateSchema } from '@game/shared';
import type { SaveBlob, SerializedState } from '@game/shared';
import type { GameState } from './game-state.js';

/**
 * SerializedState 入档投影与反向重建（设计 §2.4 save.ts 契约、§3.1 快照策略、
 * FR-MIGR-01、DD-10；04 任务 A2）。
 *
 * - `serializeState`：GameState → SerializedState（02 号 `serializedStateSchema`
 *   终验）。`checkpoints`（回滚栈元数据）与 `world.npcLocationCache`（日程解析
 *   缓存，可重建）不入档；`versions` 由 SaveBlob 顶层三层版本承载（§2.4）；
 * - `restoreState`：SaveBlob → GameState（读档管线 Zod 终验后的重建步骤，
 *   DD-10）：versions 取 blob 三层版本（FR-MIGR-01），两处排除域还原为空；
 * - serialize 产物与当前状态共享未变更子树引用（immer 写时复制保证其不再
 *   被原地改写）；restore 产物为完全独立副本（structuredClone）。
 */

/**
 * 序列化当前状态为入档投影（SaveBlob['state']）。
 * 输出经 serializedStateSchema 严格终验；状态树违反入档契约（如运行期被
 * 绕过事务改写出非法值）时抛 INTERNAL——存档面错误显性化，不静默裁剪。
 */
export function serializeState(state: GameState): SerializedState {
  const projection = {
    loop: state.loop,
    player: { ...state.player },
    world: {
      time: state.world.time,
      unlockedAreas: state.world.unlockedAreas,
      flags: state.world.flags,
      counters: state.world.counters,
      eventCooldowns: state.world.eventCooldowns,
    },
    npcs: state.npcs,
    factions: state.factions,
    quests: state.quests,
    seen: state.seen,
    readStats: state.readStats,
    settings: state.settings,
  };
  try {
    return serializedStateSchema.parse(projection);
  } catch (err) {
    throw new EngineError({
      code: 'INTERNAL',
      where: { detail: '状态树违反 serializedStateSchema 入档契约（§2.4 save.ts）' },
      messageKey: 'error.state.invalidGameState',
      cause: err,
    });
  }
}

/**
 * 从存档 blob 重建 GameState（不含 rng：rngState 由 GameRuntime.restore
 * 注入运行时 Rng，DD-09）。
 *
 * blob.state 先经 schema 终验（失败 = SAVE_CORRUPT，损坏档显性化），再
 * structuredClone 为独立副本；npcLocationCache 与 checkpoints 还原为空，
 * 由运行期重建（§4.6 管线步骤 5、FR-READ-03 回滚栈）。
 */
export function restoreState(blob: SaveBlob): GameState {
  let snapshot: SerializedState;
  try {
    snapshot = structuredClone(serializedStateSchema.parse(blob.state));
  } catch (err) {
    throw new EngineError({
      code: 'SAVE_CORRUPT',
      where: { detail: 'blob.state 未通过 serializedStateSchema 终验（DD-10 读档管线）' },
      messageKey: 'error.state.saveCorrupt',
      cause: err,
    });
  }
  return {
    versions: {
      engineVersion: blob.engineVersion,
      gameVersion: blob.gameVersion,
      schemaVersion: blob.schemaVersion,
    },
    loop: snapshot.loop,
    // 13 号新增域为 schema 可选（旧存档无此字段，只增不改）：恢复时补空缺省值
    player: {
      ...snapshot.player,
      outfitPresets: snapshot.player.outfitPresets ?? {},
      wornMeta: snapshot.player.wornMeta ?? {},
    },
    world: { ...snapshot.world, npcLocationCache: {} },
    npcs: snapshot.npcs,
    factions: snapshot.factions,
    quests: snapshot.quests,
    seen: snapshot.seen,
    readStats: snapshot.readStats,
    settings: snapshot.settings,
    checkpoints: [],
  };
}
