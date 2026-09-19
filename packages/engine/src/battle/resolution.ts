import type { Rng } from '@game/shared';
import type { DamageFn, DamageInput, BattleUnit, PlayerAction, AiActionSpec } from './types.js';
import type { ActionOutcome } from './session.js';

/**
 * 行动结算执行器（detail-design §5.2 结算管线，16 号 W2 子任务 4）。
 *
 * **装配关系**（分工见 plans/M2-stage2-battle-split.md）：
 * - 本文件是 W0 `executeAction` 缝的 **A 线实现**：把「这一手」翻译成
 *   ActionOutcome（伤害/日志），由会话统一入账 HP 并判倒下；
 * - 伤害公式 = 注入的 {@link DamageFn}（**B 线 W4 damage.ts 提供实现**，
 *   默认 `atk*mult − def`；本文件不硬编码公式，只负责构造 DamageInput——
 *   含守方面板与 defending 态传递，随机只经 ectx.rng，DD-09）；
 * - 物品消耗 = 注入的 `consumeItem` 缝（绑定 GameState 背包的适配层在
 *   battle 指令接线时装配）；消耗语义显性化：结算前先扣；
 * - 技能附加效果（治疗/状态等战斗子集）的 EffectContext 复用口径待与
 *   B 方对齐后接入（登记 tasks/16-battle.md，W2 后续 commit）。
 */

/** 会话交付给执行器的行动上下文 */
export interface ActionExecutionContext {
  actor: BattleUnit;
  /** 会话单位表（只读快照语义；目标面板/防御态从这里取） */
  units: ReadonlyMap<string, BattleUnit>;
  /** 本次行动的随机源（伤害浮动等；与行动序/逃跑同源，DD-09） */
  rng: Rng;
}

export interface ResolutionOptions {
  /** 伤害公式（B 线 W4；测试可注入桩） */
  damageFn: DamageFn;
  /** 物品消耗缝（可选；缺省 = 只记日志不扣包，适配层装配前显性化） */
  consumeItem?: (itemId: string) => void;
}

/** 技能倍率：SkillRef.params.mult 缺省 1 */
function skillMult(actor: BattleUnit, skillId: string): number {
  const skill = actor.skills.find((entry) => entry.id === skillId);
  const mult = skill?.params?.['mult'];
  return typeof mult === 'number' ? mult : 1;
}

/**
 * 创建结算执行器（每个 BattleSession 装配一个）。
 * 校验（技能持有/目标合法性）已由 W1 validateAction 在会话侧完成，
 * 本执行器假设行动合法——防御性兜底只记日志不抛错。
 */
export function createEffectExecutor(
  options: ResolutionOptions,
): (action: PlayerAction | AiActionSpec, ectx: ActionExecutionContext) => ActionOutcome {
  return (action, ectx) => {
    if (action.kind === 'defend') {
      // defend 由会话内置（W1 置位 defending），执行器只补结算日志
      return { log: [{ key: 'battle.log.defend', vars: { actor: ectx.actor.nameKey } }] };
    }
    if (action.kind === 'flee') {
      // flee 由会话直接裁决（W0），正常装配下不会到达；防御性空结算
      return {};
    }
    if (action.kind === 'item') {
      options.consumeItem?.(action.itemId);
      return {
        log: [{ key: 'battle.log.item', vars: { actor: ectx.actor.nameKey, item: action.itemId } }],
      };
    }
    // —— attack 技能：经 DamageFn 结算（目标面板 + 防御态 + rng 浮动） ——
    const targetUid = action.targetUid;
    const target = targetUid !== undefined ? ectx.units.get(targetUid) : undefined;
    if (target === undefined) {
      // 无目标技能（自身增益面待接）：只记日志，无伤害
      return {
        log: [
          {
            key: 'battle.log.skill_nontarget',
            vars: { actor: ectx.actor.nameKey, skill: action.skillId },
          },
        ],
      };
    }
    const input: DamageInput = {
      attacker: ectx.actor.attrs,
      defender: target.attrs,
      mult: skillMult(ectx.actor, action.skillId),
      ...(target.defending ? { defending: true } : {}),
    };
    const result = options.damageFn(input, ectx.rng);
    return {
      ...(result.amount > 0 ? { damage: [{ uid: target.uid, amount: result.amount }] } : {}),
      log: [
        {
          key: 'battle.log.skill',
          vars: {
            actor: ectx.actor.nameKey,
            skill: action.skillId,
            target: target.nameKey,
            amount: result.amount,
          },
        },
      ],
    };
  };
}
