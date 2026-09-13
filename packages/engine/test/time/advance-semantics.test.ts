import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { AreaDef, EffectData, TimeConfig } from '@game/shared';
import { BASE_VERSIONS, makeBuiltinRuntime } from '../effects/fixtures.js';
import type { ExecContext } from '../../src/runtime/exec-context.js';
import { TimePipeline } from '../../src/time/pipeline.js';

/**
 * 09 任务 5：行为消耗时段的语义归约验证（FR-TIME-02 / FR-XPLR-02，§4.3）。
 *
 * 「移动消耗时段」与「行动消耗时段」最终都归约到 TimePipeline.advance()：
 * - advance_time 指令只声明意图（JumpTarget.advanceTime，05 任务 B5），真正
 *   推进由宿主取 lastOutcome.jumps 后调用管线——本文件锁定该消费路径；
 * - 移动（FR-XPLR-02）= goto 流程跳转（不改时间）+ advance(moveCost)；
 *   moveCost 数据源为 AreaDef.locations[].moveCost。
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

/** 区域夹具（FR-XPLR-02：地点移动消耗） */
const AREA: AreaDef = {
  id: 'old_town',
  nameKey: 'areas.old_town.name',
  locations: {
    gate: { nameKey: 'areas.old_town.gate', moveCost: 2, mapPos: [0, 0] },
    market: { nameKey: 'areas.old_town.market', moveCost: 1, mapPos: [1, 1] },
  },
};

function makeEnv() {
  const { rt } = makeBuiltinRuntime({
    bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 10 } },
    registryOptions: { timeConfig: CONFIG },
  });
  const pipeline = new TimePipeline({ runtime: rt, config: CONFIG });
  const ctx: ExecContext = { source: 'choice', where: { scene: 'scene_x' }, rng: createRng(1) };
  return { rt, pipeline, ctx };
}

/**
 * 宿主消费桩（生产中为叙事运行时的宿主/25 号 UI）：
 * 取事务产出中的 advanceTime 意图，逐个归约到管线推进。
 */
function consumeAdvanceTime(
  jumps: readonly { type: string; slots?: number }[],
  pipeline: TimePipeline,
): void {
  for (const jump of jumps) {
    if (jump.type === 'advanceTime') pipeline.advance(jump.slots ?? 0);
  }
}

describe('09-5 advance_time 归约到 advance()', () => {
  it('指令不改时间，只产意图；宿主消费意图后时钟推进', () => {
    const { rt, pipeline, ctx } = makeEnv();
    const outcome = rt.exec([{ advance_time: { cost: 2 } }], ctx);
    expect(rt.state.world.time.slotIndex).toBe(0); // 指令本身不动时钟
    expect(outcome.jumps).toEqual([{ type: 'advanceTime', slots: 2 }]);
    consumeAdvanceTime(outcome.jumps, pipeline);
    expect(rt.state.world.time).toEqual({ day: 1, slotIndex: 2, week: 0 });
  });

  it('表达式 cost 归约同径：cost 为「2 + 2」= 4 时段（跨天由管线处理）', () => {
    const { rt, pipeline, ctx } = makeEnv();
    const outcome = rt.exec([{ advance_time: { cost: '2 + 2' } }], ctx);
    consumeAdvanceTime(outcome.jumps, pipeline);
    expect(rt.state.world.time).toEqual({ day: 2, slotIndex: 0, week: 0 });
  });
});

describe('09-5 move_cost_slots（location.moveCost）归约到 advance()', () => {
  it('移动语义 = goto（不改时间）+ advance(moveCost)：从 gate 出发消耗 2 时段', () => {
    const { rt, pipeline, ctx } = makeEnv();
    // 第一步：流程跳转（goto）——不消耗时间
    const move = rt.exec([{ goto: 'scene_market' } as unknown as EffectData], ctx);
    expect(move.jumps).toEqual([{ type: 'scene', scene: 'scene_market' }]);
    expect(rt.state.world.time.slotIndex).toBe(0);
    // 第二步：移动消耗归约到 advance（数据源 AREA.locations['gate'].moveCost）
    pipeline.advance(AREA.locations['gate']?.moveCost ?? 0);
    expect(rt.state.world.time).toEqual({ day: 1, slotIndex: 2, week: 0 });
  });

  it('跨地点不同消耗：gate→market 逐次累加，跨天边界自然滚入次日', () => {
    const { rt, pipeline, ctx } = makeEnv();
    rt.exec([{ advance_time: { cost: 2 } }], ctx).jumps.forEach((j) =>
      j.type === 'advanceTime' ? pipeline.advance(j.slots) : undefined,
    );
    pipeline.advance(AREA.locations['gate']?.moveCost ?? 0); // +2 → 4/4 → 跨天
    pipeline.advance(AREA.locations['market']?.moveCost ?? 0); // +1 → 次日第 1 时段
    expect(rt.state.world.time).toEqual({ day: 2, slotIndex: 1, week: 0 });
  });
});
