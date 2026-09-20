import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import { compileExpr, evalExpr } from '../../src/expr-eval/index.js';
import type { ExprScope } from '@game/shared';

/**
 * battle 表达式域测试（16 号偏差③，battle.* v1 清单 2026-09-19 人类确认）：
 * 路径形态（compile 白名单）+ 求值语义（封闭域）+ 作用域缺席显性化。
 */

const SCOPE: ExprScope = {
  battle: {
    self: { hp: 7, maxHp: 30, attrs: { atk: 9, spd: 12 } },
    enemiesAlive: 2,
    alliesAlive: 1,
    round: 3,
  },
} as unknown as ExprScope;

const REGISTRY = new Map();
const RNG = createRng(1);

function evalSrc(source: string, scope: ExprScope = SCOPE): unknown {
  return evalExpr(compileExpr(source, REGISTRY), { state: scope, rng: RNG, registry: REGISTRY });
}

describe('battle 表达式域：路径形态（compile 白名单，battle.* v1）', () => {
  it('合法形态编译通过：round / self.hp / self.<attr> / enemies.alive / allies.alive', () => {
    for (const source of [
      'battle.round',
      'battle.self.hp',
      'battle.self.maxHp',
      'battle.self.atk',
      'battle.enemies.alive',
      'battle.allies.alive',
    ]) {
      expect(() => compileExpr(source, REGISTRY), source).not.toThrow();
    }
  });

  it('非法形态 EXPR_COMPILE：未知子路径 / target.*（v1 明确不做）/ 随机相关域', () => {
    for (const source of [
      'battle.self.hp.extra',
      'battle.enemies',
      'battle.target.hp',
      'battle.nonsense',
    ]) {
      expect(() => compileExpr(source, REGISTRY), source).toThrowError(/battle 路径应为/);
    }
  });
});

describe('battle 表达式域：求值语义（封闭域）', () => {
  it('数值取值：self.hp / maxHp / attr / enemies.alive / allies.alive / round', () => {
    expect(evalSrc('battle.self.hp')).toBe(7);
    expect(evalSrc('battle.self.maxHp')).toBe(30);
    expect(evalSrc('battle.self.atk')).toBe(9);
    expect(evalSrc('battle.enemies.alive')).toBe(2);
    expect(evalSrc('battle.allies.alive')).toBe(1);
    expect(evalSrc('battle.round')).toBe(3);
  });

  it('条件表达式：残血判断（AI when 典型写法）', () => {
    expect(evalSrc('battle.self.hp < battle.self.maxHp * 0.3')).toBe(true); // 7 < 9（30×0.3）
    expect(evalSrc('battle.self.hp < battle.self.maxHp * 0.2')).toBe(false); // 7 < 6 不成立
    expect(evalSrc('battle.round >= 2 && battle.enemies.alive > 1')).toBe(true);
  });

  it('未声明的面板 attr → EVAL_ERROR（封闭域，无静默 0）', () => {
    expect(() => evalSrc('battle.self.defense')).toThrowError();
  });

  it('作用域缺席（非战斗上下文）→ EVAL_ERROR 显性化，不静默恒真', () => {
    expect(() => evalSrc('battle.round', {} as unknown as ExprScope)).toThrowError();
  });
});
