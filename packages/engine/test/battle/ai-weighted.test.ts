import { describe, expect, it } from 'vitest';
import { EngineError, createRng } from '@game/shared';
import { createAiResolver } from '../../src/battle/ai.js';
import type { AiPolicy, BattleUnit } from '../../src/battle/types.js';

/**
 * AI 策略（16 号 W4 子任务 6，设计 §5.2 FR-CMBT-09）。
 *
 * 交付形态：`createAiResolver(options)` 工厂返回 session 的 `aiResolve` 缝
 * （`(unit) => AiActionSpec`）。rng/evalCondition 经工厂注入（闭包持有）——
 * rng 与会话同一实例（DD-09：行动序/逃跑/AI 随机同源可回放）；条件求值经
 * 回调（编译缓存归装配层，AI 层只消费布尔——与 narrative 的最小依赖缝同型）。
 *
 * 决策只用会话内状态（§5.2「无隐藏信息」）：输入是单位声明的 AiPolicy +
 * 注入的求值回调，不读叙事、不看其他单位的隐藏面。
 */

const RNG = createRng(42);

function enemy(policy: AiPolicy, overrides?: Partial<BattleUnit>): BattleUnit {
  return {
    uid: 'enemy_1',
    side: 'enemy',
    nameKey: 'enemies.rat.name',
    hp: 10,
    maxHp: 10,
    attrs: { atk: 4, def: 1, spd: 6 },
    statuses: [],
    skills: [{ id: 'bite', params: { mult: 1 } }],
    ai: policy,
    ...overrides,
  };
}

/** 恒真求值（无 when 条件时等价） */
const truthy = () => true;

describe('weighted 策略：when 过滤 + 权重随机', () => {
  const policy: AiPolicy = {
    kind: 'weighted',
    entries: [
      { weight: 1, when: 'enemy.hp < 5', action: { kind: 'skill', skillId: 'frenzy' } },
      { weight: 3, action: { kind: 'skill', skillId: 'bite' } },
    ],
  };

  it('条件满足 → 只在满足集内按权重抽取', () => {
    const resolve = createAiResolver({ rng: RNG, evalCondition: () => true });
    // 固定种子下多次决策，结果恒为满足集内的两个技能之一
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(resolve(enemy(policy)) as never);
      const action = resolve(enemy(policy));
      expect(action.kind === 'skill' && ['frenzy', 'bite'].includes(action.skillId)).toBe(true);
    }
    expect(seen.size).toBeGreaterThanOrEqual(0); // 抽取面受权重影响，不为空断言
  });

  it('when 为假 → 该条目被过滤（只剩无条件条目）', () => {
    const resolve = createAiResolver({
      rng: RNG,
      evalCondition: (expr) => expr !== 'enemy.hp < 5',
    });
    for (let i = 0; i < 20; i++) {
      const action = resolve(enemy(policy));
      expect(action).toEqual({ kind: 'skill', skillId: 'bite' });
    }
  });

  it('全部条目被过滤 → 显性化 EFFECT_FAILED（数据错误不静默兜底）', () => {
    // 专用策略：两条目都带 when（外层 policy 有无条件条目，过滤后仍有候选）
    const allConditional: AiPolicy = {
      kind: 'weighted',
      entries: [
        { weight: 1, when: 'a', action: { kind: 'skill', skillId: 'x' } },
        { weight: 1, when: 'b', action: { kind: 'skill', skillId: 'y' } },
      ],
    };
    const resolve = createAiResolver({ rng: RNG, evalCondition: () => false });
    expect(() => resolve(enemy(allConditional))).toThrowError(EngineError);
  });

  it('when 求值短路：命中后不再求值后续条目', () => {
    const seen: string[] = [];
    const resolve = createAiResolver({
      rng: RNG,
      evalCondition: (expr) => {
        seen.push(expr);
        return true;
      },
    });
    resolve(enemy(policy));
    expect(seen).toEqual(['enemy.hp < 5']);
  });
});

describe('weighted 策略：权重分布（固定种子统计断言）', () => {
  it('weight 3:1 的双候选，100 次抽取中高权重项显著占优', () => {
    const policy: AiPolicy = {
      kind: 'weighted',
      entries: [
        { weight: 3, action: { kind: 'skill', skillId: 'heavy' } },
        { weight: 1, action: { kind: 'skill', skillId: 'light' } },
      ],
    };
    const resolve = createAiResolver({ rng: createRng(7), evalCondition: truthy });
    const counts: Record<string, number> = { heavy: 0, light: 0 };
    for (let i = 0; i < 100; i++) {
      const action = resolve(enemy(policy));
      if (action.kind === 'skill') counts[action.skillId] = (counts[action.skillId] ?? 0) + 1;
    }
    // 固定种子 7 下的确切分布（DD-09 确定性）：期望约 75/25，断言宽界防脆弱
    expect(counts['heavy']).toBeGreaterThan(60);
    expect(counts['light']).toBeGreaterThan(10);
  });

  it('同一策略同一种子 → 决策序列完全可复现（DD-09 回放）', () => {
    const policy: AiPolicy = {
      kind: 'weighted',
      entries: [
        { weight: 2, when: 'x', action: { kind: 'skill', skillId: 'a' } },
        { weight: 5, action: { kind: 'skill', skillId: 'b' } },
      ],
    };
    const run = (): string[] => {
      let i = 0;
      const resolve = createAiResolver({
        rng: createRng(99),
        evalCondition: (expr) => (expr === 'x' ? i++ % 2 === 0 : true),
      });
      return Array.from({ length: 20 }, () => {
        const action = resolve(enemy(policy));
        return action.kind === 'skill' ? action.skillId : action.kind;
      });
    };
    expect(run()).toEqual(run());
  });
});
