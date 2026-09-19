import { EngineError, type EnemyDef, type EncounterDef } from '@game/shared';
import type { BattleInit, BattleUnit } from './types.js';

/**
 * 遭遇实例化（detail-design §5.2 构造签名偏差的补全面，16 号 W2 子任务 8 前；
 * 偏差登记：BattleSession 接受已实例化单位，本文件负责「EncounterDef → 单位」）。
 *
 * - 敌方：按 EncounterDef.enemies 引用序实例化（FR-CMBT-12 允许重复 id =
 *   多只同种）——单只 uid = 敌人 id；重复出现自第 2 只起 uid = `<id>#<序>`；
 * - 玩家：由调用方经 {@link playerUnitFromState} 从 GameState 快照（会话不读
 *   叙事栈，DD-11）；
 * - 引用悬空：加载期 crossRef 已拦（error 级），此处防御性再报 DANGLING_REF。
 */

/** 从 GameState 快照玩家参战单位（attrs/hp/statuses；技能表由调用方注入） */
export function playerUnitFromState(
  state: { player: { attrs: Record<string, number>; statuses: unknown[] } },
  options: { skills: BattleUnit['skills']; nameKey?: string; uid?: string },
): BattleUnit {
  const attrs = { ...state.player.attrs };
  const hp = typeof attrs['hp'] === 'number' ? attrs['hp'] : 0;
  return {
    uid: options.uid ?? 'player',
    side: 'player',
    nameKey: options.nameKey ?? 'battle.unit.player',
    hp,
    maxHp: hp,
    attrs,
    statuses: [...(state.player.statuses as BattleUnit['statuses'])],
    skills: options.skills,
  };
}

/** EncounterDef → BattleInit（会话构造输入） */
export function instantiateEncounter(
  encounter: EncounterDef,
  enemies: ReadonlyMap<string, EnemyDef>,
  player: BattleUnit,
): BattleInit {
  const counts = new Map<string, number>();
  const units: BattleUnit[] = encounter.enemies.map((enemyId) => {
    const def = enemies.get(enemyId);
    if (def === undefined) {
      throw new EngineError({
        code: 'DANGLING_REF',
        where: { op: 'battle', enemy: enemyId, detail: `遭遇 '${encounter.id}' 引用不存在的敌人` },
        messageKey: 'error.loader.danglingRef',
      });
    }
    const n = (counts.get(enemyId) ?? 0) + 1;
    counts.set(enemyId, n);
    return {
      uid: n === 1 ? enemyId : `${enemyId}#${n}`,
      side: 'enemy',
      nameKey: def.nameKey,
      hp: def.hp,
      maxHp: def.hp,
      attrs: { ...def.attrs },
      statuses: [],
      skills: def.skills.map((skill) => ({ ...skill })),
      ...(def.ai !== undefined ? { ai: { ...def.ai } } : {}),
      ...(def.sprite !== undefined ? { sprite: def.sprite } : {}),
    };
  });
  return {
    player,
    enemies: units,
    ...(encounter.escapeRate !== undefined ? { escapeRate: encounter.escapeRate } : {}),
  };
}
