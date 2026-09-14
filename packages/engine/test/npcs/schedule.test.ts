import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '@game/shared';
import type { Clock, NpcDef } from '@game/shared';
import { newGameState } from '../../src/state/new-game.js';
import { resolveNpcLocation } from '../../src/npcs/schedule.js';
import type { GameState } from '../../src/state/index.js';

/**
 * 12 任务 1：NPC 日程解析表驱动测试（§4.6 resolveNpcLocation）。
 *
 * 矩阵维度 = 时段 × 星期 × showIf 条件：按声明顺序取首个匹配项，
 * 无匹配（含无日程）→ null（不在场）。
 */

const VERSIONS = { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' };

/** 构造最小状态（可注入阵营声望，供 showIf 条件维度使用） */
function makeState(factions: Record<string, number> = {}): GameState {
  return newGameState({ versions: VERSIONS, attrs: { hp: 10 }, factions }, createRng(1));
}

/** NPC 定义构造器（显式传入 schedule，避免测试被目录夹具耦合） */
function npc(schedule: NpcDef['schedule']): NpcDef {
  return {
    id: 'npc_test',
    nameKey: 'npc.test.name',
    ...(schedule !== undefined ? { schedule } : {}),
  };
}

const MORNING: Clock = { day: 1, slotIndex: 0 };

describe('12-1 resolveNpcLocation：声明序匹配与缺席语义', () => {
  it('首个匹配项胜出（声明顺序优先，而非最具体）', () => {
    const def = npc([
      { at: { slots: ['morning'] }, location: 'gate' },
      { at: { slots: ['morning'] }, location: 'market' },
    ]);
    expect(resolveNpcLocation(def, MORNING, makeState(), { slot: 'morning', weekday: '1' })).toBe(
      'gate',
    );
  });

  it('时段不匹配则跳过，命中后续项', () => {
    const def = npc([
      { at: { slots: ['morning'] }, location: 'gate' },
      { at: { slots: ['night'] }, location: 'market' },
    ]);
    expect(resolveNpcLocation(def, MORNING, makeState(), { slot: 'night', weekday: '1' })).toBe(
      'market',
    );
  });

  it('星期过滤：weekdays 不含当日则跳过（与 slots 是与关系）', () => {
    const def = npc([
      { at: { slots: ['morning'], weekdays: ['3', '5'] }, location: 'gate' },
      { at: { slots: ['morning'], weekdays: ['1'] }, location: 'market' },
    ]);
    expect(resolveNpcLocation(def, MORNING, makeState(), { slot: 'morning', weekday: '1' })).toBe(
      'market',
    );
    expect(resolveNpcLocation(def, MORNING, makeState(), { slot: 'morning', weekday: '3' })).toBe(
      'gate',
    );
  });

  it('showIf 为假则跳过（条件维度）；全表不匹配即不在场', () => {
    const def = npc([
      { at: { slots: ['morning'] }, location: 'market', showIf: 'faction.town >= 0' },
    ]);
    const negative = makeState({ town: -3 });
    const positive = makeState({ town: 0 });
    expect(
      resolveNpcLocation(def, MORNING, negative, { slot: 'morning', weekday: '1' }),
    ).toBeNull();
    expect(resolveNpcLocation(def, MORNING, positive, { slot: 'morning', weekday: '1' })).toBe(
      'market',
    );
  });

  it('缺失 slots/weekdays 的项视为全天候通配（仅受 showIf 约束）', () => {
    const def = npc([{ at: {}, location: 'plaza' }]);
    expect(resolveNpcLocation(def, MORNING, makeState(), { slot: 'night', weekday: '6' })).toBe(
      'plaza',
    );
  });

  it('无日程声明 / 日程为空 / 无匹配 → null（不在场）', () => {
    expect(resolveNpcLocation(npc(undefined), MORNING, makeState())).toBeNull();
    expect(resolveNpcLocation(npc([]), MORNING, makeState())).toBeNull();
    expect(
      resolveNpcLocation(
        npc([{ at: { slots: ['night'] }, location: 'market' }]),
        MORNING,
        makeState(),
        {
          slot: 'morning',
          weekday: '1',
        },
      ),
    ).toBeNull();
  });
});

describe('12-1 resolveNpcLocation：时段/星期缺省投影', () => {
  it('未显式给 query 时按 defaultTimeView 口径（slot=slotIndex 数值串、weekday=(day-1)%7+1）', () => {
    const def = npc([{ at: { slots: ['2'], weekdays: ['7'] }, location: 'dock' }]);
    // day=7 → weekday '7'，slotIndex=2 → slot '2'
    expect(resolveNpcLocation(def, { day: 7, slotIndex: 2 }, makeState())).toBe('dock');
    expect(resolveNpcLocation(def, { day: 8, slotIndex: 2 }, makeState())).toBeNull();
  });
});

describe('12-1 resolveNpcLocation：showIf 严格错误语义（DD-01）', () => {
  it('非法 showIf 表达式 → EXPR_COMPILE（不静默跳过）', () => {
    const def = npc([{ at: {}, location: 'gate', showIf: 'unknown_root.x > 1' }]);
    try {
      resolveNpcLocation(def, MORNING, makeState(), { slot: 'morning', weekday: '1' });
      expect.unreachable('非法表达式应当失败');
    } catch (err) {
      expect((err as EngineError).code).toBe('EXPR_COMPILE');
    }
  });

  it('showIf 经注入求值器判定（宿主可复用运行时注册表）', () => {
    const def = npc([{ at: {}, location: 'gate', showIf: 'gate_open' }]);
    const seen: string[] = [];
    const query = {
      slot: 'morning',
      weekday: '1',
      evaluate: (source: string): boolean => {
        seen.push(source);
        return source === 'gate_open';
      },
    };
    expect(resolveNpcLocation(def, MORNING, makeState(), query)).toBe('gate');
    expect(seen).toEqual(['gate_open']);
  });
});
