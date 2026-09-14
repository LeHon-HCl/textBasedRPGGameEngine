import type { FavorDef } from '@game/shared';
import { clamp, thresholdFor } from './thresholds.js';

/**
 * 好感变更机制（设计 §4.6；FR-NPCR-02；12 任务 3）。
 *
 * 纯函数：`favor` 指令的唯一算径——数值先 clamp 到 FavorDef{min,max}，再按
 * 阶段阈值表（stages，内部二分）定位新阶段；返回 from/to/changed 供指令层
 * 决定是否 emit `favor_stage_changed`。引擎不解释「阶段」语义（id/nameKey 由
 * 游戏数据定义，中立性红线）。
 */

/** 变更前的关系切片（NpcState 的最小子集，便于纯函数测试） */
export interface NpcRelationSlice {
  readonly favor: number;
  /** 当前阶段 id（缺席 = 未达任何阶段） */
  readonly stage?: string | undefined;
}

/** 好感变更结果（无副作用；调用方负责写回 record 与发事件） */
export interface FavorChange {
  /** clamp 后的新好感值 */
  readonly favor: number;
  /** 新阶段 id（无阶段表时保持原 stage；跌出全部阶段为 undefined） */
  readonly stage: string | undefined;
  readonly from: string | undefined;
  readonly to: string | undefined;
  /** 阶段是否切换（true 才需要 emit FavorStageChanged） */
  readonly changed: boolean;
}

/**
 * 计算好感变更（clamp → 阶段二分）。
 *
 * - 缺省 favor 定义（NPC 无好感系统）→ 不 clamp、阶段保持；
 * - 阶段表为空 → clamp 仍生效，阶段保持（无阶段可切）；
 * - 负方向跌出全部阶段 → to=undefined（事件可表达「关系归零」）。
 */
export function applyFavorChange(
  favorDef: FavorDef | undefined,
  current: NpcRelationSlice,
  amount: number,
): FavorChange {
  const favor =
    favorDef !== undefined
      ? clamp(current.favor + amount, favorDef.min, favorDef.max)
      : current.favor + amount;
  const from = current.stage;
  const stages = favorDef?.stages;
  const to = stages !== undefined && stages.length > 0 ? thresholdFor(stages, favor)?.id : from;
  return { favor, stage: to, from, to, changed: to !== from };
}
