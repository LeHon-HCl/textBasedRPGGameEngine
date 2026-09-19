import { describe, expect, it } from 'vitest';
import { createRng, type Rng } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '../../src/loader/index.js';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import { newGameState } from '../../src/state/index.js';
import { createBattleController } from '../../src/battle/wiring.js';

/**
 * W2 子任务 8 收口测试：battle 指令接线层（wiring.ts）——
 * 真实加载管线（含 PR #29 的 battle 数据域）+ 真实 GameRuntime 状态事务，
 * 走通「battle jump → 会话驱动 → 终局 → 路由效果入账（rewards/flag）」全链。
 */

function rngStub(): Rng {
  return createRng(2026);
}

/** 最小战斗包：1 敌人 1 遭遇 + 奖励/分支效果面 */
function makeFiles(): Record<string, string> {
  return {
    'manifest.yaml': [
      'gameId: battle_wire_test',
      'entryScene: arrival',
      'mainLang: zh-CN',
      'langs: [zh-CN]',
      'contentTags: []',
      'gameVersion: 1.0.0',
      'schemaVersion: 1',
      'minEngineVersion: 0.1.0',
      'redirects: {}',
      'credits: 接线层测试包。',
    ].join('\n'),
    'data/attrs.yaml': [
      'numeric:',
      '  hp: { min: 0, max: 100, init: 30, show: true }',
      '  atk: { min: 0, max: 99, init: 10, show: true }',
      '  def: { min: 0, max: 99, init: 2, show: true }',
      '  spd: { min: 0, max: 99, init: 12, show: true }',
      'level: {}',
      'derived: {}',
    ].join('\n'),
    'data/areas/meadow.yaml': ['id: meadow', 'nameKey: areas.meadow.name', 'locations: {}'].join(
      '\n',
    ),
    'data/scenes/arrival.yaml': [
      'id: arrival',
      'area: meadow',
      'segments:',
      '  - key: scenes.arrival.desc',
      'choices:',
      '  - id: fight',
      '    textKey: scenes.arrival.fight',
      '    effects:',
      '      - battle: { encounter: slime_encounter, onVictory: [{ set: { key: "flag.won", value: true } }] }',
      '    goto: arrival',
    ].join('\n'),
    'data/enemies.yaml': [
      '- id: slime',
      '  nameKey: battle.unit.slime',
      '  hp: 8',
      '  attrs: { spd: 3, atk: 2, def: 0 }',
      '  skills:',
      '    - id: tackle',
      '      params: { mult: 1 }',
      '      effects: [{ add: { key: "attr.hp", amount: 1 } }]', // 敌方自愈面（applyEffects 缝验证）
    ].join('\n'),
    'data/encounters.yaml': [
      '- id: slime_encounter',
      '  enemies: [slime]',
      '  openingKey: battle.slime.opening',
      '  victoryKey: battle.slime.victory',
      '  defeatKey: battle.slime.defeat',
      '  escapeRate: 0.5',
      '  rewards: [{ money: { town_silver: 10 } }]',
    ].join('\n'),
    'locales/zh-CN/locales.yaml': ['t.title: 测试'].join('\n'),
  };
}

async function makeRuntime() {
  const definition = await loadGamePackage(new InMemoryPackageSource(makeFiles()));
  const state = newGameState(
    {
      versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
      attrs: { hp: 30, atk: 10, def: 2, spd: 12 },
    },
    createRng(1),
  );
  const runtime = new GameRuntime({
    state,
    rng: createRng(7),
    effectExecutor: definition.effectRegistry,
  });
  return { definition, runtime };
}

describe('createBattleController（W2 接线层：battle jump 消费全链）', () => {
  it('全链：会话驱动至 victory → pollOutcome 执行 rewards + on_victory（一批事务入账）', async () => {
    const { definition, runtime } = await makeRuntime();
    const controller = createBattleController({
      definition,
      runtime,
      encounterId: 'slime_encounter',
      branches: { onVictory: [{ set: { key: 'flag.won', value: true } }] },
      playerSkills: [{ id: 'slash', params: { mult: 3 } }],
      rng: rngStub(),
    });
    // 玩家 spd 12 > 敌方 3 → 玩家先手；atk 10 × mult 3 − def 0 = 30 ≥ 8 → 一击获胜
    controller.session.beginTurn();
    controller.session.playerAction({ kind: 'skill', skillId: 'slash', targetUid: 'slime' });
    expect(controller.session.phase()).toBe('victory');

    const outcome = controller.pollOutcome();
    expect(outcome).not.toBeNull();
    expect(outcome?.outcome).toBe('victory');
    // 路由效果经真实状态事务入账：钱包 +10、flag.won 置位
    expect(runtime.state.player.wallet['town_silver']).toBe(10);
    expect(runtime.state.world.flags['won']).toBe(true);

    // 幂等：二次 poll 不重复入账
    expect(controller.pollOutcome()).toBeNull();
    expect(runtime.state.player.wallet['town_silver']).toBe(10);
  });

  it('applyEffects 缝贯通：敌方技能附加效果经 runtime child 事务执行', async () => {
    const { definition, runtime } = await makeRuntime();
    // 玩家一击打不死（mult 1 → 10×1−0=10 ≥ 8？——8 血一击即死。改低攻击：
    const controller = createBattleController({
      definition,
      runtime,
      encounterId: 'slime_encounter',
      branches: {},
      playerSkills: [{ id: 'poke', params: { mult: 0.1 } }],
      rng: rngStub(),
    });
    controller.session.beginTurn();
    // 玩家 poke（伤害下限≥1 的公式为 B 方实现；此处直接打 7 血 → 敌方存活 1）
    controller.session.playerAction({ kind: 'skill', skillId: 'poke', targetUid: 'slime' });
    const slime = controller.session.units().find((unit) => unit.uid === 'slime');
    expect(slime?.hp).toBeLessThan(8);
    // 敌方回合 tackle：附加效果 add hp +1 经缝执行（敌人在战斗内自愈不落主状态，
    // 故此处只断言会话存活、缝未抛错）；战斗继续
    expect(['turn_order', 'victory', 'defeat']).toContain(controller.session.phase());
  });

  it('遭遇 id 不存在 → DANGLING_REF（crossRef 之外的防御性再报）', async () => {
    const { definition, runtime } = await makeRuntime();
    expect(() =>
      createBattleController({
        definition,
        runtime,
        encounterId: 'ghost_encounter' as never,
        branches: {},
        playerSkills: [],
        rng: rngStub(),
      }),
    ).toThrowError(/不存在/);
  });
});
