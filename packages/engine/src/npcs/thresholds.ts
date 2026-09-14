/**
 * 阈值表二分与区间收敛（设计 §4.6；12 任务 3/6）。
 *
 * 引擎中立机制：只按「at ≤ value 取最后一档」定位档位，不解释阶段/波段语义
 * （id/nameKey 均为游戏数据）。好感阶段与阵营声望共用同一实现，保证单一算径。
 */

/** 阈值表条目最小形状（FavorStage / FactionThreshold 的公共切片） */
export interface ThresholdEntry {
  readonly id: string;
  readonly at: number;
}

/**
 * 阈值表二分定位（§4.6「阈值表二分」）：返回 `at ≤ value` 的最后一档；
 * 不依赖声明顺序（内部按 at 升序排序后二分，不改动入参数组），
 * 低于全部阈值或空表 → undefined。
 */
export function thresholdFor<T extends ThresholdEntry>(
  thresholds: readonly T[],
  value: number,
): T | undefined {
  const sorted = [...thresholds].sort((a, b) => a.at - b.at);
  let low = 0;
  let high = sorted.length - 1;
  let hit = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((sorted[mid] as T).at <= value) {
      hit = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return hit >= 0 ? sorted[hit] : undefined;
}

/** 收敛到 [min, max]（clamp 语义，与内置函数 clamp() 同口径） */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
