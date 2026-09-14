import { describe, expect, it } from 'vitest';
import type { BodyDef } from '@game/shared';
import { BASE_VERSIONS, makeBuiltinRuntime, makeCtx } from '../effects/fixtures.js';
import { DEFAULT_TIME_CONFIG, TimePipeline } from '../../src/time/index.js';
import { createBodyRevertProvider } from '../../src/body/index.js';

/**
 * 14 任务 2：临时变身回退（FR-BODY-02，§4.8「管线步骤 3 回退 + BodyReverted」）。
 *
 * 口径：
 * - `set_body{revertAfter:{slots|days}}` 登记临时项（部位/原值/剩余时段），
 *   身体立即变更；
 * - 时间管线步骤 3（bodyRevert 槽位）推进时递减剩余时长，归零 → 还原原值 +
 *   emit body_reverted（作者订阅决定后果，引擎不解释语义）；
 * - 同一部位重复临时变身：后登记覆盖前项（原值取首次登记前的值，避免中间态
 *   被固化）；`days` 换算为时段（× 当日时段数）。
 */

/** 测试用身体定义（build/hair/tail 三部位） */
const BODY_DEFS: BodyDef = {
  parts: {
    build: { values: ['slender', 'sturdy'], default: 'slender' },
    hair: { values: ['short', 'long'], default: 'short' },
    tail: { values: ['none', 'fluffy'], default: 'none' },
  },
};

function makeBodyRuntime(init?: { body?: Record<string, string> }) {
  const { rt } = makeBuiltinRuntime({
    bootstrap: {
      versions: BASE_VERSIONS,
      attrs: { hp: 10 },
      ...(init?.body !== undefined ? { body: init.body } : {}),
    },
    registryOptions: { bodyDefs: BODY_DEFS, timeConfig: DEFAULT_TIME_CONFIG },
  });
  const pipeline = new TimePipeline({
    runtime: rt,
    config: DEFAULT_TIME_CONFIG,
    bodyRevert: createBodyRevertProvider(),
  });
  return { rt, pipeline };
}

describe('14-2 临时变身：登记与时段回退', () => {
  it('revertAfter.slots：登记临时项，体内立即变更；到期还原 + body_reverted 事件', () => {
    const { rt, pipeline } = makeBodyRuntime({ body: { tail: 'none' } });
    rt.exec(
      [{ set_body: { part: 'tail', value: 'fluffy', revertAfter: { slots: 4 } } }],
      makeCtx(),
    );
    expect(rt.state.player.body['tail']).toBe('fluffy');
    // 未到期：推进 2 时段，仍为临时值
    expect(pipeline.advance(2).events).toEqual([]);
    expect(rt.state.player.body['tail']).toBe('fluffy');
    // 到期：推进 2 时段 → 还原 none + 事件
    const outcome = pipeline.advance(2);
    expect(rt.state.player.body['tail']).toBe('none');
    expect(outcome.events).toEqual([{ type: 'body_reverted', part: 'tail', restored: 'none' }]);
    // 已回退：后续推进不再重复报
    expect(pipeline.advance(4).events).toEqual([]);
  });

  it('revertAfter.days：按当日时段数换算（4 时段/天 → 1 天 = 4 时段）', () => {
    const { rt, pipeline } = makeBodyRuntime({ body: { hair: 'short' } });
    rt.exec([{ set_body: { part: 'hair', value: 'long', revertAfter: { days: 1 } } }], makeCtx());
    expect(rt.state.player.body['hair']).toBe('long');
    pipeline.advance(3);
    expect(rt.state.player.body['hair']).toBe('long');
    pipeline.advance(1);
    expect(rt.state.player.body['hair']).toBe('short');
  });

  it('永久变更（无 revertAfter）不登记临时项，推进不回退', () => {
    const { rt, pipeline } = makeBodyRuntime({ body: { build: 'slender' } });
    rt.exec([{ set_body: { part: 'build', value: 'sturdy' } }], makeCtx());
    pipeline.advance(12);
    expect(rt.state.player.body['build']).toBe('sturdy');
    expect(rt.state.player.bodyTemp).toEqual({});
  });

  it('同部位重复临时变身：原值取首次登记前的值，时长以后者为准', () => {
    const { rt, pipeline } = makeBodyRuntime({ body: { tail: 'none' } });
    rt.exec(
      [{ set_body: { part: 'tail', value: 'fluffy', revertAfter: { slots: 2 } } }],
      makeCtx(),
    );
    // 第二次变身（中途改主意）：仍应还原到 none，而非 fluffy
    rt.exec(
      [{ set_body: { part: 'tail', value: 'fluffy', revertAfter: { slots: 6 } } }],
      makeCtx(),
    );
    pipeline.advance(2);
    expect(rt.state.player.body['tail']).toBe('fluffy');
    pipeline.advance(4);
    expect(rt.state.player.body['tail']).toBe('none');
  });

  it('多部位并行临时变身：各自独立计时与还原', () => {
    const { rt, pipeline } = makeBodyRuntime({ body: { tail: 'none', hair: 'short' } });
    rt.exec(
      [
        { set_body: { part: 'tail', value: 'fluffy', revertAfter: { slots: 2 } } },
        { set_body: { part: 'hair', value: 'long', revertAfter: { slots: 6 } } },
      ],
      makeCtx(),
    );
    const first = pipeline.advance(2);
    expect(first.events).toEqual([{ type: 'body_reverted', part: 'tail', restored: 'none' }]);
    expect(rt.state.player.body).toMatchObject({ tail: 'none', hair: 'long' });
    const second = pipeline.advance(4);
    expect(second.events).toEqual([{ type: 'body_reverted', part: 'hair', restored: 'short' }]);
  });

  it('表达式的 revertAfter 时长在事务内求值（字符串形态）', () => {
    const { rt, pipeline } = makeBodyRuntime({ body: { tail: 'none' } });
    rt.exec(
      [{ set_body: { part: 'tail', value: 'fluffy', revertAfter: { slots: '1 + 1' } } }],
      makeCtx(),
    );
    pipeline.advance(2);
    expect(rt.state.player.body['tail']).toBe('none');
  });
});
