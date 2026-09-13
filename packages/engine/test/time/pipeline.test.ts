import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '@game/shared';
import type { EffectData, TimeConfig } from '@game/shared';
import { BASE_VERSIONS, makeBuiltinRuntime } from '../effects/fixtures.js';
import { TimePipeline } from '../../src/time/pipeline.js';
import type { TimeStepContext, TimeStepProvider } from '../../src/time/pipeline.js';

/**
 * 09 任务 3：推进管线编排器（§4.3 步骤 0–7 固定次序，DD-10）。
 *
 * 依赖模块（13/14/12/10/11 号）以钩子桩注入——本模块用记录桩断言：
 * 1) 次序固定且不可插入中间（引擎步骤按槽位排列）；
 * 2) 一次 advance = 一次 runtime.exec 事务（子任务 4 的原子性前提）；
 * 3) 内部指令 __time.advance 完成时钟写入（引擎内部面，不面向作者）。
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
  months: [{ length: 30, nameKey: 'time.month.spring' }],
};

/** 记录桩：登记步骤名并回放预备好的效果（默认空） */
function recorder(log: string[], name: string, effects: EffectData[] = []): TimeStepProvider {
  return (ctx: TimeStepContext) => {
    log.push(`${name}@${ctx.slots}`);
    return effects;
  };
}

interface SetupInit {
  log?: string[];
}

/** 带全量步骤桩的时间管线（registryOptions 注入 TimeConfig，与生产装配同径） */
function makePipeline(init: SetupInit = {}) {
  const log = init.log ?? [];
  const { rt } = makeBuiltinRuntime({
    bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 10 } },
    registryOptions: { timeConfig: CONFIG },
  });
  const pipeline = new TimePipeline({
    runtime: rt,
    config: CONFIG,
    statusTick: recorder(log, 'status_tick'),
    bodyRevert: recorder(log, 'body_revert'),
    npcSchedule: recorder(log, 'npc_schedule'),
    eventEval: recorder(log, 'event_eval'),
    questDeadline: recorder(log, 'quest_deadline'),
  });
  return { rt, pipeline };
}

describe('09-3 TimePipeline.advance：固定次序与桩注入', () => {
  it('五步桩按 2→3→5→6→7 槽位序记录；时钟写入状态', () => {
    const log: string[] = [];
    const { rt, pipeline } = makePipeline({ log });
    pipeline.advance(2);
    expect(log).toEqual([
      'status_tick@2',
      'body_revert@2',
      'npc_schedule@2',
      'event_eval@2',
      'quest_deadline@2',
    ]);
    expect(rt.state.world.time).toEqual({ day: 1, slotIndex: 2, week: 0, month: 0 });
  });

  it('未注入的步骤槽位跳过（缺省 = 空实现）', () => {
    const { rt } = makeBuiltinRuntime({
      registryOptions: { timeConfig: CONFIG },
    });
    const pipeline = new TimePipeline({ runtime: rt, config: CONFIG });
    pipeline.advance(1);
    expect(rt.state.world.time).toEqual({ day: 1, slotIndex: 1, week: 0, month: 0 });
  });

  it('桩收到的 ctx 携带 slots 与预计算跨边界旗标', () => {
    const seen: TimeStepContext[] = [];
    const { pipeline } = (() => {
      const { rt } = makeBuiltinRuntime({
        registryOptions: { timeConfig: CONFIG },
      });
      const p = new TimePipeline({
        runtime: rt,
        config: CONFIG,
        statusTick: (ctx) => {
          seen.push(ctx);
          return [];
        },
      });
      return { pipeline: p };
    })();
    pipeline.advance(5); // 4 时段日历 → 跨天
    expect(seen).toHaveLength(1);
    const ctx = seen[0] as TimeStepContext;
    expect(ctx.slots).toBe(5);
    expect(ctx.crossedDay).toBe(true);
    expect(ctx.crossedWeek).toBe(false);
  });

  it('跨天推进：day+1 且 slotIndex 回绕（步骤 1 的状态效果）', () => {
    const { rt, pipeline } = makePipeline();
    pipeline.advance(5);
    expect(rt.state.world.time).toEqual({ day: 2, slotIndex: 1, week: 0, month: 0 });
  });

  it('slots=0：直接短路（不进事务、桩不执行）', () => {
    const log: string[] = [];
    const { rt, pipeline } = makePipeline({ log });
    const before = rt.state;
    const outcome = pipeline.advance(0);
    expect(outcome.jumps).toEqual([]);
    expect(outcome.patches).toEqual([]);
    expect(rt.state).toBe(before);
    expect(log).toEqual([]);
  });

  it('负数 / 非整数 slots → INTERNAL 契约违规', () => {
    const { pipeline } = makePipeline();
    for (const bad of [-1, 1.5, Number.NaN]) {
      try {
        pipeline.advance(bad);
        expect.unreachable(`slots=${String(bad)} 应当失败`);
      } catch (err) {
        expect((err as EngineError).code).toBe('INTERNAL');
      }
    }
  });
});

describe('09-3 __time.advance 内部指令（引擎内部面）', () => {
  it('未注入 TimeConfig → EFFECT_FAILED（显性化，不静默）', () => {
    const { rt } = makeBuiltinRuntime();
    try {
      rt.exec([{ '__time.advance': { slots: 1 } } as unknown as EffectData], {
        source: 'hook',
        where: {},
        rng: createRng(1),
      });
      expect.unreachable('缺 TimeConfig 应当失败');
    } catch (err) {
      expect((err as EngineError).code).toBe('EFFECT_FAILED');
    }
  });

  it('slots 负数 / 非整数 → EFFECT_FAILED（参数校验）', () => {
    const { rt } = makeBuiltinRuntime({ registryOptions: { timeConfig: CONFIG } });
    for (const bad of [-1, 2.5]) {
      try {
        rt.exec([{ '__time.advance': { slots: bad } } as unknown as EffectData], {
          source: 'hook',
          where: {},
          rng: createRng(1),
        });
        expect.unreachable(`slots=${String(bad)} 应当失败`);
      } catch (err) {
        expect((err as EngineError).code).toBe('EFFECT_FAILED');
      }
    }
  });
});
