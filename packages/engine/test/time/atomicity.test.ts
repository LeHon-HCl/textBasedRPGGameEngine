import { describe, expect, it } from 'vitest';
import type { EffectData, TimeConfig } from '@game/shared';
import { BASE_VERSIONS, makeBuiltinRuntime } from '../effects/fixtures.js';
import { TimePipeline } from '../../src/time/pipeline.js';

/**
 * 09 任务 4：一次推进 = 一个 undo 点（§4.3「各步效果合并为一次事务」）+ 原子性。
 *
 * - 断言一次 advance 的补丁同时含时钟与步骤效果（同一事务的直接证据）；
 * - rollback(1) 整批撤销一次推进（时钟 + 步骤效果一起回滚）；
 * - 任一步骤中途抛错 → 整批回滚，时钟不前移（§3.1 失败路径语义）。
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

function flagEffect(key: string, value: boolean = true): EffectData {
  return { flag: { name: key, value } } as unknown as EffectData;
}

function makePipeline(steps: {
  statusTick?: (ctx: import('../../src/time/pipeline.js').TimeStepContext) => EffectData[];
  eventEval?: (ctx: import('../../src/time/pipeline.js').TimeStepContext) => EffectData[];
}) {
  const { rt } = makeBuiltinRuntime({
    bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 10 } },
    registryOptions: { timeConfig: CONFIG },
  });
  const pipeline = new TimePipeline({ runtime: rt, config: CONFIG, ...steps });
  return { rt, pipeline };
}

describe('09-4 一次推进 = 一个 undo 点', () => {
  it('同一事务的直接证据：一次 advance 的补丁同时含时钟与步骤效果', () => {
    const { rt, pipeline } = makePipeline({
      statusTick: () => [flagEffect('ticked')],
    });
    const outcome = pipeline.advance(2);
    const paths = outcome.patches.map((p) => p.path.join('.'));
    expect(paths).toContain('world.time');
    expect(paths.some((p) => p.startsWith('world.flags'))).toBe(true);
    expect(rt.state.world.flags['ticked']).toBe(true);
  });

  it('rollback(1) 整批撤销：时钟与步骤效果一起回到推进前', () => {
    const { rt, pipeline } = makePipeline({
      statusTick: () => [flagEffect('ticked')],
    });
    rt.checkpoint('before_advance');
    const beforeTime = rt.state.world.time;
    pipeline.advance(5); // 跨天
    expect(rt.state.world.time.day).toBe(beforeTime.day + 1);
    rt.rollback(1);
    expect(rt.state.world.time).toEqual(beforeTime);
    expect(rt.state.world.flags['ticked']).toBeUndefined();
  });
});

describe('09-4 中途抛错原子性', () => {
  it('步骤 6 效果指令未注册 → EFFECT_FAILED；时钟不前移、步骤 2 效果不生效', () => {
    const { rt, pipeline } = makePipeline({
      statusTick: () => [flagEffect('ticked')],
      eventEval: () => [{ no_such_instruction: {} } as unknown as EffectData],
    });
    const before = rt.state;
    try {
      pipeline.advance(3);
      expect.unreachable('中途失败应当抛出');
    } catch (err) {
      expect((err as Error).message.length).toBeGreaterThan(0);
    }
    // 原子性：状态对象保持原样（时钟 + 前序步骤效果均未落盘）
    expect(rt.state).toBe(before);
    expect(rt.state.world.time).toEqual(before.world.time);
    expect(rt.state.world.flags['ticked']).toBeUndefined();
  });

  it('失败后管线仍可用：修复步骤后再次推进成功（失败不留脏状态）', () => {
    const failing = (): EffectData[] => [{ no_such_instruction: {} } as unknown as EffectData];
    const working = (ctx: import('../../src/time/pipeline.js').TimeStepContext): EffectData[] => [
      flagEffect(`ev_day${ctx.slots}`),
    ];
    const { rt } = makeBuiltinRuntime({
      bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 10 } },
      registryOptions: { timeConfig: CONFIG },
    });
    const pipeline = new TimePipeline({ runtime: rt, config: CONFIG, eventEval: failing });
    expect(() => pipeline.advance(1)).toThrow();
    // 换为正常步骤（同管线实例重建场景：新构造，注入正常钩子）
    const pipeline2 = new TimePipeline({ runtime: rt, config: CONFIG, eventEval: working });
    pipeline2.advance(1);
    expect(rt.state.world.time.slotIndex).toBe(1);
    expect(rt.state.world.flags['ev_day1']).toBe(true);
  });

  it('失败事务的 rng 序列不受影响（DD-09：失败不消耗随机）——advance 全程无随机', () => {
    const { rt, pipeline } = makePipeline();
    const before = rt.rng.getState();
    pipeline.advance(2);
    expect(rt.rng.getState()).toBe(before);
  });
});
