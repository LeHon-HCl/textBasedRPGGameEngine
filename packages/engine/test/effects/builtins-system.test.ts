import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import { QUESTS, makeBuiltinRuntime, makeCtx } from './fixtures.js';
import { BASE_VERSIONS } from './fixtures.js';
import type { JumpTarget } from '../../src/runtime/exec-context.js';

/** 带任务目录的运行时（quest 用例） */
function makeQuestRuntime(init?: { bootstrapDay?: number }) {
  return makeBuiltinRuntime({
    bootstrap: {
      versions: BASE_VERSIONS,
      attrs: { hp: 30 },
      ...(init?.bootstrapDay !== undefined
        ? { time: { day: init.bootstrapDay, slotIndex: 0 } }
        : {}),
    },
    registryOptions: { quests: QUESTS },
  });
}

function expectFail(run: () => unknown, op: string, contains?: string): EngineError {
  try {
    run();
    expect.unreachable(`${op} 应当失败`);
  } catch (err) {
    const engineErr = err as EngineError;
    expect(engineErr.code).toBe('EFFECT_FAILED');
    const cause = engineErr.cause as EngineError;
    expect(cause.where.op).toBe(op);
    if (contains !== undefined) expect(cause.message).toContain(contains);
    return cause;
  }
  throw new Error('unreachable');
}

describe('05-B5 advance_time：时段推进意图（真正推进管线属 09 号）', () => {
  it('cost 表达式求值后产出 {advanceTime, slots} 跳转意图，不改状态', () => {
    const { rt } = makeBuiltinRuntime();
    const before = rt.state;
    const outcome = rt.exec(
      [{ advance_time: { cost: '2 + 1' } }, { advance_time: { cost: 1 } }],
      makeCtx(),
    );
    expect(outcome.jumps).toEqual<JumpTarget[]>([
      { type: 'advanceTime', slots: 3 },
      { type: 'advanceTime', slots: 1 },
    ]);
    expect(outcome.patches).toEqual([]);
    expect(rt.state).toBe(before);
  });

  it('cost 为 0 时不产意图；负数 / 非整数显性失败', () => {
    const { rt } = makeBuiltinRuntime();
    const outcome = rt.exec([{ advance_time: { cost: 0 } }], makeCtx());
    expect(outcome.jumps).toEqual([]);
    expectFail(() => rt.exec([{ advance_time: { cost: -1 } }], makeCtx()), 'advance_time');
    expectFail(() => rt.exec([{ advance_time: { cost: 1.5 } }], makeCtx()), 'advance_time');
  });
});

describe('05-B5 quest：accept/advance/complete/fail 最简状态机（钩子与评估属 11 号）', () => {
  it('accept 建档：active + 首阶段 + startedDay（取当前天）；重复接取失败', () => {
    const { rt } = makeQuestRuntime({ bootstrapDay: 3 });
    rt.exec([{ quest: { id: 'quest_delivery', action: 'accept' } }], makeCtx());
    expect(rt.state.quests['quest_delivery']).toEqual({
      state: 'active',
      stage: 'stage_pickup',
      objectives: {},
      startedDay: 3,
    });
    expectFail(
      () => rt.exec([{ quest: { id: 'quest_delivery', action: 'accept' } }], makeCtx()),
      'quest',
      '不可接取',
    );
  });

  it('advance 缺省取目录下一阶段；显式 stage 校验合法性', () => {
    const { rt } = makeQuestRuntime();
    rt.exec(
      [
        { quest: { id: 'quest_delivery', action: 'accept' } },
        { quest: { id: 'quest_delivery', action: 'advance' } },
        { quest: { id: 'quest_delivery', action: 'advance', stage: 'stage_report' } },
      ],
      makeCtx(),
    );
    expect(rt.state.quests['quest_delivery']?.stage).toBe('stage_report');
    expectFail(
      () =>
        rt.exec(
          [{ quest: { id: 'quest_delivery', action: 'advance', stage: 'stage_ghost' } }],
          makeCtx(),
        ),
      'quest',
      '不存在阶段',
    );
  });

  it('advance 已在最终阶段：失败（提交就绪归 11 号）', () => {
    const { rt } = makeQuestRuntime();
    rt.exec(
      [
        { quest: { id: 'quest_delivery', action: 'accept' } },
        { quest: { id: 'quest_delivery', action: 'advance', stage: 'stage_report' } },
      ],
      makeCtx(),
    );
    expectFail(
      () => rt.exec([{ quest: { id: 'quest_delivery', action: 'advance' } }], makeCtx()),
      'quest',
      '最终阶段',
    );
  });

  it('无目录 accept 不带 stage；advance 显式 stage 可用', () => {
    const { rt: noCatalog } = makeBuiltinRuntime();
    noCatalog.exec([{ quest: { id: 'quest_freeform', action: 'accept' } }], makeCtx());
    expect(noCatalog.state.quests['quest_freeform']?.state).toBe('active');
    expect(noCatalog.state.quests['quest_freeform']?.stage).toBeUndefined();
    noCatalog.exec(
      [{ quest: { id: 'quest_freeform', action: 'advance', stage: 'stage_two' } }],
      makeCtx(),
    );
    expect(noCatalog.state.quests['quest_freeform']?.stage).toBe('stage_two');
  });

  it('complete / fail 仅允许 active 或 ready_to_submit；终态后不可再变更', () => {
    const { rt } = makeQuestRuntime();
    expectFail(
      () => rt.exec([{ quest: { id: 'quest_delivery', action: 'complete' } }], makeCtx()),
      'quest',
    );
    rt.exec(
      [
        { quest: { id: 'quest_delivery', action: 'accept' } },
        { quest: { id: 'quest_delivery', action: 'complete' } },
      ],
      makeCtx(),
    );
    expect(rt.state.quests['quest_delivery']?.state).toBe('done');
    expectFail(
      () => rt.exec([{ quest: { id: 'quest_delivery', action: 'fail' } }], makeCtx()),
      'quest',
      '不可失败',
    );
    const { rt: rt2 } = makeQuestRuntime();
    rt2.exec(
      [
        { quest: { id: 'quest_delivery', action: 'accept' } },
        { quest: { id: 'quest_delivery', action: 'fail' } },
      ],
      makeCtx(),
    );
    expect(rt2.state.quests['quest_delivery']?.state).toBe('failed');
  });

  it('advance 不存在的任务：失败', () => {
    const { rt } = makeQuestRuntime();
    expectFail(
      () => rt.exec([{ quest: { id: 'quest_ghost', action: 'advance' } }], makeCtx()),
      'quest',
      '尚未存在',
    );
  });
});

describe('05-B5 unlock：seen 域标记与 Profile 路由事件', () => {
  it('gallery/ending/codex 幂等写入 seen 域并恒发 unlock 事件', () => {
    const { rt } = makeBuiltinRuntime();
    const outcome = rt.exec(
      [
        { unlock: { kind: 'gallery', id: 'cg_first' } },
        { unlock: { kind: 'ending', id: 'ending_alone' } },
        { unlock: { kind: 'codex', id: 'codex_owl' } },
        { unlock: { kind: 'gallery', id: 'cg_first' } },
      ],
      makeCtx(),
    );
    expect(rt.state.seen.gallery).toEqual(['cg_first']);
    expect(rt.state.seen.endings).toEqual(['ending_alone']);
    expect(rt.state.seen.codex).toEqual(['codex_owl']);
    expect(outcome.events).toEqual([
      { type: 'unlock', kind: 'gallery', id: 'cg_first' },
      { type: 'unlock', kind: 'ending', id: 'ending_alone' },
      { type: 'unlock', kind: 'codex', id: 'codex_owl' },
      { type: 'unlock', kind: 'gallery', id: 'cg_first' },
    ]);
  });

  it('achievement 只发事件不写状态（Profile 归宿主路由，D7）', () => {
    const { rt } = makeBuiltinRuntime();
    const outcome = rt.exec([{ unlock: { kind: 'achievement', id: 'achv_first' } }], makeCtx());
    expect(outcome.patches).toEqual([]);
    expect(outcome.events).toEqual([{ type: 'unlock', kind: 'achievement', id: 'achv_first' }]);
  });
});

describe('05-B5 media / notify：事件面产出（engine 不接触播放，DD-05）', () => {
  it('media 意图映射：bgm 恒 loop、sfx 无过渡、bg/cg/sprite 保留 transition；不改状态', () => {
    const { rt } = makeBuiltinRuntime();
    const before = rt.state;
    const outcome = rt.exec(
      [
        { media: { type: 'bgm', assetId: 'bgm_tavern' } },
        { media: { type: 'sfx', assetId: 'sfx_door' } },
        { media: { type: 'bg', assetId: 'bg_dock', transition: 'fade' } },
        { media: { type: 'sprite', assetId: 'sp_raven' } },
      ],
      makeCtx(),
    );
    expect(outcome.events.map((e) => (e as { intent: unknown }).intent)).toEqual([
      { type: 'bgm', assetId: 'bgm_tavern', loop: true },
      { type: 'sfx', assetId: 'sfx_door' },
      { type: 'bg', assetId: 'bg_dock', transition: 'fade' },
      { type: 'sprite', assetId: 'sp_raven' },
    ]);
    expect(rt.state).toBe(before);
  });

  it('notify 文本键 + 插值变量（字符串宽松求值；不改状态）', () => {
    const { rt } = makeBuiltinRuntime();
    const before = rt.state;
    const outcome = rt.exec(
      [{ notify: { textKey: 'ui.gain', vars: { item: 'herb', n: '2 + 2' } } }],
      makeCtx(),
    );
    expect(outcome.events).toEqual([
      { type: 'notify', textKey: 'ui.gain', vars: { item: 'herb', n: 4 } },
    ]);
    expect(rt.state).toBe(before);
  });
});
