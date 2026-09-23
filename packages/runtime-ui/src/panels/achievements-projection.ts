import type { AchievementGalleryEntry, AchievementProgress } from '@game/engine';

/**
 * 成就图鉴投影（设计 §6.4 / FR-ACHV-04，25 号 C1）。
 *
 * 数据源 = 引擎 `AchievementEvaluator.gallery()`（18 号交付：隐藏占位 + 进度投影
 * + 收集率）+ 宿主 Profile（已解锁集合，DD-04）。本模块做**UI 面整理**：
 * 分组、排序、收集率摘要——不改判引擎的可见性规则（隐藏成就的存在性保护由
 * 引擎的 `gallery` 负责，此处不额外暴露）。
 */

/** 图鉴分组视图 */
export interface AchievementGalleryGroup {
  readonly group: string;
  readonly entries: readonly AchievementGalleryEntry[];
  /** 组内已解锁 / 总数 */
  readonly unlocked: number;
  readonly total: number;
}

/** 图鉴面板视图（UI 渲染单元） */
export interface AchievementGalleryView {
  readonly groups: readonly AchievementGalleryGroup[];
  /** 全量收集率（引擎 collectionRate 的输出） */
  readonly rate: { readonly unlocked: number; readonly total: number; readonly rate: number };
}

/** 未分组条目的归组键（缺省组） */
const UNGROUPED = 'general';

/**
 * 投影图鉴视图。
 *
 * 排序口径：
 * - 组按名称字典序（确定性）；
 * - 组内：已解锁在前（玩家先看到成就），未解锁按 id 稳定排序。
 */
export function projectAchievementGallery(
  entries: readonly AchievementGalleryEntry[],
  rate: { unlocked: number; total: number; rate: number },
): AchievementGalleryView {
  const byGroup = new Map<string, AchievementGalleryEntry[]>();
  for (const entry of entries) {
    const group = entry.group ?? UNGROUPED;
    const bucket = byGroup.get(group) ?? [];
    bucket.push(entry);
    byGroup.set(group, bucket);
  }
  const groups: AchievementGalleryGroup[] = [];
  for (const group of [...byGroup.keys()].sort()) {
    const bucket = [...(byGroup.get(group) as AchievementGalleryEntry[])].sort((a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
    groups.push({
      group,
      entries: bucket,
      unlocked: bucket.filter((entry) => entry.unlocked).length,
      total: bucket.length,
    });
  }
  return { groups, rate };
}

/** 进度条百分比（0–100 取整；无进度返回 null） */
export function progressPercent(progress: AchievementProgress | undefined): number | null {
  if (progress === undefined || progress.goal <= 0) return null;
  return Math.min(100, Math.round((progress.cur / progress.goal) * 100));
}
