import type { BattleLogEntry, BattlePhase } from './types.js';

/**
 * 战斗日志回看投影（detail-design §5.2，16 号 W5 子任务 9；FR-CMBT-10）。
 *
 * BattleLogEntry 的类型与存储面在 W0（types.ts / session 内部缓冲）已落，
 * 本模块补**回看投影**：按相位分组——UI 回看（25B 战斗面板）按阶段折叠展示
 * （开场 / 行动 / 收敛 / 终局），组序 = 相位**首次出现序**（不是枚举序：
 * round_end 可能在多轮回合中反复出现，投影按叙事顺序而非枚举顺序归组）。
 * 纯函数、确定性（不消耗随机——DD-09 面上无随机）。
 */

/** 按相位分组的回看视图（组内保持原始条目序） */
export interface BattleLogView {
  readonly phase: BattlePhase;
  readonly entries: readonly BattleLogEntry[];
}

export function projectBattleLog(log: readonly BattleLogEntry[]): readonly BattleLogView[] {
  const groups: BattleLogView[] = [];
  const indexOf = new Map<BattlePhase, number>();
  for (const entry of log) {
    let index = indexOf.get(entry.phase);
    if (index === undefined) {
      index = groups.length;
      indexOf.set(entry.phase, index);
      groups.push({ phase: entry.phase, entries: [] });
    }
    groups[index]!.entries.push(entry);
  }
  return groups;
}
