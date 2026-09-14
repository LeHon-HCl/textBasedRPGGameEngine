import type { FactionThreshold } from '@game/shared';
import type { ReputationBounds } from '../effects/types.js';
import { clamp, thresholdFor } from './thresholds.js';

/**
 * 阵营声誉波段机制（设计 §4.6；FR-NPCR-04；12 任务 6）。
 *
 * 纯函数：`reputation` 指令的唯一算径——数值先按全局 reputationBounds
 * （FactionDef 无 min/max 字段）clamp，再按阈值表（thresholds，内部二分）
 * 定位波段；返回 from/to/changed 供指令层决定是否 emit
 * `reputation_band_changed`。引擎不解释「波段」语义（id/nameKey 由游戏数据定义）。
 */

/** 声誉变更结果（无副作用；调用方负责写回 factions 与发事件） */
export interface ReputationChange {
  /** clamp 后的新声誉值 */
  readonly value: number;
  /** 变更前波段 id（无阈值表 → undefined） */
  readonly from: string | undefined;
  /** 变更后波段 id（无阈值表 → undefined） */
  readonly to: string | undefined;
  /** 波段是否切换（true 才需要 emit ReputationBandChanged） */
  readonly changed: boolean;
}

/**
 * 计算声誉变更（clamp → 波段二分）。
 *
 * - 未注入 bounds → 不收敛；
 * - 无阈值表或空表 → from/to 均 undefined 且 changed=false（无数值带可切，
 *   与 05 号既有语义一致）；
 * - 低于全部阈值起算 → from=undefined，进入首档即 changed。
 */
export function applyReputationChange(
  thresholds: readonly FactionThreshold[] | undefined,
  bounds: ReputationBounds | undefined,
  current: number,
  amount: number,
): ReputationChange {
  const value =
    bounds !== undefined ? clamp(current + amount, bounds.min, bounds.max) : current + amount;
  const from = thresholds !== undefined ? thresholdFor(thresholds, current)?.id : undefined;
  const to = thresholds !== undefined ? thresholdFor(thresholds, value)?.id : undefined;
  const changed = thresholds !== undefined && thresholds.length > 0 && to !== from;
  return { value, from, to, changed };
}
