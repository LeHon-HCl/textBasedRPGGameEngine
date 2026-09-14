import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import {
  QUEST_STATES,
  QUEST_TRANSITIONS,
  assertTransition,
  canTransition,
  transitionVias,
} from '../../src/quests/transitions.js';
import type { QuestStateEnum } from '../../src/quests/types.js';

/**
 * 11 任务 1：QuestMachine 六态迁移规则表（§4.5）。
 *
 * 表驱动全矩阵：6×6 全部状态对的合法性与触发方式逐一锁定；终态无出边；
 * 非法迁移经 assertTransition 统一抛 EFFECT_FAILED{op:'quest'}（拒绝可读）。
 */

/** 规则表期望矩阵（行 from，列 to）：合法 = 一组触发方式 */
const EXPECTED: Record<QuestStateEnum, Partial<Record<QuestStateEnum, string[]>>> = {
  undiscovered: { available: ['reveal'], active: ['accept'] },
  available: { active: ['accept'] },
  active: {
    active: ['stage'],
    ready_to_submit: ['stage'],
    done: ['complete'],
    failed: ['fail'],
  },
  ready_to_submit: { done: ['complete', 'submit'], failed: ['fail'] },
  done: {},
  failed: {},
};

describe('11-1 六态迁移规则表：全矩阵', () => {
  it('六态全集与顺序（undiscovered→available→active→ready_to_submit→done/failed）', () => {
    expect(QUEST_STATES).toEqual([
      'undiscovered',
      'available',
      'active',
      'ready_to_submit',
      'done',
      'failed',
    ]);
  });

  it('6×6 全状态对：canTransition 与 transitionVias 匹配期望矩阵', () => {
    for (const from of QUEST_STATES) {
      for (const to of QUEST_STATES) {
        const expected = EXPECTED[from][to] ?? [];
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected.length > 0);
        expect([...transitionVias(from, to)].sort(), `${from} → ${to} vias`).toEqual(
          [...expected].sort(),
        );
      }
    }
  });

  it('规则表无重复（from,to,via 唯一）', () => {
    const seen = new Set<string>();
    for (const rule of QUEST_TRANSITIONS) {
      const key = `${rule.from}->${rule.to}:${rule.via}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it('终态 done / failed 无出边（不可复活）', () => {
    for (const terminal of ['done', 'failed'] as const) {
      expect(QUEST_TRANSITIONS.filter((rule) => rule.from === terminal)).toEqual([]);
    }
  });
});

describe('11-1 assertTransition：非法迁移显性失败', () => {
  it('合法迁移静默通过', () => {
    expect(() => assertTransition('active', 'ready_to_submit', 'stage')).not.toThrow();
    expect(() => assertTransition('ready_to_submit', 'done', 'submit')).not.toThrow();
  });

  it('非法迁移抛 EFFECT_FAILED，where.op=quest 且 detail 可读', () => {
    try {
      assertTransition('done', 'active', 'accept');
      expect.unreachable('done → active 应当失败');
    } catch (err) {
      const error = err as EngineError;
      expect(error.code).toBe('EFFECT_FAILED');
      expect(error.where.op).toBe('quest');
      expect(error.where.detail).toContain('done → active');
    }
  });

  it('终态不可跳回 active / failed 不可转 done', () => {
    for (const bad of [
      ['failed', 'active'],
      ['failed', 'done'],
      ['done', 'failed'],
    ] as const) {
      expect(canTransition(bad[0], bad[1])).toBe(false);
    }
  });
});
