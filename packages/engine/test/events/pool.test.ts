import { describe, expect, it } from 'vitest';
import type { EventDef } from '@game/shared';
import { createRng } from '@game/shared';
import { DEFAULT_TIME_CONFIG, TimePipeline } from '../../src/time/index.js';
import { BASE_VERSIONS, makeEffectRuntime } from '../effects/fixtures.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import { buildPoolIndex } from '../../src/loader/compile.js';
import { compileExpr, createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { EventPool } from '../../src/events/pool.js';
import { createEventStepProvider } from '../../src/events/step.js';

/**
 * 10 任务 5/6/9：dispatch（冷却登记）、脏标记增量、debugLog、管线挂载。
 *
 * 测试口径：以**自持的可变状态切片**直调 `pool.evaluate`（纯逻辑面；冷却经
 * 返回的 cooldownUpdates 应用，与内部指令在 draft 上的写法一致）；另有一个
 * 集成用例走真实 `__events.eval` + TimePipeline（端到端接线验证）。
 */

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

const EVENTS: EventDef[] = [
  event('ev_always', { priority: 10 }),
  event('ev_flagged', { trigger: { type: 'condition', require: 'flag.special' } }),
  event('ev_random', { trigger: { type: 'random', weight: 1, cooldown: { days: 3 } } }),
  event('ev_explore', { trigger: { type: 'explore', weight: 1 } }),
];

/** 借 loader 的 buildPoolIndex 构造索引（dirtyMap 口径与生产一致） */
function makePoolIndex(events: readonly EventDef[]) {
  const registry = createBuiltinFunctionRegistry();
  const exprCache = new Map<string, ReturnType<typeof compileExpr>>();
  for (const def of events) {
    if ('require' in def.trigger && def.trigger.require !== undefined) {
      exprCache.set(def.trigger.require, compileExpr(def.trigger.require, registry));
    }
  }
  return buildPoolIndex({ events, quests: new Map(), achievements: new Map() } as never, exprCache);
}

/** 测试自持状态切片（可写；模拟事务 draft 面） */
interface MutableState {
  world: {
    time: { day: number; slotIndex: number };
    eventCooldowns: Record<string, { lastDay: number; lastSlotIndex?: number; fired: number }>;
  };
}

/** flag 名提取：'flag.always' → 'always'；'flag("x")' 形态 → 'x' */
function flagName(source: string): string {
  const call = /flag\(\s*['"]([^'"]+)['"]\s*\)/.exec(source);
  if (call !== null) return call[1] as string;
  return source.replace(/^flag\./, '');
}

function makeHarness(options?: {
  events?: readonly EventDef[];
  debug?: boolean;
  flags?: Record<string, boolean>;
  day?: number;
  slotIndex?: number;
}) {
  const events = options?.events ?? EVENTS;
  const flags = options?.flags ?? { always: true };
  const state: MutableState = {
    world: {
      time: { day: options?.day ?? 1, slotIndex: options?.slotIndex ?? 0 },
      eventCooldowns: {},
    },
  };
  const evalCondition = (source: string): boolean => flags[flagName(source)] === true;
  const pool = new EventPool({
    events,
    poolIndex: makePoolIndex(events),
    area: 'area_town',
    config: DEFAULT_TIME_CONFIG,
    evalRequire: evalCondition,
    ...(options?.debug !== undefined ? { debugLog: options.debug } : {}),
  });
  /** 评估并按内部指令口径应用冷却更新 */
  const run = (touched?: readonly string[]) => {
    const result = pool.evaluate({
      state: state as never,
      evalCondition,
      rng: createRng(1),
      ...(touched !== undefined ? { touched } : {}),
    });
    for (const update of result.cooldownUpdates) {
      state.world.eventCooldowns[update.eventId] = {
        lastDay: update.lastDay,
        fired: update.fired,
        ...(update.lastSlotIndex !== undefined ? { lastSlotIndex: update.lastSlotIndex } : {}),
      };
    }
    return result;
  };
  return { pool, state, run };
}

describe('10-5 dispatch：冷却登记与跳转产出', () => {
  it('入选事件登记 eventCooldowns（lastDay/lastSlotIndex/fired）', () => {
    const h = makeHarness();
    h.run();
    expect(h.state.world.eventCooldowns['ev_always']).toEqual({
      lastDay: 1,
      lastSlotIndex: 0,
      fired: 1,
    });
  });

  it('dispatch 产出场景跳转（子会话启动归 SceneRunner eventSceneIds）', () => {
    const h = makeHarness();
    expect(h.run().jumps).toContainEqual({ type: 'scene', scene: 'ev_scene' });
  });

  it('once=save 事件触发后不再入选（fired 不增）', () => {
    const events = [
      event('ev_once', {
        trigger: { type: 'condition', require: 'flag.always', once: 'save' },
      }),
    ];
    const h = makeHarness({ events });
    h.run();
    expect(h.state.world.eventCooldowns['ev_once']?.fired).toBe(1);
    h.run();
    expect(h.state.world.eventCooldowns['ev_once']?.fired).toBe(1);
  });
});

describe('10-6 脏标记增量：不轮询', () => {
  it('require 假的事件记录为未触发（require 原因）', () => {
    const h = makeHarness({ debug: true });
    h.run();
    const entry = h.pool.debugEntries()[0];
    expect(entry?.untriggered.some((u) => u.event === 'ev_flagged' && u.reason === 'require')).toBe(
      true,
    );
  });

  it('未指定 touched = 全量评估（首推口径）；touched 未命中 → 零求值', () => {
    const full = makeHarness({ debug: true });
    full.run();
    expect(full.pool.debugEntries()[0]?.evaluated.length ?? 0).toBeGreaterThan(0);

    const dirty = makeHarness({ debug: true });
    dirty.run(['player.attrs.hp']);
    expect(dirty.pool.debugEntries()[0]?.evaluated).toEqual([]);
  });

  it('触碰 flag.special → 仅该事件被求值（脏标记精确）', () => {
    const h = makeHarness({ debug: true, flags: { always: true, special: true } });
    h.run(['world.flags.special']);
    expect(h.pool.debugEntries()[0]?.evaluated).toEqual(['flag.special']);
  });
});

describe('10-9 debugLog：阶段记录与未触发原因（FR-DEBG-05）', () => {
  it('开启 debug：记录 collect/selected/untriggered（含 explore 原因）', () => {
    const h = makeHarness({ debug: true });
    h.run();
    const entry = h.pool.debugEntries()[0];
    expect(entry?.collected).toBeGreaterThan(0);
    expect(entry?.selected.map((s) => s.event)).toContain('ev_always');
    expect(entry?.untriggered.some((u) => u.event === 'ev_explore' && u.reason === 'explore')).toBe(
      true,
    );
  });

  it('未开启 debug：debugEntries 为空（FR-DEBG-05 仅 debug 会话记录）', () => {
    const h = makeHarness({ debug: false });
    h.run();
    expect(h.pool.debugEntries()).toEqual([]);
  });

  it('缺失 location 的事件不入选（作用域过滤）', () => {
    const events = [
      event('ev_elsewhere', { where: { area: 'area_town', location: 'market' } }),
      event('ev_here'),
    ];
    const h = makeHarness({ events, debug: true });
    h.run();
    expect(h.pool.debugEntries()[0]?.selected.map((s) => s.event)).toEqual(['ev_here']);
  });
});

describe('10-5 管线挂载：__events.eval 端到端', () => {
  it('eventPool 注入注册表 + 步骤 provider 挂载后，推进即评估并登记冷却', () => {
    const compiledCache = new Map<string, ReturnType<typeof compileExpr>>();
    const fnRegistry = createBuiltinFunctionRegistry();
    // 池的 require 求值需要一个运行时面；先建运行时再回填池（延迟绑定模式）
    const rtRef: { current?: ReturnType<typeof makeEffectRuntime>['rt'] } = {};
    const pool = new EventPool({
      events: EVENTS,
      poolIndex: makePoolIndex(EVENTS),
      area: 'area_town',
      config: DEFAULT_TIME_CONFIG,
      evalRequire: (source) => {
        let compiled = compiledCache.get(source);
        if (compiled === undefined) {
          compiled = compileExpr(source, fnRegistry);
          compiledCache.set(source, compiled);
        }
        return rtRef.current?.evalCondition(compiled) ?? false;
      },
    });
    const registry = createBuiltinEffectRegistry({
      timeConfig: DEFAULT_TIME_CONFIG,
      eventPool: pool as never,
    });
    const { rt } = makeEffectRuntime({
      registry,
      bootstrap: {
        versions: BASE_VERSIONS,
        attrs: { hp: 10 },
        flags: { always: true },
      },
    });
    rtRef.current = rt;
    const pipeline = new TimePipeline({
      runtime: rt,
      config: DEFAULT_TIME_CONFIG,
      eventEval: createEventStepProvider(),
    });
    pipeline.advance(1);
    expect(rt.state.world.eventCooldowns['ev_always']?.fired).toBe(1);
  });
});
