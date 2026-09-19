import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import { createDamagePresetResolver, createDefaultDamageFn } from '../../src/battle/damage.js';
import type { DamageInput } from '../../src/battle/types.js';

/**
 * 伤害公式（16 号 W4 子任务 5，设计 §5.2「与 CheckRule 同级的可插拔预设」）。
 *
 * 交付形态（对齐 W2 resolution.ts 的消费面）：
 * - `createDefaultDamageFn()`：内置公式 `atk*mult − def`，下限 0（会话统一入账
 *   并判倒下，types.ts DamageResult 口径）；**确定性**——默认公式不消耗随机
 *   （浮动留作者预设），单测可穷举边界；
 * - `createDamagePresetResolver()`：按名解析缝（与 CheckRuleResolver 同型），
 *   内置 `'default'`；作者脚本注册覆盖的接线留 23 号（阶段六），本阶段只保证
 *   「可注册、可按名解析」。
 */

function input(overrides?: Partial<DamageInput>): DamageInput {
  return {
    attacker: { atk: 10 },
    defender: { def: 3 },
    mult: 1,
    ...overrides,
  };
}

describe('createDefaultDamageFn：内置公式 atk*mult − def', () => {
  it.each([
    [10, 3, 1, 7],
    [10, 3, 2, 17],
    [10, 0, 1.5, 15],
    [10, 3, 0, 0],
  ])('atk=%i def=%i mult=%i → %i', (atk, def, mult, expected) => {
    const fn = createDefaultDamageFn();
    expect(fn(input({ attacker: { atk }, defender: { def }, mult }), createRng(1))).toEqual({
      amount: expected,
    });
  });

  it('def ≥ atk*mult → 下限 0（不出现负伤害，会话统一入账）', () => {
    const fn = createDefaultDamageFn();
    expect(
      fn(input({ attacker: { atk: 2 }, defender: { def: 5 }, mult: 1 }), createRng(1)).amount,
    ).toBe(0);
    expect(
      fn(input({ attacker: { atk: 0 }, defender: { def: 0 }, mult: 1 }), createRng(1)).amount,
    ).toBe(0);
  });

  it('确定性：同输入同输出（默认公式不消耗随机序列，DD-09 面上无隐藏随机）', () => {
    const fn = createDefaultDamageFn();
    const a = fn(input(), createRng(7));
    const b = fn(input(), createRng(999));
    expect(a).toEqual(b);
  });

  it('缺失面板键按 0 处理（守方无 def 键 = 无减免）', () => {
    const fn = createDefaultDamageFn();
    expect(fn(input({ attacker: { atk: 6 }, defender: {}, mult: 1 }), createRng(1)).amount).toBe(6);
  });
});

describe('createDamagePresetResolver：按名解析缝', () => {
  it("内置 'default' 可解析；返回的公式与 createDefaultDamageFn 同语义", () => {
    const resolver = createDamagePresetResolver();
    const fn = resolver.resolve('default');
    expect(fn).not.toBeNull();
    expect(fn?.(input(), createRng(1))).toEqual(createDefaultDamageFn()(input(), createRng(1)));
  });

  it('未知名 → null（调用方显性化，resolver 不猜）', () => {
    expect(createDamagePresetResolver().resolve('nope')).toBeNull();
  });

  it('register：新名可注册并解析；重复名报错（不静默覆盖——预设被悄悄换掉是调试黑洞）', () => {
    const resolver = createDamagePresetResolver();
    const custom = () => ({ amount: 42 });
    resolver.register('custom', custom);
    expect(resolver.resolve('custom')?.(input(), createRng(1))).toEqual({ amount: 42 });
    expect(() => resolver.register('custom', custom)).toThrowError(/custom/);
  });

  it("'default' 为保留名：不允许覆盖（内置语义漂移会波及所有未显式选预设的战斗）", () => {
    expect(() =>
      createDamagePresetResolver().register('default', () => ({ amount: 1 })),
    ).toThrowError(/default/);
  });
});
