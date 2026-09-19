import { describe, expect, it } from 'vitest';
import { EngineError, type EncounterDef, type EnemyDef } from '@game/shared';
import { instantiateEncounter, playerUnitFromState } from '../../src/battle/units.js';
import { buildOutcomeEffects } from '../../src/battle/outcome.js';

/**
 * W2 commit C 测试：遭遇实例化（EncounterDef → BattleInit）+ 胜负路由数据面
 * （FR-CMBT-11/12）。纯函数级——会话与执行器不持运行时（DD-11）。
 */

const SLIME: EnemyDef = {
  id: 'slime',
  nameKey: 'battle.unit.slime',
  hp: 20,
  attrs: { spd: 6, atk: 3, def: 1 },
  skills: [{ id: 'tackle', params: { mult: 1 } }],
};

const ENCOUNTER: EncounterDef = {
  id: 'meadow',
  enemies: ['slime', 'slime', 'bat'],
  openingKey: 'battle.meadow.opening',
  victoryKey: 'battle.meadow.victory',
  defeatKey: 'battle.meadow.defeat',
  escapeRate: 0.7,
  rewards: [{ money: { town_silver: 15 } }],
};

const ENEMIES = new Map<string, EnemyDef>([
  ['slime', SLIME],
  ['bat', { ...SLIME, id: 'bat', nameKey: 'battle.unit.bat', hp: 8 }],
]);

describe('instantiateEncounter（W2：EncounterDef → BattleInit）', () => {
  it('重复 id = 多只同种（FR-CMBT-12）：首只 uid = id，后续 `<id>#<序>`', () => {
    const player = playerUnitFromState(
      { player: { attrs: { hp: 30 }, statuses: [] } },
      { skills: [] },
    );
    const init = instantiateEncounter(ENCOUNTER, ENEMIES, player);
    expect(init.enemies.map((unit) => unit.uid)).toEqual(['slime', 'slime#2', 'bat']);
    expect(init.enemies.map((unit) => unit.hp)).toEqual([20, 20, 8]);
    // 面板隔离：各实例独立快照，改一只不影响另一只
    const [first, second] = init.enemies;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first !== undefined && second !== undefined) {
      first.attrs['atk'] = 99;
      expect(second.attrs['atk']).toBe(3);
    }
    expect(init.escapeRate).toBe(0.7);
  });

  it('玩家快照：hp 取 attrs.hp，statuses 复制，技能由调用方注入', () => {
    const player = playerUnitFromState(
      { player: { attrs: { hp: 27, insight: 3 }, statuses: [{ id: 'poison', remaining: 2 }] } },
      { skills: [{ id: 'slash', params: { mult: 1 } }] },
    );
    expect(player).toMatchObject({ uid: 'player', hp: 27, maxHp: 27 });
    expect(player.attrs).toEqual({ hp: 27, insight: 3 });
    expect(player.statuses).toEqual([{ id: 'poison', remaining: 2 }]);
    expect(player.skills).toEqual([{ id: 'slash', params: { mult: 1 } }]);
  });

  it('悬空 enemy 引用 → DANGLING_REF（crossRef 之外的防御性再报）', () => {
    const player = playerUnitFromState({ player: { attrs: {}, statuses: [] } }, { skills: [] });
    expect(() => instantiateEncounter(ENCOUNTER, new Map([['slime', SLIME]]), player)).toThrowError(
      EngineError,
    );
  });

  it('escapeRate 未声明 → 不写入 BattleInit（会话取缺省 0.5）', () => {
    const player = playerUnitFromState({ player: { attrs: {}, statuses: [] } }, { skills: [] });
    const init = instantiateEncounter(
      { ...ENCOUNTER, enemies: ['slime'], escapeRate: undefined },
      ENEMIES,
      player,
    );
    expect(init.escapeRate).toBeUndefined();
  });
});

describe('buildOutcomeEffects（W2 子任务 8：胜负路由数据面）', () => {
  const branches = {
    onVictory: [{ set: { key: 'flag.meadow_cleared', value: true } }],
    onDefeat: [{ goto: 'defeat_camp' }],
    onEscape: [{ back: null }],
  };

  it('victory：rewards（child 事务）在前，on_victory 在后', () => {
    const effects = buildOutcomeEffects({ outcome: 'victory' }, ENCOUNTER, branches);
    expect(effects).toEqual([
      { money: { town_silver: 15 } },
      { set: { key: 'flag.meadow_cleared', value: true } },
    ]);
  });

  it('defeat / escaped 各自路由；无分支 → 空序列', () => {
    expect(buildOutcomeEffects({ outcome: 'defeat' }, ENCOUNTER, branches)).toEqual([
      { goto: 'defeat_camp' },
    ]);
    expect(buildOutcomeEffects({ outcome: 'escaped' }, ENCOUNTER, branches)).toEqual([
      { back: null },
    ]);
    expect(buildOutcomeEffects({ outcome: 'defeat' }, ENCOUNTER, {})).toEqual([]);
  });
});
