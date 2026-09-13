import type { EffectData } from '@game/shared';
import type { TimeStepContext, TimeStepProvider } from '../time/index.js';

/**
 * 物品 tick 管线挂载器（FR-ITEM-06，13 任务 5；§4.7 步骤 2）。
 *
 * 返回时间管线 statusTick 槽位的步骤钩子：每次推进产出一批 `__items.tick`
 * 内部指令（同一事务内完成耐久/时效结算，一次推进 = 一个 undo 点）。
 * 宿主装配示例：
 * ```ts
 * new TimePipeline({ runtime, config, statusTick: createItemTickProvider() })
 * ```
 */
export function createItemTickProvider(): TimeStepProvider {
  return (ctx: TimeStepContext): EffectData[] => {
    return [
      {
        '__items.tick': { elapsedSlots: ctx.slots, crossedDay: ctx.crossedDay },
      } as unknown as EffectData,
    ];
  };
}
