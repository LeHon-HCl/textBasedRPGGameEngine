import { describe, expect, it } from 'vitest';
import { EngineError, createRng } from '@game/shared';
import type { DamageInput } from '../../src/battle/types.js';
import { newGameState } from '../../src/state/index.js';
import { GameRuntime } from '../../src/runtime/index.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import { auditTouchDomains, isKnownDomain, KNOWN_STATE_DOMAINS } from '../../src/scripts/touch-audit.js';
import { createDamagePresetResolver } from '../../src/battle/damage.js';
import { createBattleController } from '../../src/battle/wiring.js';
import type { TouchReport } from '../../src/effects/index.js';

/**
 * C 线测试（23 号子任务 7/8 + 16 号遗留）：
 * touchState 域校验（FR-SCR-05）、悬空契约、**伤害公式脚本覆盖**。
 */

describe('23-C1 touchState 域校验（FR-SCR-05）', () => {
  it('内置域清单自洽（无重复、非空、冻结）', () => {
    expect(KNOWN_STATE_DOMAINS.length).toBeGreaterThan(20);
    expect(new Set(KNOWN_STATE_DOMAINS).size).toBe(KNOWN_STATE_DOMAINS.length);
    expect(Object.isFrozen(KNOWN_STATE_DOMAINS)).toBe(true);
  });

  it('isKnownDomain：精确匹配与子路径前缀均算已知', () => {
    expect(isKnownDomain('world.flags')).toBe(true);
    expect(isKnownDomain('world.flags.quest_x')).toBe(true); // 子路径
    expect(isKnownDomain('player.attrs')).toBe(true);
    expect(isKnownDomain('x_custom.newdomain')).toBe(false);
    expect(isKnownDomain('world.unknown_field')).toBe(false);
  });

  it('auditTouchDomains：写未知域 → 违规（含定位与提示）；写已知域 → 通过', () => {
    const violations = auditTouchDomains([], [
      {
        scriptId: 'x.mymod',
        id: 'x.mymod.custom_effect',
        touch: { reads: [], writes: ['world.flags'] } as TouchReport,
      },
      {
        scriptId: 'x.mymod',
        id: 'x.mymod.bad_effect',
        touch: { reads: [], writes: ['x_custom.domain'] } as TouchReport,
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      scriptId: 'x.mymod',
      instructionId: 'x.mymod.bad_effect',
      domain: 'x_custom.domain',
    });
    expect(violations[0]?.detail).toContain('迁移');
  });

  it('读声明宽松：读未知域不算违规（只读视图无害）', () => {
    const violations = auditTouchDomains([], [
      {
        scriptId: 'x.mymod',
        id: 'x.mymod.reader',
        touch: { reads: ['x_custom.view'], writes: [] } as TouchReport,
      },
    ]);
    expect(violations).toEqual([]);
  });
});

describe('23-C2 伤害公式脚本覆盖（16 号 W4 遗留在 23 号打通）', () => {
  const CUSTOM: (input: DamageInput) => { amount: number } = (input) => ({
    // 自定义公式：固定 42 点（测试可辨识）
    amount: 42 + (input.defending === true ? -2 : 0),
  });

  it('预设解析器：注册与按名解析；重复名抛错；保留名 default 不可覆盖', () => {
    const resolver = createDamagePresetResolver();
    expect(resolver.resolve('default')).not.toBeNull();
    resolver.register('x.mymod.big_hit', CUSTOM as never);
    expect(resolver.resolve('x.mymod.big_hit')).toBe(CUSTOM);
    expect(() => resolver.register('x.mymod.big_hit', CUSTOM as never)).toThrowError(EngineError);
    expect(() => resolver.register('default', CUSTOM as never)).toThrowError(EngineError);
    expect(resolver.resolve('x.nobody.ghost')).toBeNull();
  });

  it('战斗接线按名取预设：自定义公式真实生效（结算伤害 = 42）', async () => {
    const { definition } = await loadMinimalBattle();
    const resolver = createDamagePresetResolver();
    resolver.register('x.mymod.big_hit', CUSTOM as never);
    const runtime = makeRuntime();
    const controller = createBattleController({
      definition,
      runtime,
      encounterId: 'slime_encounter',
      branches: {},
      playerSkills: [{ id: 'strike', params: { mult: 1 } }],
      rng: createRng(2026),
      damagePresets: resolver,
      damagePresetName: 'x.mymod.big_hit',
    });
    controller.session.beginTurn();
    controller.session.playerAction({ kind: 'skill', skillId: 'strike', targetUid: 'slime' });
    // 敌人 hp = 6，被 42 点伤害击杀（自定义公式生效的可见证据）
    const slime = controller.session.units().find((unit) => unit.uid === 'slime');
    expect(slime?.hp).toBe(0);
    expect(controller.session.phase()).toBe('victory');
  });

  it('声明预设名但未注入解析器 → EFFECT_FAILED（不静默回落默认公式）', async () => {
    const { definition } = await loadMinimalBattle();
    expect(() =>
      createBattleController({
        definition,
        runtime: makeRuntime(),
        encounterId: 'slime_encounter',
        branches: {},
        playerSkills: [],
        rng: createRng(1),
        damagePresetName: 'x.mymod.big_hit',
      }),
    ).toThrowError(/未注入解析器/);
  });

  it('预设名未注册 → EFFECT_FAILED（名称拼写错误显性化）', async () => {
    const { definition } = await loadMinimalBattle();
    expect(() =>
      createBattleController({
        definition,
        runtime: makeRuntime(),
        encounterId: 'slime_encounter',
        branches: {},
        playerSkills: [],
        rng: createRng(1),
        damagePresets: createDamagePresetResolver(),
        damagePresetName: 'x.mymod.typo',
      }),
    ).toThrowError(/未注册/);
  });
});

// —— 夹具（与 wiring.test.ts 同款的最小战斗包） ——

function makeRuntime() {
  const state = newGameState(
    {
      versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
      attrs: { hp: 30, atk: 10, def: 2, spd: 12 },
    },
    createRng(1),
  );
  return new GameRuntime({
    state,
    rng: createRng(7),
    effectExecutor: createBuiltinEffectRegistry(),
  });
}

async function loadMinimalBattle() {
  const { InMemoryPackageSource, loadGamePackage } = await import('../../src/loader/index.js');
  const files: Record<string, string> = {
    'manifest.yaml': [
      'gameId: script_test',
      'entryScene: arrival',
      'mainLang: zh-CN',
      'langs:',
      '  - zh-CN',
      'contentTags: []',
      'gameVersion: 1.0.0',
      'schemaVersion: 1',
      'minEngineVersion: 0.1.0',
      'redirects: {}',
      'credits: 测试包。',
    ].join('\n'),
    'data/attrs.yaml': ['numeric:', '  hp: { min: 0, max: 100, init: 30, show: true }', 'level: {}', 'derived: {}'].join(
      '\n',
    ),
    'data/areas/meadow.yaml': ['id: meadow', 'nameKey: areas.meadow.name', 'locations: {}'].join('\n'),
    'data/scenes/arrival.yaml': [
      'id: arrival',
      'area: meadow',
      'segments:',
      '  - key: scenes.arrival.desc',
      'choices:',
      '  - id: fight',
      '    textKey: scenes.arrival.fight',
      '    effects:',
      '      - battle: { encounter: slime_encounter }',
      '    goto: arrival',
    ].join('\n'),
    'data/enemies.yaml': [
      '- id: slime',
      '  nameKey: battle.unit.slime',
      '  hp: 6',
      '  attrs: { spd: 3, atk: 2, def: 0 }',
      '  skills:',
      '    - id: tackle',
      '      params: { mult: 1 }',
    ].join('\n'),
    'data/encounters.yaml': [
      '- id: slime_encounter',
      '  enemies: [slime]',
      '  openingKey: battle.slime.opening',
      '  victoryKey: battle.slime.victory',
      '  defeatKey: battle.slime.defeat',
    ].join('\n'),
    'locales/zh-CN/locales.yaml': 't.title: 测试',
  };
  const definition = await loadGamePackage(new InMemoryPackageSource(files));
  return { definition };
}
