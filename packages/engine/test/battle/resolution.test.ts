import { describe, expect, it } from 'vitest';
import type { Rng } from '@game/shared';
import { createEffectExecutor } from '../../src/battle/resolution.js';
import type { DamageInput } from '../../src/battle/types.js';

/**
 * W2 子任务 4 测试：结算执行器——attack 技能经 DamageFn（守方面板 + defending
 * 传递 + mult）、item 消耗缝、defend/flee 会话内置语义的执行器面。
 * DamageFn 用桩（真实公式归 B 线 W4 damage.ts）。
 */

function unit(uid: string, side: 'player' | 'enemy', overrides?: Record<string, unknown>) {
  return {
    uid,
    side,
    nameKey: `battle.unit.${uid}`,
    hp: 30,
    maxHp: 30,
    attrs: { spd: 10, atk: 5, def: 2 } as Record<string, number>,
    statuses: [],
    skills: [{ id: 'slash', params: { mult: 2 } }, { id: 'focus' }],
    ...overrides,
  } as import('../../src/battle/types.js').BattleUnit;
}

const rngStub = {
  next: () => 0,
  int: () => 1,
  pick: () => 0,
  weighted: () => 0,
  chance: () => false,
  getState: () => 0,
  setState: () => {},
  fork: () => rngStub,
} as unknown as Rng;

describe('createEffectExecutor（W2 子任务 4：结算管线）', () => {
  it('attack 技能：构造 DamageInput（attacker/defender 面板 + mult）并回传伤害', () => {
    const hero = unit('hero', 'player');
    const slime = unit('slime', 'enemy');
    const captured: DamageInput[] = [];
    const executor = createEffectExecutor({
      damageFn: (input, rng) => {
        captured.push(input);
        void rng;
        return { amount: 7 };
      },
    });
    const outcome = executor(
      { kind: 'skill', skillId: 'slash', targetUid: 'slime' },
      {
        actor: hero,
        units: new Map([
          [hero.uid, hero],
          [slime.uid, slime],
        ]),
        rng: rngStub,
      },
    );
    expect(captured[0]).toEqual({
      attacker: { spd: 10, atk: 5, def: 2 },
      defender: { spd: 10, atk: 5, def: 2 },
      mult: 2, // SkillRef.params.mult
    });
    expect(outcome.damage).toEqual([{ uid: 'slime', amount: 7 }]);
    expect(outcome.log).toContainEqual(
      expect.objectContaining({
        key: 'battle.log.skill',
        vars: expect.objectContaining({ amount: 7 }),
      }),
    );
  });

  it('defending 态传递给 DamageInput（减免由 DamageFn 消费，B 线）', () => {
    const hero = unit('hero', 'player');
    const slime = unit('slime', 'enemy', { defending: true });
    const captured: DamageInput[] = [];
    const executor = createEffectExecutor({
      damageFn: (input) => {
        captured.push(input);
        return { amount: 3 };
      },
    });
    executor(
      { kind: 'skill', skillId: 'slash', targetUid: 'slime' },
      { actor: hero, units: new Map([[slime.uid, slime]]), rng: rngStub },
    );
    expect(captured[0]?.defending).toBe(true);
  });

  it('无目标技能（自身增益）只记日志、无伤害；mult 缺省 1', () => {
    const hero = unit('hero', 'player');
    const seen: number[] = [];
    const executor = createEffectExecutor({
      damageFn: (input) => {
        seen.push(input.mult);
        return { amount: 0 };
      },
    });
    const outcome = executor(
      { kind: 'skill', skillId: 'focus' },
      { actor: hero, units: new Map([[hero.uid, hero]]), rng: rngStub },
    );
    expect(outcome.damage).toBeUndefined();
    expect(seen).toEqual([]);
    expect(outcome.log).toContainEqual(
      expect.objectContaining({ key: 'battle.log.skill_nontarget' }),
    );
  });

  it('SkillRef.effects：有 applyEffects 缝 → 执行；缺缝 → effects_unwired 显性化日志', () => {
    const hero = unit('hero', 'player', {
      skills: [
        { id: 'slash', params: { mult: 1 } },
        { id: 'mend', effects: [{ add: { key: 'attr.hp', amount: 10 } }] },
      ],
    } as never);
    const applied: string[][] = [];
    const wired = createEffectExecutor({
      damageFn: () => ({ amount: 0 }),
      applyEffects: (effects) => {
        applied.push(effects.map((entry) => Object.keys(entry)[0] as string));
      },
    });
    const outcome = wired(
      { kind: 'skill', skillId: 'mend' },
      { actor: hero, units: new Map([[hero.uid, hero]]), rng: rngStub },
    );
    expect(applied).toEqual([['add']]);
    expect(outcome.damage).toBeUndefined();

    // 缺缝：显性化日志（consumeItem 同口径），不静默丢弃
    const unwired = createEffectExecutor({ damageFn: () => ({ amount: 0 }) });
    const outcome2 = unwired(
      { kind: 'skill', skillId: 'mend' },
      { actor: hero, units: new Map([[hero.uid, hero]]), rng: rngStub },
    );
    expect(outcome2.log).toContainEqual(
      expect.objectContaining({
        key: 'battle.log.effects_unwired',
        vars: expect.objectContaining({ skill: 'mend' }),
      }),
    );
  });

  it('item：consumeItem 缝先扣再记日志；缺省只记日志（显性化）', () => {
    const hero = unit('hero', 'player');
    const consumed: string[] = [];
    const executor = createEffectExecutor({
      damageFn: () => ({ amount: 0 }),
      consumeItem: (id) => consumed.push(id),
    });
    executor({ kind: 'item', itemId: 'warm_bun' }, { actor: hero, units: new Map(), rng: rngStub });
    expect(consumed).toEqual(['warm_bun']);

    const lax = createEffectExecutor({ damageFn: () => ({ amount: 0 }) });
    const outcome = lax(
      { kind: 'item', itemId: 'warm_bun' },
      { actor: hero, units: new Map(), rng: rngStub },
    );
    expect(outcome.log).toContainEqual(expect.objectContaining({ key: 'battle.log.item' }));
  });
});
