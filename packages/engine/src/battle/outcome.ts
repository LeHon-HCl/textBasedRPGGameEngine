import type { EffectData, EncounterDef } from '@game/shared';
import type { BattleResult } from './types.js';

/**
 * 胜负路由数据面（detail-design §5.2 / FR-CMBT-11，16 号 W2 子任务 8）。
 *
 * 路由次序（victory 先奖励后分支——奖励是结算的一部分，on_victory 是叙事后果）：
 * - victory → `[...encounter.rewards, ...on_victory]`（rewards 为 child 事务，
 *   chance 掉落与表达式金额复用现有效果面——数据侧已由 02 号 battle 域承载）；
 * - defeat → `on_defeat`（战败≠终局，由游戏自定义战败场景，FR-CMBT-11）；
 * - escaped → `on_escape`。
 *
 * 纯数据装配：效果序列的**执行**归 battle 指令接线层（GameRuntime.exec
 * source='battle'，child 事务），会话不持运行时（DD-11）。
 */
export interface OutcomeBranches {
  onVictory?: readonly EffectData[];
  onDefeat?: readonly EffectData[];
  onEscape?: readonly EffectData[];
}

/** 终局 → 待执行效果序列（接线层按序 exec，一批 child 事务） */
export function buildOutcomeEffects(
  result: BattleResult,
  encounter: EncounterDef,
  branches: OutcomeBranches,
): readonly EffectData[] {
  switch (result.outcome) {
    case 'victory':
      return [...(encounter.rewards ?? []), ...(branches.onVictory ?? [])];
    case 'defeat':
      return [...(branches.onDefeat ?? [])];
    case 'escaped':
      return [...(branches.onEscape ?? [])];
  }
}
