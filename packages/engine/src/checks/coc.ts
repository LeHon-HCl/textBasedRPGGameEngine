import type { Rng } from '@game/shared';
import type { CheckRequest, CheckResult, CheckRule } from '../effects/index.js';

/**
 * CoC 7 版检定规则（detail-design §5.1 内置实现，15 号；FR-CMBT-01～05）。
 *
 * - d100 以「十位骰 × 个位骰」分解投出（与奖惩骰池同一条随机路径，分布一致：
 *   (tens, units) 均匀 1/100，00 记 100）；
 * - 阈值策略常量化（可被脚本预设覆盖的立场：内置值只在此处定义一份），
 *   全部用 floor 除法：困难 = ⌊skill/2⌋，极难 = ⌊skill/5⌋；
 * - 大成功 = roll ≤ max(1, ⌊skill/5⌋)（skill < 5 时保底 1），**无视请求难度档
 *   一律成功**；大失败 = roll = 100，或 skill < 50 且 roll ≥ 96；两者升格
 *   覆盖一切档位判定（大失败先于大成功检查，二者互斥不会同时成立）；
 * - 成败由**请求难度档**裁决（normal → skill，hard → ⌊skill/2⌋，
 *   extreme → ⌊skill/5⌋）；等级按「大成功 > 极难 > 困难 > 普通 > 失败 > 大失败」
 *   降序投影，即使请求 hard 档、roll 落进极难区间也如实报 extreme 等级；
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
    const difficulty = req.difficulty ?? 'normal';
    // 阈值表（floor 除法；§5.1 表格）：normal/hard/extreme 三档成功线
    const thresholds = {
      hard: Math.floor(req.value / 2),
      extreme: Math.floor(req.value / 5),
    };
    // 大失败（§5.1 表格）：roll = 100，或 skill < 50 且 roll ≥ 96
    const isFumble = roll === 100 || (req.value < 50 && roll >= 96);
    // 大成功阈值：max(1, ⌊skill/5⌋)——skill < 5 时保底 1（roll=1 仍可大成功）
    const criticalThreshold = Math.max(1, thresholds.extreme);
    // 等级降序投影：大失败 > 一切（fail 档），大成功 > 一切（success 档）
    const level: CheckResult['level'] = isFumble
      ? 'fumble'
      : roll <= criticalThreshold
        ? 'critical'
        : roll <= thresholds.extreme
          ? 'extreme'
          : roll <= thresholds.hard
            ? 'hard'
            : roll <= req.value
              ? 'normal'
              : 'fail';
    // 成败：大成功无视难度档一律成功，大失败一律失败，其余按请求难度档裁决
    const required = difficulty === 'normal' ? req.value : thresholds[difficulty];
    const outcome: CheckResult['outcome'] =
      level === 'critical' ? 'success' : isFumble ? 'fail' : roll <= required ? 'success' : 'fail';
    return {
      rolls: [roll],
      level,
      outcome,
      detail: {
        skill: req.value,
        difficulty,
        roll,
        required,
        margin: required - roll,
        thresholds: { ...thresholds, critical: criticalThreshold },
      },
    };
  },
};
