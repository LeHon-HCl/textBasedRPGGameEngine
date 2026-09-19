import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { BattleUnit } from '../../src/battle/types.js';
import { createDamagePresetResolver, createDefaultDamageFn } from '../../src/battle/damage.js';
import { createAiResolver } from '../../src/battle/ai.js';
import { createEffectExecutor } from '../../src/battle/resolution.js';
import type { ActionExecutionContext } from '../../src/battle/resolution.js';

/**
 * W4 交付物 × W2 消费缝的联动验证（16 号，跨线契约的兼容性锚点）。
 *
 * 跨线口径（分工文档硬规则 3）：B 线 damage/ai 只经 types.ts 契约协作——
 * 本文件验证三个缝的真实咬合（不 mock 对方实现，直接消费 #28 的
 * resolution.ts）：
 * 1. `createAiResolver` 产出的 AiActionSpec 能被 W2 执行器消费；
 * 2. W2 组装的 DamageInput（含 SkillRef.params.mult 缺省 1、defending 传递）
 *    与 `createDefaultDamageFn` 的输入口径一致；
 * 3. 预设解析器解析出的公式可注入 `ResolutionOptions.damageFn`。
 */

const RNG = createRng(42);

function playerUnit(): BattleUnit {
  return {
    uid: 'player',
    side: 'player',
    nameKey: 'actors.hero',
    hp: 30,
    maxHp: 30,
    attrs: { atk: 10, def: 3, spd: 5 },
    statuses: [],
    skills: [{ id: 'strike', params: { mult: 2 } }],
  };
}

function enemyUnit(): BattleUnit {
  return {
    uid: 'enemy_1',
    side: 'enemy',
    nameKey: 'enemies.rat.name',
    hp: 12,
    maxHp: 12,
    attrs: { atk: 4, def: 2, spd: 6 },
    statuses: [],
    skills: [{ id: 'bite', params: { mult: 1 } }],
    ai: {
      kind: 'scripted',
      sequence: [
        { when: 'enemy.hp < 4', action: { kind: 'defend' } },
        // 数据面目标：AI 声明攻击目标 uid（动态目标选择归 W6 targeting，见 #28 反馈）
        { action: { kind: 'skill', skillId: 'bite', targetUid: 'player' } },
      ],
    },
  };
}

function ectx(actor: BattleUnit, units: BattleUnit[]): ActionExecutionContext {
  return { actor, units: new Map(units.map((unit) => [unit.uid, unit])), rng: RNG };
}

describe('W4 × W2 联动：AI 决策 → 执行器 → DamageFn 咬合', () => {
  it('scripted AI 的 skill 行动经 W2 执行器 → DamageInput 组装 → 默认公式入账', () => {
    const player = playerUnit();
    const enemy = enemyUnit();
    const units = [player, enemy];
    const resolve = createAiResolver({ rng: RNG, evalCondition: () => false }); // 兜底 bite
    const execute = createEffectExecutor({ damageFn: createDefaultDamageFn() });

    const action = resolve(enemy);
    const outcome = execute(action, ectx(enemy, units));
    // bite mult=1 targetUid='player'：atk 4 − def 3 = 1（默认公式，确定性）
    expect(outcome.damage).toEqual([{ uid: 'player', amount: 1 }]);
  });

  it('SkillRef.params.mult 缺省 1 由 W2 侧处理；显式 mult=2 经默认公式放大', () => {
    const player = playerUnit();
    const enemy = enemyUnit();
    const execute = createEffectExecutor({ damageFn: createDefaultDamageFn() });
    const outcome = execute(
      { kind: 'skill', skillId: 'strike', targetUid: 'enemy_1' },
      ectx(player, [player, enemy]),
    );
    // strike mult=2：atk 10*2 − def 2 = 18
    expect(outcome.damage).toEqual([{ uid: 'enemy_1', amount: 18 }]);
  });

  it('defending 态经 DamageInput.defender 面板折算（W1 置位 → W2 传递 → 公式消费）', () => {
    const player = playerUnit();
    const enemy = { ...enemyUnit(), defending: true };
    const execute = createEffectExecutor({ damageFn: createDefaultDamageFn() });
    // 防御减免由本方公式消费（W1 置位 → W2 传递旗标 → 公式减半）：
    // strike mult=2 → 10*2 − 2 = 18 → 防御 9
    const outcome = execute(
      { kind: 'skill', skillId: 'strike', targetUid: 'enemy_1' },
      ectx(player, [player, enemy]),
    );
    expect(outcome.damage).toEqual([{ uid: 'enemy_1', amount: 9 }]);
  });

  it('预设解析器解析出的公式可直接注入 ResolutionOptions.damageFn', () => {
    const resolver = createDamagePresetResolver();
    const fn = resolver.resolve('default');
    expect(fn).not.toBeNull();
    const execute = createEffectExecutor({ damageFn: fn as NonNullable<typeof fn> });
    const player = playerUnit();
    const enemy = enemyUnit();
    const outcome = execute(
      { kind: 'skill', skillId: 'strike', targetUid: 'enemy_1' },
      ectx(player, [player, enemy]),
    );
    expect(outcome.damage).toEqual([{ uid: 'enemy_1', amount: 18 }]);
  });

  it('AI 的 when 条件求值失败原样上抛（DD-01：执行链路不吞表达式错误）', () => {
    const enemy = enemyUnit();
    const resolve = createAiResolver({
      rng: RNG,
      evalCondition: () => {
        throw new Error('EXPR_COMPILE: bad expr');
      },
    });
    expect(() => resolve(enemy)).toThrowError('EXPR_COMPILE');
  });
});
