import { describe, expect, it } from 'vitest';
import type { JumpTarget } from '../../src/runtime/exec-context.js';
import { makeBuiltinRuntime, makeCtx } from './fixtures.js';

describe('05-B4 流程类指令：只产 jumps 的分界（§3.3 状态层/流程层分界）', () => {
  it.each([
    [{ goto: 'scene_cellar' }, [{ type: 'scene', scene: 'scene_cellar' }]],
    [{ back: null }, [{ type: 'back' }]],
    [{ ending: 'ending_alone' }, [{ type: 'ending', ending: 'ending_alone' }]],
    [{ loop_transition: null }, [{ type: 'loopTransition' }]],
  ] as const)('%j → 静态跳转目标', (instruction, expected) => {
    const { rt } = makeBuiltinRuntime();
    const outcome = rt.exec([instruction], makeCtx());
    expect(outcome.jumps).toEqual<readonly JumpTarget[]>(expected);
  });

  it.each([
    [{ goto: 'scene_cellar' }],
    [{ back: null }],
    [{ ending: 'ending_x' }],
    [{ loop_transition: null }],
  ] as const)('%j 执行后状态零变化（state 原对象不变、patches/events 为空）', (instruction) => {
    const { rt } = makeBuiltinRuntime();
    const before = rt.state;
    const outcome = rt.exec([instruction], makeCtx());
    expect(rt.state).toBe(before);
    expect(outcome.patches).toEqual([]);
    expect(outcome.events).toEqual([]);
  });

  it('流程指令可与状态指令混排：jumps 与补丁各自归集，失败仍整批回滚', () => {
    const { rt } = makeBuiltinRuntime();
    const outcome = rt.exec(
      [{ set: { key: 'flag.moved', value: true } }, { goto: 'scene_dock' }, { back: null }],
      makeCtx(),
    );
    expect(rt.state.world.flags['moved']).toBe(true);
    expect(outcome.jumps).toEqual<JumpTarget[]>([
      { type: 'scene', scene: 'scene_dock' },
      { type: 'back' },
    ]);
    expect(outcome.patches.map((p) => p.path)).toEqual([['world', 'flags', 'moved']]);
  });
});
