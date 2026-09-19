import type { Rng } from '@game/shared';
import type { CheckRequest, CheckResult, CheckRule } from '../effects/index.js';

/**
 * CoC 7 版检定规则（detail-design §5.1 内置实现，15 号；FR-CMBT-01～05）。
 *
 * - d100 以「十位骰 × 个位骰」分解投出（与奖惩骰池同一条随机路径，分布一致：
 *   (tens, units) 均匀 1/100，00 记 100）；
 * - 阈值策略常量化（可被脚本预设覆盖的立场：内置值只在此处定义一份），
 *   全部用 floor 除法：困难 = ⌊skill/2⌋，极难 = ⌊skill/5⌋；
 * - 奖励/惩罚骰（FR-CMBT-04）：奖励与惩罚骰两两抵消，净奖励骰池「十位取低」、
 *   净惩罚骰池「十位取高」，与个位骰组合成最终 d100；骰池原文进 rolls/detail；
 * - 大成功 = roll ≤ max(1, ⌊skill/5⌋)（skill < 5 时保底 1），**无视请求难度档
 *   一律成功**；大失败 = roll = 100，或 skill < 50 且 roll ≥ 96；两者升格
 *   覆盖一切档位判定（大失败先于大成功检查，二者互斥不会同时成立）；
 * - 成败由**请求难度档**裁决（normal → skill，hard → ⌊skill/2⌋，
 *   extreme → ⌊skill/5⌋）；等级按「大成功 > 极难 > 困难 > 普通 > 失败 > 大失败」
 *   降序投影，即使请求 hard 档、roll 落进极难区间也如实报 extreme 等级；
 * - 纯函数：随机只经注入 Rng（DD-09），不读状态、不抛业务错误
 *   （value 非法由 check 指令参数求值层拦截，本规则收到的 value 视为已合法）。
 */

export const cocRule: CheckRule = {
  id: 'coc',
  resolve(req: CheckRequest, rng: Rng): CheckResult {
    // 奖惩骰净数：奖励与惩罚骰两两抵消（CoC 7 惯例），净奖励取最低十位、
    // 净惩罚取最高十位；十位骰池 = 基础 1 枚 + |净数| 枚（链式 N 个）
    const net = (req.bonusDice ?? 0) - (req.penaltyDice ?? 0);
    const tensPool: number[] = [];
    for (let i = 0; i < 1 + Math.abs(net); i++) tensPool.push(rng.int(0, 9));
    const units = rng.int(0, 9);
    const chosenTens =
      net > 0 ? Math.min(...tensPool) : net < 0 ? Math.max(...tensPool) : (tensPool[0] as number);
    // 00 → 100（含骰池组合出的 00，CoC 7 同款语义）
    const roll = chosenTens === 0 && units === 0 ? 100 : chosenTens * 10 + units;
    // rolls 投影：[最终骰值, ...十位骰池原文, 个位]（表现层动画数据，FR-CMBT-05）；
    // 无奖惩骰时只报最终骰值，省得表现层对无意义的 [roll, roll十位, 个位] 做特判
    const rolls = net === 0 ? [roll] : [roll, ...tensPool, units];

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
    const required = difficulty(req);
    const outcome: CheckResult['outcome'] =
      level === 'critical' ? 'success' : isFumble ? 'fail' : roll <= required ? 'success' : 'fail';
    return {
      rolls,
      level,
      outcome,
      detail: {
        skill: req.value,
        difficulty: req.difficulty ?? 'normal',
        roll,
        required,
        margin: required - roll,
        thresholds: { ...thresholds, critical: criticalThreshold },
        // 骰池明细（仅奖惩骰存在时；调试与动画复现用）
        ...(net !== 0 ? { tensPool, chosenTens, units, netBonusDice: net } : {}),
      },
    };
  },
};

/** 请求难度档对应的成功线（缺省 normal） */
function difficulty(req: CheckRequest): number {
  const d = req.difficulty ?? 'normal';
  if (d === 'hard') return Math.floor(req.value / 2);
  if (d === 'extreme') return Math.floor(req.value / 5);
  return req.value;
}
