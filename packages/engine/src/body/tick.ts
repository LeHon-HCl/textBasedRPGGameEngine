import type { EffectData } from '@game/shared';
import type { TimeStepContext, TimeStepProvider } from '../time/index.js';

/**
 * 临时变身回退的管线挂载器（§4.3 步骤 3「临时身体回退」，FR-BODY-02，14 号）。
 *
 * 返回时间管线 bodyRevert 槽位的步骤钩子：每次推进产出 `__body.revert` 内部
 * 指令（与时钟推进同事务；一次推进 = 一个 undo 点）。指令内递减
 * `player.bodyTemp[*].remainingSlots`，归零者还原 `player.body[part]` 并
 * emit `body_reverted`（作者订阅决定后果；引擎不解释身体语义，中立性）。
 *
 * 装配示例：
 * ```ts
 * new TimePipeline({ runtime, config, bodyRevert: createBodyRevertProvider() })
 * ```
 */
export function createBodyRevertProvider(): TimeStepProvider {
  return (ctx: TimeStepContext): EffectData[] => {
    // 无临时项时短路：省掉一次空事务指令（推进管线其余步骤照常）
    if (Object.keys(ctx.runtime.state.player.bodyTemp).length === 0) return [];
    return [{ '__body.revert': { elapsedSlots: ctx.slots } } as unknown as EffectData];
  };
}
