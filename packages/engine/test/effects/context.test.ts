import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRng } from '@game/shared';
import { EngineError } from '@game/shared';
import { fxCompile, makeCtx, makeEffectRuntime, asEffectData } from './fixtures.js';
import type { EffectInstructionDef } from '../../src/effects/types.js';
import type { EffectExecuteContext } from '../../src/effects/types.js';
import type { ExecOutcome } from '../../src/runtime/exec-context.js';

/** 空参数指令快捷构造：捕获上下文 / 抛错 / 写入均经 execute 回调表达 */
function def(
  id: string,
  execute: (ectx: EffectExecuteContext) => void,
  writes: readonly string[] = [],
): EffectInstructionDef<Record<string, never>> {
  return {
    id,
    schema: z.strictObject({}),
    touch: () => ({ reads: [], writes }),
    execute: (_arg, ectx) => execute(ectx),
  };
}

describe('05-A2 EffectContext 生命周期：draft 冻结语义', () => {
  it('跨指令共享 draft 报错：指令 0 的 draft 在指令 1 中写入即失败回滚', () => {
    const stashed: Array<EffectExecuteContext['draft']> = [];
    const { rt } = makeEffectRuntime({
      builtins: [
        def('x.test.stash', (ectx) => {
          stashed.push(ectx.draft);
        }),
        def('x.test.stale_write', () => {
          const stale = stashed[0];
          if (stale === undefined) throw new Error('draft 未被暂存');
          stale.world.flags['late'] = true;
        }),
      ],
    });
    const before = rt.state;
    try {
      rt.exec(
        [asEffectData({ 'x.test.stash': {} }), asEffectData({ 'x.test.stale_write': {} })],
        makeCtx(),
      );
      expect.unreachable('跨指令写 stale draft 应当抛错');
    } catch (err) {
      const engineErr = err as EngineError;
      expect(engineErr.code).toBe('EFFECT_FAILED');
      expect(engineErr.where.instruction).toBe('1');
    }
    expect(rt.state).toBe(before);
    expect(rt.state.world.flags['late']).toBeUndefined();
  });

  it('事务提交后 draft 冻结：execute 之外持有 draft 引用写入抛错，状态不受影响', () => {
    const stashed: Array<EffectExecuteContext['draft']> = [];
    const { rt } = makeEffectRuntime({
      builtins: [
        def('x.test.stash', (ectx) => {
          stashed.push(ectx.draft);
        }),
      ],
    });
    rt.exec([asEffectData({ 'x.test.stash': {} })], makeCtx());
    expect(rt.state.world.flags['echo']).toBeUndefined();
    expect(() => {
      const stale = stashed[0];
      if (stale === undefined) throw new Error('draft 未被暂存');
      stale.world.flags['late'] = true;
    }).toThrow();
    expect(rt.state.world.flags['late']).toBeUndefined();
  });
});

describe('05-A2 EffectContext 能力面贯穿（真实注册表路径）', () => {
  it('where 逐指令携带 instruction 序号并继承调用方定位；rng 与事务同源', () => {
    const seen: Array<{ where: unknown; rngSame: boolean }> = [];
    const rng = createRng(7);
    const { rt } = makeEffectRuntime({
      builtins: [
        def('x.test.probe_where', (ectx) => {
          seen.push({
            where: { ...ectx.where },
            rngSame: ectx.rng === rng,
          });
        }),
      ],
    });
    rt.exec(
      [asEffectData({ 'x.test.probe_where': {} }), asEffectData({ 'x.test.probe_where': {} })],
      makeCtx({ rng }),
    );
    expect(seen).toEqual([
      { where: { scene: 'scene_tavern', instruction: 0 }, rngSame: true },
      { where: { scene: 'scene_tavern', instruction: 1 }, rngSame: true },
    ]);
  });

  it('emit 事件收集进 ExecOutcome（事务提交后统一返回）', () => {
    const { rt } = makeEffectRuntime({
      builtins: [
        def('x.test.notify', (ectx) => {
          ectx.emit({ type: 'notify', textKey: 'ui.hello', vars: { who: 'raven' } });
        }),
      ],
    });
    const outcome = rt.exec([asEffectData({ 'x.test.notify': {} })], makeCtx());
    expect(outcome.events).toEqual([
      { type: 'notify', textKey: 'ui.hello', vars: { who: 'raven' } },
    ]);
  });

  it('evalExpr 以 CompiledExpr 按当前 draft 实时视图求值', () => {
    const seen: unknown[] = [];
    const { rt } = makeEffectRuntime({
      builtins: [
        def('x.test.probe_eval', (ectx) => {
          seen.push(ectx.evalExpr(fxCompile('attr.hp + 1')));
        }),
      ],
    });
    rt.exec([asEffectData({ 'x.test.probe_eval': {} })], makeCtx());
    expect(seen).toEqual([31]);
  });

  it('child：子效果在同一 draft 生效，子批 events/jumps 并入父事务', () => {
    const childOutcomes: ExecOutcome[] = [];
    const { rt } = makeEffectRuntime({
      builtins: [
        def('x.test.parent', (ectx) => {
          childOutcomes.push(
            ectx.child(
              [
                asEffectData({ 'x.test.echo_child': {} }),
                asEffectData({ 'x.test.jump_child': {} }),
              ],
              { source: 'hook', where: { scene: 'scene_child' }, rng: ectx.rng },
            ),
          );
        }),
        def('x.test.echo_child', (ectx) => {
          ectx.draft.world.flags['echo'] = 'from_child';
          ectx.emit({ type: 'notify', textKey: 'ui.child' });
        }),
        def('x.test.jump_child', (ectx) => {
          ectx.emitJump({ type: 'advanceTime', slots: 1 });
        }),
      ],
    });
    const outcome = rt.exec([asEffectData({ 'x.test.parent': {} })], makeCtx());
    expect(rt.state.world.flags['echo']).toBe('from_child');
    expect(outcome.events).toEqual([{ type: 'notify', textKey: 'ui.child' }]);
    expect(outcome.jumps).toEqual([{ type: 'advanceTime', slots: 1 }]);
    expect(childOutcomes[0]?.jumps).toEqual([{ type: 'advanceTime', slots: 1 }]);
  });

  it('child 失败：整批事务回滚，父指令定位 EFFECT_FAILED，cause 保留子级定位', () => {
    const { rt } = makeEffectRuntime({
      builtins: [
        def('x.test.parent_boom', (ectx) => {
          ectx.child([asEffectData({ 'x.test.boom': {} })], {
            source: 'hook',
            where: { scene: 'scene_child' },
            rng: ectx.rng,
          });
        }),
        def('x.test.boom', (ectx) => {
          ectx.draft.world.flags['reached'] = true;
          throw new Error('boom');
        }),
      ],
    });
    const before = rt.state;
    try {
      rt.exec([asEffectData({ 'x.test.parent_boom': {} })], makeCtx());
      expect.unreachable('child 失败应使整批事务失败');
    } catch (err) {
      const engineErr = err as EngineError;
      expect(engineErr.code).toBe('EFFECT_FAILED');
      expect(engineErr.where.instruction).toBe('0');
      const childErr = engineErr.cause as EngineError;
      expect(childErr.code).toBe('EFFECT_FAILED');
      expect(childErr.where.scene).toBe('scene_child');
      expect(childErr.where.instruction).toBe('0');
    }
    expect(rt.state).toBe(before);
    expect(rt.state.world.flags['reached']).toBeUndefined();
  });
});
