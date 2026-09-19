import type { Rng } from '@game/shared';
import type { CheckRequest, CheckResult, CheckRule } from '../effects/index.js';

/**
 * CoC 7 版检定规则（detail-design §5.1 内置实现，15 号；FR-CMBT-01～05）。
 *
 * - d100 以「十位骰 × 个位骰」分解投出（与奖惩骰池同一条随机路径，分布一致：
 *   (tens, units) 均匀 1/100，00 记 100）；
 * - 阈值策略常量化（可被脚本预设覆盖的立场：内置值只在此处定义一份），
 *   本 commit 先落普通阈值（roll ≤ skill）；困难/极难、大成功大失败、
 *   奖惩骰池、对抗检定随 15 号后续 commit 逐项补齐；
 * - 纯函数：随机只经注入 Rng（DD-09），不读状态、不抛业务错误
 *   （value 非法由 check 指令参数求值层拦截，本规则收到的 value 视为已合法）。
 */

/** d100 分解投掷：十位/个位各一枚 d10（0–9），00 → 100 */
function rollD100(rng: Rng): { roll: number; tens: number; units: number } {
  const tens = rng.int(0, 9);
  const units = rng.int(0, 9);
  return { roll: tens === 0 && units === 0 ? 100 : tens * 10 + units, tens, units };
}

export const cocRule: CheckRule = {
  id: 'coc',
  resolve(req: CheckRequest, rng: Rng): CheckResult {
    const { roll } = rollD100(rng);
    // 普通阈值（本 commit 范围）：roll ≤ skill 即成功
    const outcome = roll <= req.value ? 'success' : 'fail';
    const level = outcome === 'success' ? 'normal' : 'fail';
    return {
      rolls: [roll],
      level,
      outcome,
      detail: { skill: req.value, roll, margin: req.value - roll },
    };
  },
};
