import { describe, expect, it } from 'vitest';
import type { EventDef } from '@game/shared';
import { createRng } from '@game/shared';
import { DEFAULT_TIME_CONFIG } from '../../src/time/index.js';
import { compileExpr, createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { buildPoolIndex } from '../../src/loader/compile.js';
import { EventPool } from '../../src/events/pool.js';

/**
 * 10 任务 10：性能基准（NFR-02，设计 §4.4「16ms 预算」）。
 *
 * 夹具与断言（NFR-02 原文「1000 事件规模 + 每时段仅 3% 事件重算」）：
 * 1. 全量评估（包加载后首推口径）在 16ms 预算内——CI 机器波动大，取 5× 容差；
 * 2. 脏标记命中 3% 时，**实际求值的 require 数 ≤ 3%**（不轮询的机械化守护）。
 *
 * 不用「增量比全量快」的时间断言：脏标记多一次过滤（隔离成本），其收益体现
 * 在求值次数（真实表达式求值含作用域构建，远贵于过滤）；以计数断言更贴近
 * NFR-02 的语义且抗机器波动。
 */

const EVENT_COUNT = 1000;
/** 命中比例（NFR-02 口径：每时段约 3% 事件重算） */
const HIT_COUNT = 30;

/** 构造 N 个事件（每事件一条独立 flag 路径；部分带窗口与冷却） */
function buildEvents(count: number): EventDef[] {
  const events: EventDef[] = [];
  for (let i = 0; i < count; i++) {
    const withCooldown = i % 33 === 0;
    events.push({
      id: `ev_${i}`,
      where: { area: 'area_big' },
      when: i % 7 === 0 ? { slots: ['slot_morning'] } : {},
      trigger: withCooldown
        ? { type: 'random', weight: 1, require: `flag.f${i}`, cooldown: { days: 1 } }
        : { type: 'condition', require: `flag.f${i}`, priority: i % 5 },
      scene: `scene_${i}`,
    } as EventDef);
  }
  return events;
}

function makeIndex(events: readonly EventDef[]) {
  const registry = createBuiltinFunctionRegistry();
  const cache = new Map<string, ReturnType<typeof compileExpr>>();
  for (const event of events) {
    const require = 'require' in event.trigger ? event.trigger.require : undefined;
    if (require !== undefined) cache.set(require, compileExpr(require, registry));
  }
  return buildPoolIndex({ events, quests: new Map(), achievements: new Map() } as never, cache);
}

const EVENTS = buildEvents(EVENT_COUNT);
const POOL_INDEX = makeIndex(EVENTS);

/** 状态切片（冷却面为空即可；基准只测评估路径） */
function emptyState() {
  return {
    world: {
      time: { day: 1, slotIndex: 0 },
      eventCooldowns: {} as Record<string, { lastDay: number; fired: number }>,
    },
  };
}

function makePool(options?: { debug?: boolean }) {
  const registry = createBuiltinFunctionRegistry();
  const cache = new Map<string, ReturnType<typeof compileExpr>>();
  return new EventPool({
    events: EVENTS,
    poolIndex: POOL_INDEX,
    area: 'area_big',
    config: DEFAULT_TIME_CONFIG,
    evalRequire: (source) => {
      let compiled = cache.get(source);
      if (compiled === undefined) {
        compiled = compileExpr(source, registry);
        cache.set(source, compiled);
      }
      return false; // 基准只测评估路径开销（求值结果不影响路径）
    },
    ...(options?.debug !== undefined ? { debugLog: options.debug } : {}),
  });
}

describe('10-10 性能基准：1000 事件池（NFR-02）', () => {
  it('全量评估（首推口径）在 16ms 预算内（CI 容差 5×，即 80ms 上限）', () => {
    const pool = makePool();
    const start = performance.now();
    pool.evaluate({
      state: emptyState() as never,
      evalCondition: () => false,
      rng: createRng(1),
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(80);
  });

  it('脏标记命中 3%（30/1000）：实际求值数 ≤ 命中数（只重算受影响事件，NFR-02）', () => {
    const pool = makePool({ debug: true });
    // 触碰 30 条独立 flag 路径 = 命中 30 个事件（3%）
    const touched = Array.from({ length: HIT_COUNT }, (_, i) => `world.flags.f${i * 33}`);
    pool.evaluate({
      state: emptyState() as never,
      evalCondition: () => false,
      rng: createRng(1),
      touched,
    });
    const entry = pool.debugEntries()[0];
    const evaluated = entry?.evaluated.length ?? 0;
    // 命中 30 个事件（其中带 cooldown 的为 random 型，同样计入求值）
    expect(evaluated).toBeLessThanOrEqual(HIT_COUNT);
    // 且远小于全量（3% 口径）
    expect(evaluated).toBeLessThan(EVENT_COUNT * 0.05);
  });

  it('1000 事件规模下增量评估仍在 16ms 预算内', () => {
    const pool = makePool();
    const touched = Array.from({ length: HIT_COUNT }, (_, i) => `world.flags.f${i * 33}`);
    const start = performance.now();
    pool.evaluate({
      state: emptyState() as never,
      evalCondition: () => false,
      rng: createRng(1),
      touched,
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(80);
  });
});
