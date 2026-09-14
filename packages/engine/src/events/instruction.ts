import { EngineError } from '@game/shared';
import { z } from 'zod';
import { truthy } from '../expr-eval/index.js';
import type { EffectRegistryOptions } from '../effects/types.js';
import { eraseDef } from '../effects/types.js';
import type { EffectInstructionDef, ErasedEffectDef, TouchReport } from '../effects/types.js';

/**
 * `__events.eval` 内部指令（§4.3 步骤 6，10 任务 5）。
 *
 * **引擎内部面，不面向作者**——由时间管线经 createEventStepProvider 挂载
 * （与 `__time.advance` / `__npc.resolve` / `__quest.deadline` 同形态）；
 * 作者包内书写会被 effectDataSchema 的加载期校验拒绝（未知指令键），
 * 运行期仅管线可达。评估面经 options.eventPool 注入（缺省 = 报错显性化）。
 *
 * 执行：collect → prune → select → 冷却登记（写 draft）→ 跳转（emitJump，
 * 子会话启动归 SceneRunner 的 eventSceneIds 判定）。
 */
export function createEventDefs(options: EffectRegistryOptions): ErasedEffectDef[] {
  const evalDef: EffectInstructionDef<{ touched?: string[] }> = {
    id: '__events.eval',
    schema: z.strictObject({ touched: z.array(z.string()).optional() }),
    touch: (): TouchReport => ({ reads: [], writes: ['world.eventCooldowns'] }),
    execute: (arg, ectx) => {
      const pool = options.eventPool;
      if (pool === undefined) {
        throw new EngineError({
          code: 'INTERNAL',
          where: { op: '__events.eval', detail: '未注入 eventPool（10 号事件池未装配）' },
          messageKey: 'error.events.pool',
        });
      }
      const result = pool.evaluate({
        state: ectx.draft,
        evalCondition: (source) => truthy(ectx.evalSource(source)),
        rng: ectx.rng,
        ...(arg.touched !== undefined ? { touched: arg.touched } : {}),
      });
      for (const update of result.cooldownUpdates) {
        const entry: { lastDay: number; fired: number; lastSlotIndex?: number } = {
          lastDay: update.lastDay,
          fired: update.fired,
        };
        if (update.lastSlotIndex !== undefined) entry.lastSlotIndex = update.lastSlotIndex;
        ectx.draft.world.eventCooldowns[update.eventId] = entry;
      }
      for (const jump of result.jumps) {
        if (jump.type === 'scene' && typeof jump.scene === 'string') {
          ectx.emitJump({ type: 'scene', scene: jump.scene });
        }
      }
    },
  };
  return [eraseDef(evalDef)];
}
