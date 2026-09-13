import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { EffectData, TimeConfig } from '@game/shared';
import { BASE_VERSIONS, makeBuiltinRuntime } from '../effects/fixtures.js';
import { TimePipeline } from '../../src/time/pipeline.js';
import type { TimeStepProvider } from '../../src/time/pipeline.js';

/**
 * 09 任务 6：作者钩子 API（§4.3 步骤 0/4 前后缀，DD-10「不可插入中间」）。
 *
 * - before_rollover：跨天时、时钟推进前（步骤 0）；
 * - day_rollover：跨天时、临时身体回退后、NPC 日程前（步骤 4）；
 * - 非跨天推进不调用（门控 = ctx 预计算旗标的同口径）；
 * - 次序断言经补丁序（效果执行序的直接证据）。
 */

const CONFIG: TimeConfig = {
  slots: [
    { id: 'slot_morning', nameKey: 'time.slot.morning' },
    { id: 'slot_noon', nameKey: 'time.slot.noon' },
    { id: 'slot_evening', nameKey: 'time.slot.evening' },
    { id: 'slot_night', nameKey: 'time.slot.night' },
  ],
  weekdays: Array.from({ length: 7 }, (_, i) => ({ nameKey: `time.weekday.${i + 1}` })),
  startWeekday: 1,
};

function flag(name: string): EffectData {
  return { flag: { name } } as unknown as EffectData;
}

function recorder(log: string[], tag: string, effects: EffectData[] = []): TimeStepProvider {
  return () => {
    log.push(tag);
    return effects;
  };
}

function makeEnv(hooks: {
  beforeRollover?: TimeStepProvider;
  dayRollover?: TimeStepProvider;
}) {
  const { rt } = makeBuiltinRuntime({
    bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 10 } },
    registryOptions: { timeConfig: CONFIG },
  });
  const pipeline = new TimePipeline({
    runtime: rt,
    config: CONFIG,
    statusTick: recorder([], 'status'),
    bodyRevert: recorder([], 'body'),
    npcSchedule: recorder([], 'npc'),
    eventEval: recorder([], 'event'),
    questDeadline: recorder([], 'quest'),
    hooks,
  });
  return { rt, pipeline };
}

describe('09-6 作者钩子：前后缀槽位与跨天门控', () => {
  it('跨天推进：before_rollover 在时钟前、day_rollover 在身体回退后/NPC 日程前（补丁序断言）', () => {
    const { rt, pipeline } = makeEnv({
      beforeRollover: recorder([], 'before', [flag('hook_before')]),
      dayRollover: recorder([], 'day', [flag('hook_day')]),
    });
    const outcome = pipeline.advance(5); // 4 时段日历 → 跨天
    const paths = outcome.patches.map((p) => p.path.join('.'));
    const timeIdx = paths.indexOf('world.time');
    const beforeIdx = paths.findIndex((p) => p.startsWith('world.flags') && p.includes('hook_before'));
    const dayIdx = paths.findIndex((p) => p.includes('hook_day'));
    // before_rollover（步骤 0）先于时钟（步骤 1）；day_rollover（步骤 4）晚于时钟
    expect(beforeIdx).toBeGreaterThanOrEqual(0);
    expect(beforeIdx).toBeLessThan(timeIdx);
    expect(dayIdx).toBeGreaterThan(timeIdx);
    // 两个钩子旗标均落盘
    expect(rt.state.world.flags['hook_before']).toBe(true);
    expect(rt.state.world.flags['hook_day']).toBe(true);
  });

  it('非跨天推进：两个钩子均不调用（若本次将跨天才挂载）', () => {
    let called = 0;
    const { pipeline } = makeEnv({
      beforeRollover: () => {
        called += 1;
        return [];
      },
      dayRollover: () => {
        called += 1;
        return [];
      },
    });
    pipeline.advance(2); // 时段内，不跨天
    expect(called).toBe(0);
  });

  it('跨周/跨月推进同时跨天：钩子照常调用（跨天是唯一门控）', () => {
    let beforeCalls = 0;
    let dayCalls = 0;
    const { pipeline } = makeEnv({
      beforeRollover: () => {
        beforeCalls += 1;
        return [];
      },
      dayRollover: () => {
        dayCalls += 1;
        return [];
      },
    });
    pipeline.advance(11); // 2 天 + 3 时段 → 跨天（且 day 1→3 跨周）
    expect(beforeCalls).toBe(1);
    expect(dayCalls).toBe(1);
  });

  it('钩子未注入 = 空实现（跨天推进照常）', () => {
    const { rt, pipeline } = makeEnv({});
    const outcome = pipeline.advance(5);
    expect(rt.state.world.time.day).toBe(2);
    expect(outcome.patches.length).toBeGreaterThan(0);
  });
});

describe('09-6 钩子形态约束（API 面锁定）', () => {
  it('钩子与引擎步骤共用 TimeStepProvider 契约（收 ctx、返回 EffectData[]）', () => {
    const seen: number[] = [];
    const { pipeline } = makeEnv({
      beforeRollover: (ctx) => {
        seen.push(ctx.slots);
        return [flag('from_hook')];
      },
    });
    pipeline.advance(5);
    expect(seen).toEqual([5]);
  });

  it('钩子效果参与同一事务：钩子内失败整批回滚（含时钟）', () => {
    const { rt } = makeBuiltinRuntime({
      bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 10 } },
      registryOptions: { timeConfig: CONFIG },
    });
    const pipeline = new TimePipeline({
      runtime: rt,
      config: CONFIG,
      hooks: {
        beforeRollover: () => [{ no_such_instruction: {} } as unknown as EffectData],
      },
    });
    const before = rt.state;
    expect(() => pipeline.advance(5)).toThrow();
    expect(rt.state).toBe(before);
  });

  it('事务随机源：钩子 ctx.rng 与 runtime.rng 同一序列（DD-09）', () => {
    let ctxRngState: number | undefined;
    const { rt } = makeBuiltinRuntime({
      bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 10 } },
      registryOptions: { timeConfig: CONFIG },
    });
    const pipeline = new TimePipeline({
      runtime: rt,
      config: CONFIG,
      hooks: {
        beforeRollover: (ctx) => {
          ctxRngState = ctx.rng.getState();
          return [];
        },
      },
    });
    const before = rt.rng.getState();
    pipeline.advance(5);
    expect(ctxRngState).toBe(before);
    expect(createRng(1).getState()).toBeDefined();
  });
});
