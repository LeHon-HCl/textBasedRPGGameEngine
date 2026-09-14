import { describe, expect, it } from 'vitest';
import type { EventDef } from '@game/shared';
import type { GameState } from '../../src/state/index.js';
import { createRng } from '@game/shared';
import { DEFAULT_TIME_CONFIG } from '../../src/time/index.js';
import {
  collectCandidates,
  pruneCandidates,
  selectCandidates,
} from '../../src/events/evaluator.js';

/**
 * 10 任务 2/3/4：事件池评估流程 collect → prune → select（设计 §4.4）。
 *
 * - collect：byScope 按 `${area}/${location ?? '*'}` 取候选 + 静态窗口过滤
 *  （when.slots / when.weekdays；时段/星期名以 TimeConfig 命名比对）；
 * - prune：冷却（cooldown.days/slots 对 world.time 与 eventCooldowns）、
 *   once（'save' 已触发即裁剪；'loop' 随周目重置——19 号接入前按 save 口径
 *   处理并注明）、内容过滤（ContentFilter.eventAdmissible）；
 * - select：condition 型按 priority 降序（可配 onlyFirst）；random 型
 *   Rng.weighted 抽取 + mutexGroup 约束（同组至多一个）。
 */

/** 事件定义快捷构造 */
function event(id: string, overrides: Partial<EventDef> = {}): EventDef {
  return {
    id,
    where: { area: 'area_town' },
    when: {},
    trigger: { type: 'condition', require: 'flag.always' },
    scene: 'ev_scene',
    ...overrides,
  } as EventDef;
}

/** 最小状态（时间/冷却/flag 面） */
function makeState(init?: {
  day?: number;
  slotIndex?: number;
  cooldowns?: GameState['world']['eventCooldowns'];
  flags?: Record<string, boolean>;
}): GameState {
  const slotIndex = init?.slotIndex ?? 0;
  const day = init?.day ?? 1;
  return {
    world: {
      time: { day, slotIndex, week: 0 },
      eventCooldowns: init?.cooldowns ?? {},
      flags: init?.flags ?? {},
    },
  } as unknown as GameState;
}

/** 求值桩：source → 真值（未登记者 false） */
function cond(map: Record<string, boolean> = {}) {
  return (source: string): boolean => map[source] === true;
}

const CONFIG = DEFAULT_TIME_CONFIG;

describe('10-2 collect：作用域候选 + 静态窗口过滤', () => {
  const events = [
    event('ev_area_any', { where: { area: 'area_town' } }),
    event('ev_gate', { where: { area: 'area_town', location: 'gate' } }),
    event('ev_other_area', { where: { area: 'area_forest' } }),
  ];

  it('按 area/location 取候选：地点事件 + 区域通配事件；不含其他区域', () => {
    const collected = collectCandidates(events, 'area_town', 'gate');
    expect(collected.map((e) => e.id)).toEqual(['ev_area_any', 'ev_gate']);
  });

  it('location 缺省（未指定地点）只取通配事件', () => {
    const collected = collectCandidates(events, 'area_town', undefined);
    expect(collected.map((e) => e.id)).toEqual(['ev_area_any']);
  });

  it('when.slots 过滤：当前时段名不在列表 → 裁剪（TimeConfig 命名比对）', () => {
    const withWindow = [
      event('ev_morning', { when: { slots: ['slot_morning'] } }),
      event('ev_night', { when: { slots: ['slot_night'] } }),
    ];
    // slotIndex 0 = slot_morning
    const collected = collectCandidates(withWindow, 'area_town', undefined, {
      config: CONFIG,
      clock: { day: 1, slotIndex: 0, week: 0 },
    });
    expect(collected.map((e) => e.id)).toEqual(['ev_morning']);
  });

  it('when.weekdays 过滤：星期名比对（startWeekday 校准）', () => {
    const withWeekday = [
      event('ev_wd1', { when: { weekdays: ['1'] } }),
      event('ev_wd3', { when: { weekdays: ['3'] } }),
    ];
    // day 1 → weekday '1'（startWeekday=1 口径）
    const collected = collectCandidates(withWeekday, 'area_town', undefined, {
      config: CONFIG,
      clock: { day: 1, slotIndex: 0, week: 0 },
    });
    expect(collected.map((e) => e.id)).toEqual(['ev_wd1']);
  });
});

describe('10-3 prune：冷却 / once / 内容过滤', () => {
  it('冷却未过（days）：距上次触发天数不足 → 裁剪；满足 → 保留', () => {
    const events = [
      event('ev_cool', { trigger: { type: 'random', weight: 1, cooldown: { days: 2 } } }),
    ];
    // 上次触发 day 1；当前 day 2（差 1 < 2）→ 裁剪
    const pruned = pruneCandidates(
      events,
      makeState({ day: 2, cooldowns: { ev_cool: { lastDay: 1, fired: 1 } } }),
    );
    expect(pruned.map((e) => e.id)).toEqual([]);
    // 当前 day 3（差 2 ≥ 2）→ 保留
    const ok = pruneCandidates(
      events,
      makeState({ day: 3, cooldowns: { ev_cool: { lastDay: 1, fired: 1 } } }),
    );
    expect(ok.map((e) => e.id)).toEqual(['ev_cool']);
  });

  it('冷却未过（slots）：以绝对时段计数判定（day×每日时段数 + slotIndex）', () => {
    const slotsPerDay = CONFIG.slots.length;
    const events = [
      event('ev_slotcool', { trigger: { type: 'random', weight: 1, cooldown: { slots: 3 } } }),
    ];
    // 上次触发 day1/slot1；当前 day1/slot3（差 2 < 3）→ 裁剪
    const pruned = pruneCandidates(
      events,
      makeState({ day: 1, slotIndex: 3, cooldowns: { ev_slotcool: { lastDay: 1, fired: 1 } } }),
      {
        config: CONFIG,
        lastSlotIndex: { ev_slotcool: 1 },
      },
    );
    expect(pruned.map((e) => e.id)).toEqual([]);
    void slotsPerDay;
  });

  it('once=save：已触发即裁剪（fired ≥ 1）', () => {
    const events = [
      event('ev_once', { trigger: { type: 'condition', require: 'flag.x', once: 'save' } }),
    ];
    const pruned = pruneCandidates(
      events,
      makeState({ cooldowns: { ev_once: { lastDay: 1, fired: 1 } } }),
    );
    expect(pruned.map((e) => e.id)).toEqual([]);
    const fresh = pruneCandidates(events, makeState());
    expect(fresh.map((e) => e.id)).toEqual(['ev_once']);
  });

  it('内容过滤：ContentFilter 拒绝的事件被裁剪（22 号应用点 1 正式接入）', () => {
    const events = [event('ev_tagged', { tags: ['tag_gore'] }), event('ev_clean')];
    const pruned = pruneCandidates(events, makeState(), {
      contentFilter: { eventAdmissible: (e) => !(e.tags ?? []).includes('tag_gore') },
    });
    expect(pruned.map((e) => e.id)).toEqual(['ev_clean']);
  });
});

describe('10-4 select：condition 优先级 / random 权重 + 互斥', () => {
  it('condition 型按 priority 降序全出', () => {
    const events = [
      event('ev_low', { priority: 1 }),
      event('ev_high', { priority: 10 }),
      event('ev_mid', { priority: 5 }),
    ];
    const selected = selectCandidates(
      events,
      makeState(),
      cond({ 'flag.always': true }),
      createRng(1),
    );
    expect(selected.map((c) => c.event.id)).toEqual(['ev_high', 'ev_mid', 'ev_low']);
    expect(selected.every((c) => c.reason === 'condition')).toBe(true);
  });

  it('onlyFirst：仅取 priority 最高的一个', () => {
    const events = [event('ev_low', { priority: 1 }), event('ev_high', { priority: 10 })];
    const selected = selectCandidates(
      events,
      makeState(),
      cond({ 'flag.always': true }),
      createRng(1),
      { onlyFirst: true },
    );
    expect(selected.map((c) => c.event.id)).toEqual(['ev_high']);
  });

  it('require 为假的事件不入选（condition 与 random 通用）', () => {
    const events = [event('ev_no', { trigger: { type: 'condition', require: 'flag.never' } })];
    expect(selectCandidates(events, makeState(), cond(), createRng(1))).toEqual([]);
  });

  it('random 型：固定种子加权抽取（同种子结果一致）', () => {
    const events = [
      event('ev_a', { trigger: { type: 'random', weight: 1 } }),
      event('ev_b', { trigger: { type: 'random', weight: 1 } }),
    ];
    const first = selectCandidates(events, makeState(), cond(), createRng(7));
    const second = selectCandidates(events, makeState(), cond(), createRng(7));
    expect(first.map((c) => c.event.id)).toEqual(second.map((c) => c.event.id));
    expect(first).toHaveLength(1);
    expect(first[0]?.reason).toBe('random');
  });

  it('mutexGroup：同组由 condition 型入选后，random 型同组不再入选', () => {
    const events = [
      event('ev_cond', { priority: 5, mutexGroup: 'grp' }),
      event('ev_rand', { trigger: { type: 'random', weight: 100 }, mutexGroup: 'grp' }),
    ];
    const selected = selectCandidates(
      events,
      makeState(),
      cond({ 'flag.always': true }),
      createRng(1),
    );
    expect(selected.map((c) => c.event.id)).toEqual(['ev_cond']);
  });

  it('mutexGroup：同组多个 random 至多入选一个（权重最高者优先）', () => {
    const events = [
      event('ev_heavy', { trigger: { type: 'random', weight: 1000 }, mutexGroup: 'grp' }),
      event('ev_light', { trigger: { type: 'random', weight: 1 }, mutexGroup: 'grp' }),
    ];
    const selected = selectCandidates(events, makeState(), cond(), createRng(1));
    expect(selected.map((c) => c.event.id)).toEqual(['ev_heavy']);
  });

  it('explore 型不进入自动 select（地点行动时经 exploreCandidates 呈现）', () => {
    const events = [
      event('ev_exp', { trigger: { type: 'explore', weight: 5 } }),
      event('ev_cond', { priority: 1 }),
    ];
    const selected = selectCandidates(
      events,
      makeState(),
      cond({ 'flag.always': true }),
      createRng(1),
    );
    expect(selected.map((c) => c.event.id)).toEqual(['ev_cond']);
  });
});

// ---- 10 任务 7：探索发现型子池（FR-XPLR-04③/08） ---------------------------

describe('10-7 探索子池：地点行动的交互点呈现', () => {
  it('exploreCandidates：按权重降序返回可用交互点（不消耗随机）', async () => {
    const { exploreCandidates } = await import('../../src/events/evaluator.js');
    const events = [
      event('ev_heavy', { trigger: { type: 'explore', weight: 10 } }),
      event('ev_light', { trigger: { type: 'explore', weight: 1 } }),
      event('ev_gated', {
        trigger: { type: 'explore', weight: 5, require: 'flag.locked' },
      }),
      event('ev_cond', { priority: 1 }),
    ];
    const listed = exploreCandidates(events, (source) => source !== 'flag.locked');
    expect(listed.map((c) => c.event.id)).toEqual(['ev_heavy', 'ev_light']);
    expect(listed.every((c) => c.reason === 'explore')).toBe(true);
  });

  it('explore 型条件为真时才呈现（require 过滤）', async () => {
    const { exploreCandidates } = await import('../../src/events/evaluator.js');
    const events = [
      event('ev_open', { trigger: { type: 'explore', weight: 1, require: 'flag.open' } }),
    ];
    expect(exploreCandidates(events, () => false)).toEqual([]);
    expect(exploreCandidates(events, () => true).map((c) => c.event.id)).toEqual(['ev_open']);
  });
});
