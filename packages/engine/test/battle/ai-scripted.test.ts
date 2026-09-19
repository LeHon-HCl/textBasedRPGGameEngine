import { describe, expect, it } from 'vitest';
import { EngineError, createRng } from '@game/shared';
import { createAiResolver } from '../../src/battle/ai.js';
import type { AiPolicy, BattleUnit } from '../../src/battle/types.js';

/**
 * AI scripted 策略（16 号 W4 子任务 6b，设计 §5.2「表达式序列，首个满足者」）。
 *
 * 语义：sequence 取首个 when 满足者（求值短路）；全不满足 = EFFECT_FAILED
 * 显性化——作者以「末条省略 when」表达兜底（数据错误不静默，与 weighted 空
 * 候选同一显性化口径）。
 */

const RNG = createRng(42);

function enemy(policy: AiPolicy): BattleUnit {
  return {
    uid: 'enemy_1',
    side: 'enemy',
    nameKey: 'enemies.rat.name',
    hp: 10,
    maxHp: 10,
    attrs: { atk: 4, def: 1, spd: 6 },
    statuses: [],
    skills: [{ id: 'bite' }],
    ai: policy,
  };
}

describe('scripted 策略：表达式序列首中', () => {
  const policy: AiPolicy = {
    kind: 'scripted',
    sequence: [
      { when: 'enemy.hp < 3', action: { kind: 'skill', skillId: 'frenzy' } },
      { when: 'enemy.hp < 8', action: { kind: 'skill', skillId: 'bite' } },
      { action: { kind: 'defend' } },
    ],
  };

  it('首个满足者胜出（优先级即书写顺序）', () => {
    const resolve = createAiResolver({
      rng: RNG,
      evalCondition: (expr) => expr === 'enemy.hp < 8',
    });
    expect(resolve(enemy(policy))).toEqual({ kind: 'skill', skillId: 'bite' });
  });

  it('求值短路：命中后不再求值后续 when', () => {
    const seen: string[] = [];
    const resolve = createAiResolver({
      rng: RNG,
      evalCondition: (expr) => {
        seen.push(expr);
        return expr === 'enemy.hp < 3';
      },
    });
    expect(resolve(enemy(policy))).toEqual({ kind: 'skill', skillId: 'frenzy' });
    expect(seen).toEqual(['enemy.hp < 3']);
  });

  it('末条省略 when = 兜底（全不满足时可达）', () => {
    const resolve = createAiResolver({ rng: RNG, evalCondition: () => false });
    expect(resolve(enemy(policy))).toEqual({ kind: 'defend' });
  });

  it('全不满足且无兜底 → EFFECT_FAILED（与 weighted 空候选同一显性化口径）', () => {
    const noFallback: AiPolicy = {
      kind: 'scripted',
      sequence: [{ when: 'a', action: { kind: 'skill', skillId: 'x' } }],
    };
    const resolve = createAiResolver({ rng: RNG, evalCondition: () => false });
    expect(() => resolve(enemy(noFallback))).toThrowError(EngineError);
  });

  it('item 行动透传（引用物品 id；消耗归 W2 的 consumeItem 缝）', () => {
    const itemPolicy: AiPolicy = {
      kind: 'scripted',
      sequence: [{ action: { kind: 'item', itemId: 'warm_bun', targetUid: 'enemy_1' } }],
    };
    const resolve = createAiResolver({ rng: RNG, evalCondition: () => true });
    expect(resolve(enemy(itemPolicy))).toEqual({
      kind: 'item',
      itemId: 'warm_bun',
      targetUid: 'enemy_1',
    });
  });

  it('scripted 不消耗随机（剧本确定性——rng 序列只被 weighted/逃跑/行动序消费）', () => {
    const resolve = createAiResolver({ rng: createRng(7), evalCondition: () => false });
    const first = resolve(enemy(policy));
    const again = resolve(enemy(policy));
    expect(first).toEqual(again);
  });
});
