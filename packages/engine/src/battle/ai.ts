import type { Rng } from '@game/shared';
import { EngineError } from '@game/shared';
import type { AiActionSpec, BattleUnit } from './types.js';

/**
 * AI 策略（detail-design §5.2，16 号 W4 子任务 6；FR-CMBT-09）。
 *
 * 内置两策略（与 shared/schema/battle.ts 的 AiPolicyDef 数据面同构）：
 * - `weighted`：候选按 `when` 过滤 → `rng.weighted` 按权抽取（DD-09，与行动序/
 *   逃跑同源可回放）；
 * - `scripted`：表达式序列取**首个** `when` 满足者（求值短路）；全不满足 =
 *   EFFECT_FAILED 显性化——作者以「末条省略 when」表达兜底（数据错误不静默）。
 *
 * **决策只用会话内状态**（§5.2 无隐藏信息）：本模块不 import 叙事（DD-11）、
 * 不读 GameState——条件求值经工厂注入的回调（编译缓存归装配层，AI 层只消费
 * 布尔），状态可见性由装配层决定。
 *
 * 条件求值失败（EXPR_COMPILE/EVAL_ERROR）照常上抛（DD-01 运行期严格），不做
 * 静默回退——AI 数据写错表达式应在调试期显性化。
 */

/** AI 解析器注入面（session 的 `aiResolve` 缝由此工厂装配） */
export interface AiResolverOptions {
  /** 随机源（与会话同实例——行动序/逃跑/AI 决策同一序列，DD-09 回放一致） */
  readonly rng: Rng;
  /** 条件求值回调（when 表达式 → 布尔；求值错误原样上抛，不静默） */
  readonly evalCondition: (expr: string) => boolean;
}

/** 过滤后的加权候选（喂给 shared rng.weighted 的形状） */
interface WeightedCandidate {
  readonly item: AiActionSpec;
  readonly weight: number;
}

/** session.aiResolve 缝的签名（types.ts 冻结面） */
export type AiResolveFn = (unit: BattleUnit) => AiActionSpec;

/** AI 决策失败（EFFECT_FAILED：候选被过滤空/剧本全不满足——数据语义错误显性化） */
function aiError(unit: BattleUnit, detail: string): EngineError {
  return new EngineError({
    code: 'EFFECT_FAILED',
    where: { op: 'battle.ai', unit: unit.uid, detail },
    messageKey: 'error.effects.instructionFailed',
  });
}

export function createAiResolver(options: AiResolverOptions): AiResolveFn {
  const { rng, evalCondition } = options;
  return (unit: BattleUnit): AiActionSpec => {
    const policy = unit.ai;
    if (policy === undefined) {
      // 数据面兜底（enemyDefSchema.ai 可选）：无声明 = 全技能均权加权。
      // 技能引用自 unit.skills（W1 校验面保证非空；防御性再兜一层）。
      const first = unit.skills[0];
      if (first === undefined) throw aiError(unit, '无 AI 策略且无可用技能');
      return { kind: 'skill', skillId: first.id };
    }
    switch (policy.kind) {
      case 'weighted': {
        const candidates: WeightedCandidate[] = [];
        for (const entry of policy.entries) {
          if (entry.when !== undefined && !evalCondition(entry.when)) continue;
          candidates.push({ item: entry.action, weight: entry.weight });
        }
        if (candidates.length === 0) {
          throw aiError(unit, 'weighted 候选被 when 全部过滤');
        }
        return rng.weighted(
          candidates.map((candidate) => ({ item: candidate.item, weight: candidate.weight })),
        );
      }
      case 'scripted': {
        for (const entry of policy.sequence) {
          if (entry.when === undefined || evalCondition(entry.when)) return entry.action;
        }
        throw aiError(unit, 'scripted 序列全部 when 不满足（兜底请省略末条 when）');
      }
    }
  };
}
