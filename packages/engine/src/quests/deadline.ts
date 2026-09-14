import type { EffectData } from '@game/shared';
import type { TimeStepProvider } from '../time/index.js';

/**
 * 任务截止检查的管线挂载器（FR-QUEST-01 时间限制，§4.5；11 任务 5）。
 *
 * 返回时间管线步骤 7（questDeadline）的步骤钩子：每次推进产出一条
 * `__quest.deadline` 内部指令——它在**同一事务内**（时钟已推进后）对全部
 * active / ready_to_submit 任务做 failWhen 全量判定，命中即转 failed 并发
 * `quest_state_changed`（一次推进 = 一个 undo 点，DD-10）。
 *
 * 装配示例：
 * ```ts
 * new TimePipeline({ runtime, config, questDeadline: createQuestDeadlineProvider() })
 * ```
 */
export function createQuestDeadlineProvider(): TimeStepProvider {
  // 是否活跃的任务过滤在指令内完成（指令持有任务目录）；此处恒产一条，
  // 无任务时为空操作，结算/失败仍在同一事务。
  return (): EffectData[] => [{ '__quest.deadline': {} } as unknown as EffectData];
}
