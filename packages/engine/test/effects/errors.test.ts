import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EngineError } from '@game/shared';
import { BASE_VERSIONS, makeBuiltinRuntime, makeCtx } from './fixtures.js';
import type { EffectData } from '@game/shared';
import { asEffectData } from './fixtures.js';
import type { EffectInstructionDef } from '../../src/effects/types.js';

/**
 * C2 失败定位（设计 §3.3「指令失败统一包装 EFFECT_FAILED{where.instruction=i,
 * sourceExpr}」、FR-DEBG-07 / NFR-23；05 任务 C2）：
 * - 外层 where 携带 source / scene / event / battle / instruction（0 起），
 *   sourceExpr 从 cause 链提升（指令归因层自带的 sourceExpr 与求值器层的
 *   where.expr 同义提升）；
 * - child 嵌套两级定位：外层定位父指令，cause 链保留子批 scene/instruction；
 * - where 为冻结副本（构造后不可变，诊断序列化安全）。
 */

function makeRuntime() {
  return makeBuiltinRuntime({ bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 30, con: 2 } } });
}

function catchEffectFailed(run: () => unknown): EngineError {
  try {
    run();
    expect.unreachable('应抛出 EFFECT_FAILED');
  } catch (err) {
    const engineErr = err as EngineError;
    expect(engineErr.code).toBe('EFFECT_FAILED');
    expect(engineErr.messageKey).toBe('error.runtime.effectFailed');
    return engineErr;
  }
  throw new Error('unreachable');
}

describe('05-C2 EFFECT_FAILED.where：调用方定位贯穿', () => {
  it('source/scene/instruction（0 起）逐指令定位', () => {
    const { rt } = makeRuntime();
    const err = catchEffectFailed(() =>
      rt.exec(
        [
          { set: { key: 'attr.hp', value: 5 } },
          { set: { key: 'bogus', value: 1 } },
        ] as EffectData[],
        makeCtx(),
      ),
    );
    expect(err.where.source).toBe('choice');
    expect(err.where.scene).toBe('scene_tavern');
    expect(err.where.instruction).toBe('1');
  });

  it('event / battle 定位字段随事务来源透传', () => {
    const { rt } = makeRuntime();
    const eventErr = catchEffectFailed(() =>
      rt.exec(
        [{ set: { key: 'bogus', value: 1 } }] as EffectData[],
        makeCtx({ source: 'event', where: { event: 'evt_ambush' } }),
      ),
    );
    expect(eventErr.where.event).toBe('evt_ambush');
    expect(eventErr.where.instruction).toBe('0');

    const battleErr = catchEffectFailed(() =>
      rt.exec(
        [{ set: { key: 'bogus', value: 1 } }] as EffectData[],
        makeCtx({ source: 'battle', where: { battle: 'battle_rat' } }),
      ),
    );
    expect(battleErr.where.battle).toBe('battle_rat');
  });

  it('where 为冻结副本：构造后不可变（诊断序列化安全，§10.2）', () => {
    const { rt } = makeRuntime();
    const err = catchEffectFailed(() =>
      rt.exec([{ set: { key: 'bogus', value: 1 } }] as EffectData[], makeCtx()),
    );
    expect(Object.isFrozen(err.where)).toBe(true);
  });
});

describe('05-C2 EFFECT_FAILED.where：sourceExpr 提升（§3.3）', () => {
  it('指令归因失败自带 sourceExpr 提升到外层 where', () => {
    const { rt } = makeRuntime();
    const err = catchEffectFailed(() =>
      rt.exec([{ set: { key: 'attr.hp', value: 'strong' } }] as EffectData[], makeCtx()),
    );
    expect(err.where.sourceExpr).toBe('strong');
    expect(err.where.instruction).toBe('0');
    const cause = err.cause as EngineError;
    expect(cause.where.sourceExpr).toBe('strong');
  });

  it('求值器运行期错误经 where.expr 同义提升', () => {
    const { rt } = makeRuntime();
    const err = catchEffectFailed(() =>
      rt.exec([{ add: { key: 'attr.hp', amount: 'attr.missing + 1' } }] as EffectData[], makeCtx()),
    );
    expect(err.where.sourceExpr).toBe('attr.missing + 1');
    // cause 链：指令归因层（op/param）→ 求值器层（expr/path/key）
    const attributed = err.cause as EngineError;
    expect(attributed.where.op).toBe('add');
    expect(attributed.where.param).toBe('amount');
    const evalErr = attributed.cause as EngineError;
    expect(evalErr.code).toBe('EVAL_ERROR');
    expect(evalErr.where.expr).toBe('attr.missing + 1');
  });

  it('表达式编译错误（EXPR_COMPILE）同样提升原文', () => {
    const { rt } = makeRuntime();
    const err = catchEffectFailed(() =>
      rt.exec([{ money: { gold: 'attr.hp +' } }] as EffectData[], makeCtx()),
    );
    expect(err.where.sourceExpr).toBe('attr.hp +');
  });

  it('无表达式参与的失败（如未知阵营）不添加 sourceExpr 键', () => {
    const { rt } = makeRuntime();
    const err = catchEffectFailed(() =>
      rt.exec(
        [{ reputation: { faction: 'faction_ghost', amount: 5 } }] as EffectData[],
        makeCtx({ source: 'hook', where: {} }),
      ),
    );
    expect(err.where.sourceExpr).toBeUndefined();
    expect(err.where.instruction).toBe('0');
  });
});

describe('05-C2 EFFECT_FAILED.where：child 嵌套两级定位', () => {
  it('外层定位父指令（scene+instruction），cause 保留子批 scene/instruction', () => {
    // 作者扩展指令经 ectx.child 制造嵌套批：子效果 take 失败 → 两级定位
    const { rt, registry } = makeRuntime();
    registry.register({
      id: 'x.test.child_fail',
      schema: z.strictObject({}),
      touch: () => ({ reads: [], writes: [] }),
      execute: (_arg, ectx) => {
        ectx.child(
          [
            asEffectData({ take: { item: 'item_ghost', count: 1 } }),
            asEffectData({ take: { item: 'item_worse', count: 1 } }),
          ],
          { source: 'hook', where: { scene: 'scene_child' }, rng: ectx.rng },
        );
      },
    } satisfies EffectInstructionDef<Record<string, never>>);

    const err = catchEffectFailed(() =>
      rt.exec(
        [{ set: { key: 'flag.before', value: true } }, { 'x.test.child_fail': {} }] as EffectData[],
        makeCtx(),
      ),
    );
    // 外层：父指令定位（instruction=1，0 起）
    expect(err.where.scene).toBe('scene_tavern');
    expect(err.where.instruction).toBe('1');
    // cause：子批定位（scene_child + 失败子指令 j=0）；其 cause 为指令归因（op=take）
    const child = err.cause as EngineError;
    expect(child.code).toBe('EFFECT_FAILED');
    expect(child.where.scene).toBe('scene_child');
    expect(child.where.instruction).toBe('0');
    const attributed = child.cause as EngineError;
    expect(attributed.where.op).toBe('take');
    expect(attributed.where.item).toBe('item_ghost');
  });

  it('子批失败整批回滚：父事务状态零变化', () => {
    const { rt, registry } = makeRuntime();
    registry.register({
      id: 'x.test.child_boom',
      schema: z.strictObject({}),
      touch: () => ({ reads: [], writes: ['world.flags'] }),
      execute: (_arg, ectx) => {
        ectx.child([{ take: { item: 'item_ghost', count: 1 } }], {
          source: 'hook',
          where: { scene: 'scene_child' },
          rng: ectx.rng,
        });
      },
    } satisfies EffectInstructionDef<Record<string, never>>);
    const before = rt.state;
    catchEffectFailed(() =>
      rt.exec([asEffectData({ 'x.test.child_boom': {} })] as EffectData[], makeCtx()),
    );
    expect(rt.state).toBe(before);
  });
});
