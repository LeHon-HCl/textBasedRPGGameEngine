import type { EffectData, Rng } from '@game/shared';
import type {
  DamageFn,
  DamageInput,
  BattleUnit,
  PlayerAction,
  AiActionSpec,
  SkillRef,
} from './types.js';
import { selectTarget } from './targeting.js';
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
 * - 技能附加效果（W2 裁定，PR #28 review P1 闭环）= 注入的 `applyEffects` 缝：
 *   执行 SkillRef.effects 声明的战斗子集指令（治疗/状态/增益），会话与执行器
 *   不持 GameRuntime（DD-11）；缺省未注入且声明了 effects → 日志显性化。
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
  /**
   * 技能附加效果缝：执行 SkillRef.effects 的战斗子集指令。由 battle 指令
   * 接线层装配（runtime.exec source='battle' 实现）。
   */
  applyEffects?: (
    effects: readonly EffectData[],
    actor: BattleUnit,
    ectx: ActionExecutionContext,
  ) => void;
}

/** 技能倍率：SkillRef.params.mult 缺省 1 */
function skillMult(actor: BattleUnit, skillId: string): number {
  const skill = actor.skills.find((entry) => entry.id === skillId);
  const mult = skill?.params?.['mult'];
  return typeof mult === 'number' ? mult : 1;
}

/** 附加效果执行出口：有缝执行；无缝声明 → 显性化日志（W2 裁定口径） */
function applyAttached(
  options: ResolutionOptions,
  skill: SkillRef | undefined,
  ectx: ActionExecutionContext,
  outcome: ActionOutcome,
): ActionOutcome {
  const effects = skill?.effects;
  if (effects === undefined || effects.length === 0) return outcome;
  if (options.applyEffects === undefined) {
    return {
      ...outcome,
      log: [
        ...(outcome.log ?? []),
        {
          key: 'battle.log.effects_unwired',
          vars: { actor: ectx.actor.nameKey, skill: skill?.id ?? '' },
        },
      ],
    };
  }
  options.applyEffects(effects, ectx.actor, ectx);
  return outcome;
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
      // 物品的附加效果面（治疗药剂等）由数据侧另行扩展；本层处理技能声明面
      return {
        log: [{ key: 'battle.log.item', vars: { actor: ectx.actor.nameKey, item: action.itemId } }],
      };
    }
    // —— attack 技能：经 DamageFn 结算（目标面板 + 防御态 + rng 浮动） ——
    // 目标解析（W6 targeting 回退，B 方接线走本 PR review）：数据面显式
    // targetUid 优先；缺省回退对立面首个存活者（FR-CMBT-12 单敌方显然正确，
    // 多敌方由作者显式指定或后续细化）。回退仍 null（无对立面存活）→ 自身
    // 增益面（附加效果仍经 applyAttached 执行；攻击类应显式声明 targetUid）。
    const target =
      action.targetUid !== undefined
        ? ectx.units.get(action.targetUid)
        : (selectTarget(ectx.actor.uid, { units: [...ectx.units.values()] }) ?? undefined);
    if (target === undefined) {
      // 无目标技能：附加效果（自身增益）仍执行；无伤害
      const skill = ectx.actor.skills.find((entry) => entry.id === action.skillId);
      return applyAttached(options, skill, ectx, {
        log: [
          {
            key: 'battle.log.skill_nontarget',
            vars: { actor: ectx.actor.nameKey, skill: action.skillId },
          },
        ],
      });
    }
    const input: DamageInput = {
      attacker: ectx.actor.attrs,
      defender: target.attrs,
      mult: skillMult(ectx.actor, action.skillId),
      ...(target.defending ? { defending: true } : {}),
    };
    const result = options.damageFn(input, ectx.rng);
    const skill = ectx.actor.skills.find((entry) => entry.id === action.skillId);
    return applyAttached(options, skill, ectx, {
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
    });
  };
}
