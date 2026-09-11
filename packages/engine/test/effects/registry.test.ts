import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EngineError, effectParamSchemas } from '@game/shared';
import {
  asEffectData,
  fxCompile,
  makeCtx,
  makeEchoDef,
  makeEffectRuntime,
  makeRegistry,
} from './fixtures.js';
import type { EffectInstructionDef } from '../../src/effects/types.js';
import type { JumpTarget } from '../../src/runtime/exec-context.js';

describe('05-A1 EffectRegistry：注册与重复 id 冲突', () => {
  it('作者扩展指令注册后可解析执行（参数经 schema 解析、draft 写入生效）', () => {
    const { rt } = makeEffectRuntime({ builtins: [makeEchoDef()] });
    const outcome = rt.exec([asEffectData({ 'x.test.echo': { msg: 'hi' } })], makeCtx());
    expect(rt.state.world.flags['echo']).toBe('hi');
    expect(outcome.jumps).toEqual([]);
  });

  it('重复 id 注册冲突报 DUP_ID', () => {
    const registry = makeRegistry([makeEchoDef()]);
    try {
      registry.register(makeEchoDef());
      expect.unreachable('重复注册应抛出 DUP_ID');
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).code).toBe('DUP_ID');
      expect((err as EngineError).where.id).toBe('x.test.echo');
    }
  });

  it('作者扩展 id 不满足 x.<script>.<name> 报 SCRIPT_CONTRACT（DD-08 命名空间）', () => {
    for (const id of ['echo', 'x.echo', 'x.a.b.c', 'X.test.echo', 'x.Test.echo']) {
      const registry = makeRegistry();
      try {
        registry.register({ ...makeEchoDef(), id });
        expect.unreachable(`非法命名空间应被拒绝：${id}`);
      } catch (err) {
        expect((err as EngineError).code).toBe('SCRIPT_CONTRACT');
        expect((err as EngineError).where.id).toBe(id);
      }
    }
  });

  it('合法 x.<script>.<name> 形态可注册，ids() 返回已注册清单', () => {
    const registry = makeRegistry([makeEchoDef({ id: 'x.festival.calendar' })]);
    expect(registry.ids()).toEqual(['x.festival.calendar']);
    expect(registry.lookup('x.festival.calendar')?.id).toBe('x.festival.calendar');
    expect(registry.lookup('nope')).toBeUndefined();
  });
});

describe('05-A1 EffectRegistry：参数 Zod 校验与解析期错误', () => {
  it('未注册指令：EFFECT_FAILED，cause 定位携带指令 id', () => {
    const { rt } = makeEffectRuntime();
    try {
      rt.exec([asEffectData({ 'x.test.missing': {} })], makeCtx());
      expect.unreachable('未注册指令应抛 EFFECT_FAILED');
    } catch (err) {
      const engineErr = err as EngineError;
      expect(engineErr.code).toBe('EFFECT_FAILED');
      expect(engineErr.where.instruction).toBe('0');
      expect(engineErr.where.scene).toBe('scene_tavern');
      const cause = engineErr.cause as EngineError;
      expect(cause.code).toBe('EFFECT_FAILED');
      expect(cause.where.op).toBe('x.test.missing');
    }
  });

  it('参数 schema 校验失败：EFFECT_FAILED，cause 携带 op 与 param', () => {
    const { rt } = makeEffectRuntime({ builtins: [makeEchoDef()] });
    try {
      rt.exec([asEffectData({ 'x.test.echo': { msg: 42 } })], makeCtx());
      expect.unreachable('参数类型不符应抛 EFFECT_FAILED');
    } catch (err) {
      const cause = (err as EngineError).cause as EngineError;
      expect(cause.code).toBe('EFFECT_FAILED');
      expect(cause.where.op).toBe('x.test.echo');
      expect(cause.where.param).toBe('msg');
    }
  });

  it('多键对象指令：EFFECT_FAILED（invalidShape）', () => {
    const { rt } = makeEffectRuntime({ builtins: [makeEchoDef()] });
    try {
      rt.exec(
        [asEffectData({ 'x.test.echo': { msg: 'a' }, extra: true } as Record<string, unknown>)],
        makeCtx(),
      );
      expect.unreachable('多键指令应抛 EFFECT_FAILED');
    } catch (err) {
      const cause = (err as EngineError).cause as EngineError;
      expect(cause.where.op).toBeUndefined();
      expect(cause.message).toContain('单键对象');
    }
  });

  it('注册表参数 schema 与 02 号 effectParamSchemas 兼容：同形数据同判', () => {
    // 以 flag 指令的 02 号 schema 注册为测试指令：接受/拒绝面与数据侧基准一致
    const def: EffectInstructionDef<{ name: string; value?: boolean }> = {
      id: 'x.test.schema_parity',
      schema: effectParamSchemas.flag,
      touch: () => ({ reads: [], writes: ['world.flags'] }),
      execute: (arg, ectx) => {
        ectx.draft.world.flags[arg.name] = arg.value ?? true;
      },
    };
    const { rt } = makeEffectRuntime({ builtins: [def] });
    rt.exec([asEffectData({ 'x.test.schema_parity': { name: 'door' } })], makeCtx());
    expect(rt.state.world.flags['door']).toBe(true);
    expect(() =>
      rt.exec([asEffectData({ 'x.test.schema_parity': { name: 'x', value: 'yes' } })], makeCtx()),
    ).toThrowError(/EFFECT_FAILED/);
  });
});

describe('05-A1 EffectRegistry：跳转通道与执行上下文扩展', () => {
  it('def.jumps 静态声明在解析期入列；execute 不写状态（§3.3 分界）', () => {
    let executed = 0;
    const def: EffectInstructionDef<{ target: string }> = {
      id: 'x.test.warp',
      schema: z.strictObject({ target: z.string().min(1) }),
      touch: () => ({ reads: [], writes: [] }),
      // 跳转类指令的 execute 为无副作用空操作：目标已在解析期静态声明
      execute: () => {
        executed += 1;
      },
      jumps: (arg) => [{ type: 'scene', scene: arg.target }],
    };
    const { rt } = makeEffectRuntime({ builtins: [def] });
    const before = rt.state;
    const outcome = rt.exec(
      [asEffectData({ 'x.test.warp': { target: 'scene_cellar' } })],
      makeCtx(),
    );
    expect(executed).toBe(1);
    expect(outcome.jumps).toEqual<JumpTarget[]>([{ type: 'scene', scene: 'scene_cellar' }]);
    expect(outcome.patches).toEqual([]);
    expect(rt.state).toBe(before);
  });

  it('emitJump 动态产出经执行期收集汇入 ExecOutcome.jumps', () => {
    const def: EffectInstructionDef<{ slots: number }> = {
      id: 'x.test.timed',
      schema: z.strictObject({ slots: z.number().int().min(0) }),
      touch: () => ({ reads: [], writes: [] }),
      execute: (arg, ectx) => {
        if (arg.slots > 0) ectx.emitJump({ type: 'advanceTime', slots: arg.slots });
      },
    };
    const { rt } = makeEffectRuntime({ builtins: [def] });
    const outcome = rt.exec([asEffectData({ 'x.test.timed': { slots: 2 } })], makeCtx());
    expect(outcome.jumps).toEqual<JumpTarget[]>([{ type: 'advanceTime', slots: 2 }]);
    expect(outcome.patches).toEqual([]);
  });

  it('evalSource 以注册表函数注册表编译并按 draft 实时视图求值', () => {
    const seen: unknown[] = [];
    const def: EffectInstructionDef<Record<string, never>> = {
      id: 'x.test.probe',
      schema: z.strictObject({}),
      touch: () => ({ reads: ['player.attrs'], writes: ['world.flags'] }),
      execute: (_arg, ectx) => {
        seen.push(ectx.evalSource('attr.hp + 1'));
        seen.push(ectx.evalSource('has("herb")'));
      },
    };
    const { rt } = makeEffectRuntime({ builtins: [def] });
    rt.exec([asEffectData({ 'x.test.probe': {} })], makeCtx());
    expect(seen).toEqual([31, false]);
    expect(() => fxCompile('attr.hp +')).toThrowError(/EXPR_COMPILE/);
  });

  it('选项契约违规在构造期报 INTERNAL（bagCapacity / reputationBounds）', () => {
    expect(() => makeRegistry([], { bagCapacity: -1 })).toThrowError(/INTERNAL/);
    expect(() => makeRegistry([], { bagCapacity: 1.5 })).toThrowError(/INTERNAL/);
    expect(() => makeRegistry([], { reputationBounds: { min: 10, max: -10 } })).toThrowError(
      /INTERNAL/,
    );
    expect(() =>
      makeRegistry([], { bagCapacity: 0, reputationBounds: { min: -5, max: 5 } }),
    ).not.toThrowError();
  });
});
