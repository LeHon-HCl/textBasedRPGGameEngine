import { z } from 'zod';
import { truthy } from '../../expr-eval/index.js';
import { defaultTimeView } from '../../state/index.js';
import { createTimeViewProvider } from '../../time/calendar.js';
import type { EffectRegistryOptions } from '../types.js';
import { eraseDef } from '../types.js';
import type { EffectInstructionDef, ErasedEffectDef, TouchReport } from '../types.js';
import { resolveNpcLocations, sameNpcLocationCache } from '../../npcs/schedule.js';

/**
 * NPC 类内部指令（引擎内部面，不面向作者；§4.6，12 任务 2）。
 *
 * `__npc.resolve` 是时间管线步骤 5 的载体（与 `__time.advance` / `__quest.deadline`
 * 同形态）：在同一事务内（时钟已推进后）对 NPC 目录全量解析日程，重建可重建缓存
 * `world.npcLocationCache`。作者包内书写 `__npc.resolve` 会被 effectDataSchema
 * 的加载期校验拒绝（未知指令键），运行期仅管线可达。
 */
export function createNpcDefs(options: EffectRegistryOptions): ErasedEffectDef[] {
  const resolveDef: EffectInstructionDef<{ slot?: string; weekday?: string }> = {
    id: '__npc.resolve',
    schema: z.strictObject({
      slot: z.string().min(1).optional(),
      weekday: z.string().min(1).optional(),
    }),
    touch: (): TouchReport => ({ reads: [], writes: ['world.npcLocationCache'] }),
    execute: (arg, ectx) => {
      const draft = ectx.draft;
      const npcs = options.npcs;
      if (npcs === undefined || npcs.size === 0) {
        if (!sameNpcLocationCache(draft.world.npcLocationCache, {})) {
          draft.world.npcLocationCache = {};
        }
        return;
      }
      const clock = draft.world.time;
      // 时段/星期优先取管线钩子（TimeConfig 校准）；缺省回退 TimeConfig 或
      // 04 号缺省投影（数值串），保证未接入时间配置时仍可自洽解析。
      let slot = arg.slot;
      let weekday = arg.weekday;
      if (slot === undefined || weekday === undefined) {
        const config = options.timeConfig;
        const view =
          config !== undefined ? createTimeViewProvider(config)(clock) : defaultTimeView(clock);
        slot = slot ?? view.slot;
        weekday = weekday ?? view.weekday;
      }
      // showIf 走注册表注册表（x.* 脚本函数可达）；求值错误上抛使整批事务回滚
      const next = resolveNpcLocations(npcs, clock, draft, {
        slot,
        weekday,
        evaluate: (source) => truthy(ectx.evalSource(source)),
      });
      if (!sameNpcLocationCache(draft.world.npcLocationCache, next)) {
        draft.world.npcLocationCache = next;
      }
    },
  };
  return [eraseDef(resolveDef)];
}
