import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EngineError } from '@game/shared';
import { asEffectData, makeCtx, makeEchoDef, makeEffectRuntime } from './fixtures.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import type { EffectInstructionDef } from '../../src/effects/types.js';
import type { JumpTarget } from '../../src/runtime/exec-context.js';

/** 注册一个作者扩展指令并返回接线好的运行时（call 转发目标） */
function makeCallRuntime(
  target: EffectInstructionDef<unknown>,
): ReturnType<typeof makeEffectRuntime> {
  const registry = createBuiltinEffectRegistry();
  registry.register(target);
  return makeEffectRuntime({ registry });
}

describe('05-A3 call 指令：作者扩展转发（DD-08 / FR-SCR-04）', () => {
  it('转发执行：with 载荷经目标 schema 解析后交给目标 execute', () => {
    const { rt } = makeCallRuntime(makeEchoDef());
    const outcome = rt.exec(
      [asEffectData({ call: { fn: 'x.test.echo', with: { msg: 'hi' } } })],
      makeCtx(),
    );
    // 目标 execute 收到解析后的参数（msg 写入 flag 即证明载荷贯通）
    expect(rt.state.world.flags['echo']).toBe('hi');
    expect(outcome.jumps).toEqual([]);
  });

  it('with 缺省时目标收到空对象（全可选参数 schema 可解析）', () => {
    const received: unknown[] = [];
    const target: EffectInstructionDef<{ msg?: string }> = {
      id: 'x.test.opt',
      schema: z.strictObject({ msg: z.string().optional() }),
      touch: () => ({ reads: [], writes: [] }),
      execute: (arg) => {
        received.push(arg);
      },
    };
    const { rt } = makeCallRuntime(target);
    rt.exec([asEffectData({ call: { fn: 'x.test.opt' } })], makeCtx());
    expect(received).toEqual([{}]);
  });

  it('fn 非 x.<script>.<name>：EFFECT_FAILED（内置指令不经 call 调用）', () => {
    const { rt } = makeCallRuntime(makeEchoDef());
    try {
      rt.exec([asEffectData({ call: { fn: 'set' } })], makeCtx());
      expect.unreachable('非 x.* 命名空间应被拒绝');
    } catch (err) {
      const cause = (err as EngineError).cause as EngineError;
      expect((err as EngineError).code).toBe('EFFECT_FAILED');
      expect((err as EngineError).where.instruction).toBe('0');
      expect(cause.where.op).toBe('call');
      expect(cause.where.fn).toBe('set');
    }
  });

  it('目标未注册：EFFECT_FAILED（存在性校验，显性失败）', () => {
    const { rt } = makeCallRuntime(makeEchoDef());
    try {
      rt.exec([asEffectData({ call: { fn: 'x.other.missing' } })], makeCtx());
      expect.unreachable('未注册目标应报 EFFECT_FAILED');
    } catch (err) {
      const cause = (err as EngineError).cause as EngineError;
      expect(cause.where.op).toBe('call');
      expect(cause.where.fn).toBe('x.other.missing');
      expect(cause.message).toContain('未注册');
    }
  });

  it('with 不满足目标 schema：EFFECT_FAILED（转发沿用目标参数校验）', () => {
    const { rt } = makeCallRuntime(makeEchoDef());
    expect(() =>
      rt.exec([asEffectData({ call: { fn: 'x.test.echo', with: { msg: 42 } } })], makeCtx()),
    ).toThrowError(/EFFECT_FAILED/);
  });

  it('转发目标的静态跳转声明经 call 汇入 ExecOutcome.jumps', () => {
    const target: EffectInstructionDef<{ scene: string }> = {
      id: 'x.test.warp',
      schema: z.strictObject({ scene: z.string().min(1) }),
      touch: () => ({ reads: [], writes: [] }),
      execute: () => {},
      jumps: (arg) => [{ type: 'scene', scene: arg.scene }],
    };
    const { rt } = makeCallRuntime(target);
    const outcome = rt.exec(
      [asEffectData({ call: { fn: 'x.test.warp', with: { scene: 'scene_dock' } } })],
      makeCtx(),
    );
    expect(outcome.jumps).toEqual<JumpTarget[]>([{ type: 'scene', scene: 'scene_dock' }]);
    expect(outcome.patches).toEqual([]);
  });

  it('touch 声明委托目标定义；目标缺失时回退空声明（FR-SCR-05）', () => {
    const registry = createBuiltinEffectRegistry();
    registry.register(
      makeEchoDef({
        writes: ['world.flags', 'player.attrs'],
      }),
    );
    const callDef = registry.lookup('call');
    expect(callDef).toBeDefined();
    const delegated = callDef?.touch({ fn: 'x.test.echo', with: { msg: 'x' } } as never);
    expect(delegated?.writes).toEqual(['world.flags', 'player.attrs']);
    const fallback = callDef?.touch({ fn: 'x.other.missing' } as never);
    expect(fallback?.writes).toEqual([]);
    expect(fallback?.reads).toEqual([]);
  });

  it('createBuiltinEffectRegistry 装配 call 指令并可执行', () => {
    const registry = createBuiltinEffectRegistry();
    expect(registry.ids()).toContain('call');
    const { rt } = makeEffectRuntime({ registry });
    expect(() => rt.exec([asEffectData({ call: { fn: 'x.nope.gone' } })], makeCtx())).toThrowError(
      /EFFECT_FAILED/,
    );
  });
});
