import { EngineError } from '@game/shared';
import type { BattleUnit, PlayerAction } from './types.js';

/**
 * 玩家行动校验（detail-design §5.2 playerAction，16 号 W1 子任务 3）。
 *
 * - **合法性在消耗回合之前判定**：非法行动抛 EFFECT_FAILED，回合与相位不变化
 *   （会话 playerAction 集成本校验）；
 * - 行动的**结算**归 W2 executeAction 缝；本文件只回答「这一手能不能出」；
 * - 物品持有经注入缝检查（W2 绑定 GameState 背包；缺省拒绝一切 item 行动，
 *   显性化而非静默放行）。
 */

/** 校验上下文（注入缝；全部可选） */
export interface ActionValidationContext {
  /** 物品持有检查（FR-ITEM 背包投影；缺省 = item 行动一律拒绝） */
  hasItem?: (itemId: string) => boolean;
}

/** 目标合法性：存活且处于行动者的**对方阵营**（敌方行动者可打 player/ally，反之打 enemy） */
function targetValid(targetUid: string, actor: BattleUnit, units: readonly BattleUnit[]): boolean {
  const target = units.find((unit) => unit.uid === targetUid);
  if (target === undefined || target.hp <= 0) return false;
  const opposingSides: ReadonlyArray<BattleUnit['side']> =
    actor.side === 'enemy' ? ['player', 'ally'] : ['enemy'];
  return opposingSides.includes(target.side);
}

/**
 * 校验玩家/敌方行动。合法返回 undefined；非法返回拒绝原因（进 EFFECT_FAILED detail）。
 * AiActionSpec 与 PlayerAction 同形（无 flee），同一套规则适用（§5.2 AI 决策输出）。
 */
export function validateAction(
  action: PlayerAction,
  actor: BattleUnit,
  units: readonly BattleUnit[],
  ctx: ActionValidationContext = {},
): string | undefined {
  if (action.kind === 'defend' || action.kind === 'flee') return undefined;
  if (action.kind === 'skill') {
    if (!actor.skills.some((skill) => skill.id === action.skillId)) {
      return `单位 ${actor.uid} 未持有技能 '${action.skillId}'`;
    }
  }
  if (action.kind === 'item' && (ctx.hasItem === undefined || !ctx.hasItem(action.itemId))) {
    return ctx.hasItem === undefined
      ? `会话未注入物品持有检查缝，item 行动不可用（'${action.itemId}'）`
      : `单位 ${actor.uid} 不持有物品 '${action.itemId}'`;
  }
  if (action.targetUid !== undefined && !targetValid(action.targetUid, actor, units)) {
    return `目标 '${action.targetUid}' 不存在、已倒下或不在可攻击侧`;
  }
  return undefined;
}

/** 校验失败的显性化出口（会话相位不变化、回合不消耗） */
export function actionError(detail: string): EngineError {
  return new EngineError({
    code: 'EFFECT_FAILED',
    where: { op: 'battle', detail },
    messageKey: 'error.effects.instructionFailed',
  });
}
