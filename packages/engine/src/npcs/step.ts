import type { EffectData, TimeConfig } from '@game/shared';
import { advanceClock } from '../time/clock.js';
import { createTimeViewProvider } from '../time/calendar.js';
import type { TimeStepProvider } from '../time/index.js';

/**
 * NPC 日程移动的管线挂载器（§4.3 步骤 5；12 任务 2）。
 *
 * 返回时间管线 npcSchedule 槽位的步骤钩子：每次推进产出一条 `__npc.resolve`
 * 内部指令——它在同一事务内（时钟已推进后）批量解析日程并重建
 * `world.npcLocationCache`（一次推进 = 一个 undo 点，DD-10）。
 *
 * 时段/星期口径：钩子在收集期（时钟写入前）用推进纯函数预计算推进后的
 * {@link Clock}，再经 TimeConfig 校准投影 slot/weekday 交给指令；未注入 config
 * 时指令回退 defaultTimeView 缺省投影。装配示例：
 * ```ts
 * new TimePipeline({ runtime, config, npcSchedule: createNpcScheduleProvider(config) })
 * ```
 */
export function createNpcScheduleProvider(config?: TimeConfig): TimeStepProvider {
  const viewOf = config !== undefined ? createTimeViewProvider(config) : undefined;
  return (ctx): EffectData[] => {
    const payload: { slot?: string; weekday?: string } = {};
    if (config !== undefined && viewOf !== undefined) {
      // 收集期时钟尚未写入，按推进纯函数预计算本步骤应看到的时钟
      const nextClock = advanceClock(ctx.runtime.state.world.time, config, ctx.slots).clock;
      const view = viewOf(nextClock);
      payload.slot = view.slot;
      payload.weekday = view.weekday;
    }
    return [{ '__npc.resolve': payload } as unknown as EffectData];
  };
}
