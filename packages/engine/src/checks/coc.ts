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
 *   覆盖一切档位判定。注意：§5.1 表格下极难线与大成功线同为 ⌊skill/5⌋，
 *   extreme 等级被 critical 吸收、单方检定实际不可达——等级枚举保留 extreme
 *   是为对抗比较与脚本规则扩展留位；
 * - 成败由**请求难度档**裁决（normal → skill，hard → ⌊skill/2⌋，
 *   extreme → ⌊skill/5⌋）；等级按「大成功 > 极难 > 困难 > 普通 > 失败 > 大失败」
 *   降序投影，即使请求 hard 档、roll 落进极难区间也如实报高等级；
 * - 对抗检定（FR-CMBT-03）：攻方（本请求，可带骰池）与守方（opposedValue =
 *   守方技能值，无骰池）各投一次——等级序高者胜 → 同级「技能值低者胜」→
 *   再平「守方胜」；攻方另须满足自身请求难度档，否则对抗虽胜仍判失败；
 * - 纯函数：随机只经注入 Rng（DD-09），不读状态、不抛业务错误
 *   （value 非法由 check 指令参数求值层拦截，本规则收到的 value 视为已合法）。
 */

/** 单次 d100 分解投掷：十位/个位各一枚 d10（0–9），00 → 100 */
function rollD100(rng: Rng): { roll: number; tens: number; units: number } {
  const tens = rng.int(0, 9);
  const units = rng.int(0, 9);
  return { roll: tens === 0 && units === 0 ? 100 : tens * 10 + units, tens, units };
}

/** 按技能值给 roll 定级（§5.1 阈值表 + 大成功/大失败升格；攻守共用） */
function grade(
  roll: number,
  skill: number,
): { level: CheckResult['level']; isFumble: boolean; critical: number; hard: number; extreme: number } {
  const hard = Math.floor(skill / 2);
  const extreme = Math.floor(skill / 5);
  const critical = Math.max(1, extreme);
  const isFumble = roll === 100 || (skill < 50 && roll >= 96);
  const level: CheckResult['level'] = isFumble
    ? 'fumble'
    : roll <= critical
      ? 'critical'
      : roll <= extreme
        ? 'extreme'
        : roll <= hard
          ? 'hard'
          : roll <= skill
            ? 'normal'
            : 'fail';
  return { level, isFumble, critical, hard, extreme };
}

/** 等级序权重（§5.1 对抗比较；fumble 与 fail 同档最低） */
function rank(level: CheckResult['level']): number {
  switch (level) {
    case 'critical':
      return 4;
    case 'extreme':
      return 3;
    case 'hard':
      return 2;
    case 'normal':
      return 1;
    default:
      return 0;
  }
}

/** 请求难度档对应的成功线（缺省 normal） */
function requiredThreshold(skill: number, difficulty: CheckRequest['difficulty']): number {
  if (difficulty === 'hard') return Math.floor(skill / 2);
  if (difficulty === 'extreme') return Math.floor(skill / 5);
  return skill;
}

export const cocRule: CheckRule = {
  id: 'coc',
  resolve(req: CheckRequest, rng: Rng): CheckResult {
    const difficulty = req.difficulty ?? 'normal';
    const required = requiredThreshold(req.value, difficulty);

    // —— 对抗检定（FR-CMBT-03） ——
    if (req.opposedValue !== undefined) {
      const attacker = rollD100(rng);
      const attackerGrade = grade(attacker.roll, req.value);
      const defender = rollD100(rng);
      const defenderGrade = grade(defender.roll, req.opposedValue);

      // 等级序高者胜 → 同级技能值低者胜（更艰难的成功更优）→ 再平守方胜
      let winner: 'attacker' | 'defender';
      const attackerRank = rank(attackerGrade.level);
      const defenderRank = rank(defenderGrade.level);
      if (attackerRank !== defenderRank) {
        winner = attackerRank > defenderRank ? 'attacker' : 'defender';
      } else if (req.value !== req.opposedValue) {
        winner = req.value < req.opposedValue ? 'attacker' : 'defender';
      } else {
        winner = 'defender';
      }
      // 攻方须同时满足自身请求难度档（对抗赢了但难度不够 = 仍失败）；
      // 大成功豁免与单方检定同款（roll ≤ 大成功线即视作满足难度档）
      const outcome: CheckResult['outcome'] =
        winner === 'attacker' && (attacker.roll <= attackerGrade.critical || attacker.roll <= required)
          ? 'success'
          : 'fail';

      return {
        rolls: [attacker.roll, defender.roll],
        level: attackerGrade.level,
        outcome,
        detail: {
          skill: req.value,
          difficulty,
          roll: attacker.roll,
          required,
          opposed: {
            defenderSkill: req.opposedValue,
            defenderRoll: defender.roll,
            attackerLevel: attackerGrade.level,
            defenderLevel: defenderGrade.level,
            winner,
          },
        },
      };
    }

    // —— 单方检定 ——
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

    const attackerGrade = grade(roll, req.value);
    // 成败：大成功无视难度档一律成功，大失败一律失败，其余按请求难度档裁决
    const outcome: CheckResult['outcome'] = attackerGrade.isFumble
      ? 'fail'
      : roll <= attackerGrade.critical || roll <= required
        ? 'success'
        : 'fail';

    return {
      rolls,
      level: attackerGrade.level,
      outcome,
      detail: {
        skill: req.value,
        difficulty,
        roll,
        required,
        margin: required - roll,
        thresholds: {
          hard: attackerGrade.hard,
          extreme: attackerGrade.extreme,
          critical: attackerGrade.critical,
        },
        // 骰池明细（仅奖惩骰存在时；调试与动画复现用）
        ...(net !== 0 ? { tensPool, chosenTens, units, netBonusDice: net } : {}),
      },
    };
  },
};
