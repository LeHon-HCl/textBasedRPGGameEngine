import type { EffectData } from '@game/shared';
import type { TimeStepProvider } from '../time/index.js';

/**
 * 事件池的管线挂载器（§4.3 步骤 6「事件池评估」，FR-XPLR-03，10 任务 5）。
 *
 * 返回时间管线 eventEval 槽位的步骤钩子：每次推进产出 `__events.eval` 内部
 * 指令（评估 + 冷却登记 + 场景跳转同事务原子，一次推进 = 一个 undo 点）。
 *
 * 装配示例：
 * ```ts
 * const pool = new EventPool({ events: def.events, poolIndex: def.poolIndex,
 *                              area: 'old_town', config: DEFAULT_TIME_CONFIG });
 * createBuiltinEffectRegistry({ ...options, eventPool: pool });  // __events.eval 装配
 * new TimePipeline({ runtime, config, eventEval: createEventStepProvider() });
 * ```
 */
export function createEventStepProvider(): TimeStepProvider {
  // 步骤上下文（推进参数）在当前实现中不用：事件评估所需的时钟从 draft 读取
  return (): EffectData[] => [{ '__events.eval': {} } as unknown as EffectData];
}
