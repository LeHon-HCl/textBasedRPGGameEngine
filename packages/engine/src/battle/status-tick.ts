import type { BattleLogEntry, BattleUnit } from './types.js';

/**
 * 战斗内状态 tick（detail-design §5.2，16 号 W5 子任务 7；FR-STAT-03 回合制时长）。
 *
 * **触发时机（裁定 2026-09-19，#28）**：挂「新回合开始」——session.beginTurn
 * 惰性重开队列处，每轮一次。StatusInstance.remaining 按回合递减（FR-STAT-03），
 * 逐行动 tick 会让高速单位双倍速衰减；round_end 相位仍是单次行动收敛点，
 * 本钩子在下一轮重算前触发（第一轮不 tick——初始状态完整持续一轮）。
 *
 * 语义（复用 shared StatusInstance）：
 * - `remaining` 递减 1/轮；归零 = 到期移除 + 到期日志（i18n 键 + 变量）；
 * - `remaining` 缺省 = 永久（不递减）；
 * - `stacks` 不因 tick 变化（叠层发生在再施加时，归 W2 应用面）；
 * - 处理序 = 单位/状态声明序（确定性，无随机——DD-09 面上不消耗序列）。
 *
 * **就地更新**：与会话的 hp/defending 入账同风格（session 持有单位表，tick 就地
 * 改 statuses）；返回到期日志（phase 由本函数盖章为 'turn_order'——触发时刻
 * 在新回合重算前，会话按当前相位入账）。到期日志键：`battle.log.status_expired`。
 */

const STATUS_EXPIRED_KEY = 'battle.log.status_expired';

export function tickStatuses(units: readonly BattleUnit[]): BattleLogEntry[] {
  const log: BattleLogEntry[] = [];
  for (const unit of units) {
    if (unit.statuses.length === 0) continue;
    const kept: BattleUnit['statuses'][number][] = [];
    for (const status of unit.statuses) {
      if (status.remaining === undefined) {
        kept.push(status); // 永久状态
        continue;
      }
      const remaining = status.remaining - 1;
      if (remaining <= 0) {
        log.push({
          key: STATUS_EXPIRED_KEY,
          vars: { target: unit.nameKey, status: status.id },
          phase: 'turn_order',
        });
        continue; // 到期移除
      }
      kept.push({ ...status, remaining });
    }
    unit.statuses = kept;
  }
  return log;
}
