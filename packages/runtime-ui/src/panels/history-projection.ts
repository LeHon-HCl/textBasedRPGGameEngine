import type { NarrativeHistoryEntry } from '@game/engine';

/**
 * 历史回看投影（FR-READ-04，25 号 B1）。
 *
 * 数据源 = `SceneRunner.history()`（环形 500 段，08 号交付）——本模块只做
 * **纯投影**：把引擎的渲染序历史条目转成 UI 渲染面（分组 + 文本已解析）。
 *
 * 分组口径：**按「场景 + 游戏日」分段**——同一场景同一天内的段落归一组，
 * 换场景或跨天即新组（与 FR-READ-04「按场景/时间分组」的呈现意图一致）。
 */

/** 历史分组（UI 渲染单元） */
export interface HistoryGroup {
  readonly sceneId: string;
  /** 组内首段的游戏日（分组标题的一部分） */
  readonly day: number;
  readonly entries: readonly HistoryEntryView[];
  /**
   * 回到本组所需的**回退步数**（= 检查点步数，1 起；additive，2026-09-26 修 #9b）。
   *
   * 为什么由宿主提供而非面板自算：面板此前用「分组距离」冒充步数
   * （`lastIndex - index`），而 `rollback(steps)` 的 steps 是**检查点步数**
   * ——分组边界是「换场景或跨天」，检查点边界是「每次选择」，两者不是同一个量
   * （实测 5 个检查点 vs 7 个分组：面板会给出「回退 6 步」而栈只有 5 步，
   * 点了必然 NO_CHECKPOINT）。步数只有宿主持有检查点账本才知道。
   *
   * **缺省 = 面板不渲染回退按钮**（宁可没有，也不给错按钮）：该组起点没有对应的
   * 检查点时（如当前所在组、或已超出回滚栈深）无法精确回到该处。
   */
  readonly rollbackSteps?: number;
}

/** 单条历史条目视图 */
export interface HistoryEntryView {
  readonly seq: number;
  /** 已解析的展示文本（宿主经 TextResolver 物化后传入） */
  readonly text: string;
  readonly day: number;
  readonly slotIndex: number;
}

/** 投影输入：引擎历史条目 + 文本物化函数（宿主注入 resolver） */
export type HistoryTextResolver = (key: string, vars?: Record<string, unknown>) => string;

/**
 * 投影历史条目为分组视图。
 *
 * @param entries `SceneRunner.history()` 快照（渲染序）
 * @param resolveText 文本键物化（缺省直接用键——测试与降级用）
 */
export function projectHistory(
  entries: readonly NarrativeHistoryEntry[],
  resolveText?: HistoryTextResolver,
): readonly HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  let current: { sceneId: string; day: number; entries: HistoryEntryView[] } | undefined;
  for (const entry of entries) {
    const view: HistoryEntryView = {
      seq: entry.seq,
      text: resolveSegmentText(entry, resolveText),
      day: entry.clock.day,
      slotIndex: entry.clock.slotIndex,
    };
    // 分组边界：换场景或跨天
    if (
      current === undefined ||
      current.sceneId !== entry.sceneId ||
      current.day !== entry.clock.day
    ) {
      current = { sceneId: entry.sceneId, day: entry.clock.day, entries: [] };
      groups.push(current);
    }
    current.entries.push(view);
  }
  return groups;
}

/** 段落文本物化：文本段落走 resolver；媒体/其他段落给占位描述（不吞条目） */
function resolveSegmentText(
  entry: NarrativeHistoryEntry,
  resolveText: HistoryTextResolver | undefined,
): string {
  const segment = entry.segment as { kind?: string; key?: string; vars?: Record<string, unknown> };
  if (typeof segment.key === 'string') {
    return resolveText !== undefined ? resolveText(segment.key, segment.vars) : segment.key;
  }
  // 非文本段落（媒体/通知等）：给可读占位而非丢弃（历史完整性）
  return segment.kind !== undefined ? `[${segment.kind}]` : '';
}
