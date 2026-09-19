import type { Rng } from '@game/shared';
import type { BattleUnit } from './types.js';

/**
 * 行动序计算（detail-design §5.2，16 号 W1；FR-CMBT-08「速度决定行动序」）。
 *
 * - **纯函数**：不读会话状态、随机只经注入 Rng（DD-09 确定性可复现）；
 * - 规则：按 `attrs.spd` 降序分组，同速组内 Fisher–Yates 洗牌（平局 Rng 决定，
 *   §5.2 turnQueue 契约）；已倒下单位不参与本回合；
 * - spd 缺省按 0 处理（数据未声明速度的单位垫底，组内仍洗牌）。
 */
export function computeTurnOrder(units: readonly BattleUnit[], rng: Rng): string[] {
  const alive = units.filter((unit) => unit.hp > 0);
  const bySpd = new Map<number, BattleUnit[]>();
  for (const unit of alive) {
    const spd = unit.attrs['spd'] ?? 0;
    const group = bySpd.get(spd) ?? [];
    group.push(unit);
    bySpd.set(spd, group);
  }
  const order: string[] = [];
  for (const spd of [...bySpd.keys()].sort((a, b) => b - a)) {
    const group = [...(bySpd.get(spd) as BattleUnit[])];
    // 平局组 Fisher–Yates 洗牌：j = int(0, i)，随机只经注入 Rng（DD-09）
    for (let i = group.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [group[i], group[j]] = [group[j] as BattleUnit, group[i] as BattleUnit];
    }
    order.push(...group.map((unit) => unit.uid));
  }
  return order;
}
