import { EngineError } from '@game/shared';
import type { Rng } from '@game/shared';
import type { CheckRequest, CheckResult, CheckRule } from '../effects/index.js';

/**
 * generic 检定规则（detail-design §5.1 内置实现，15 号 commit 6）。
 *
 * - `roll = rng.int(1, 100)`（单骰，无大成功/大失败升格语义）；
 * - `success = roll + value ≥ difficultyValue`——难度数值由调用方表达式给出
 *   （check 指令的 `difficultyValue` 参数，15 号 additive 扩展）；
 * - 等级投影：success → 'normal'、fail → 'fail'（generic 无档位概念，
 *   分支路由自然走 onSuccess/onFail）；
 * - 契约错误显性化：`difficultyValue` 缺失 = 作者数据缺陷（§5.1「难度数值由
 *   调用方给出」），抛 EFFECT_FAILED 阻断该事务，不静默按 0 处理；
 * - 纯函数：随机只经注入 Rng（DD-09）。
 */
export const genericRule: CheckRule = {
  id: 'generic',
  resolve(req: CheckRequest, rng: Rng): CheckResult {
    if (req.difficultyValue === undefined) {
      throw new EngineError({
        code: 'EFFECT_FAILED',
        where: {
          op: 'check',
          rule: 'generic',
          detail: 'generic 规则要求 difficultyValue（§5.1：roll + value ≥ difficultyValue）',
        },
        messageKey: 'error.effects.instructionFailed',
      });
    }
    const roll = rng.int(1, 100);
    const total = roll + req.value;
    const outcome: CheckResult['outcome'] = total >= req.difficultyValue ? 'success' : 'fail';
    return {
      rolls: [roll],
      level: outcome === 'success' ? 'normal' : 'fail',
      outcome,
      detail: {
        roll,
        value: req.value,
        difficultyValue: req.difficultyValue,
        margin: total - req.difficultyValue,
      },
    };
  },
};
