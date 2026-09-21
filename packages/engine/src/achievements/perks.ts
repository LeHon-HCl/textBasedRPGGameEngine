import type { EffectData, GameId, PerkDef, Profile } from '@game/shared';
import { EngineError } from '@game/shared';
import type { GameRuntime } from '../runtime/index.js';
import type { PerkPurchaseOutcome } from './types.js';
import { chargePerk, compensatePerk, validatePerkPurchase } from './profile.js';
import type { ProfileStore } from './types.js';

/**
 * Perk 效果应用（detail-design §5.4，18 号 B 线；FR-ACHV-06，OQ-06 裁定）。
 *
 * **两步协议（§6.2）**：
 * 1. `chargePerk`：ProfileStore 扣点 + 记录已购；
 * 2. bootstrap：新档创建后，PerkDef.effects 经效果指令在新档事务中执行一次
 *    （属性/物品/flag/解锁内容复用 §3.3 指令）。
 *
 * 失败序处理（本文件 {@link purchasePerk}）：
 * - 第一步被拒（点数不足等）→ 直接返回结果，不建档；
 * - 第二步抛错 → **补偿回加**（`compensatePerk`）+ 向上冒泡错误
 *   （扣点不能成为悬空账；补偿本身幂等）。
 *
 * OQ-06（Perk 生效时机）：**仅新档开局**——本文件的 applyPerkEffects 只应在
 * 新档 bootstrap 事务中调用（语义最清晰；周目内效果由游戏用效果指令自行实现）。
 */

/**
 * 在新档事务中执行 Perk 效果（bootstrap 的第二步）。
 *
 * @returns 实际执行的效果条数（0 = 无已购 Perk 或无 effects）
 * @throws EngineError：Perk 目录缺项（数据完整性问题，显性化）
 */
export function applyPerkEffects(
  runtime: GameRuntime,
  profile: Profile,
  perks: ReadonlyMap<GameId, PerkDef>,
): readonly EffectData[] {
  const effects: EffectData[] = [];
  for (const entry of profile.purchasedPerks) {
    const perk = perks.get(entry.id);
    if (perk === undefined) {
      throw new EngineError({
        code: 'DANGLING_REF',
        where: {
          op: 'perk',
          perk: entry.id,
          detail: `Profile 记录的已购 Perk '${entry.id}' 不在目录中（游戏包更新后删除或改名）`,
        },
        messageKey: 'error.loader.danglingRef',
      });
    }
    effects.push(...perk.effects);
  }
  return effects;
}

/** 把已购 Perk 的效果应用到新档（一步到位的便捷入口：applyPerkEffects + exec） */
export function bootstrapPerks(
  runtime: GameRuntime,
  profile: Profile,
  perks: ReadonlyMap<GameId, PerkDef>,
  rng: import('@game/shared').Rng,
): void {
  const effects = applyPerkEffects(runtime, profile, perks);
  if (effects.length === 0) return;
  runtime.exec(effects, {
    source: 'hook',
    where: { pipeline: 'bootstrap' },
    rng,
  });
}

/**
 * Perk 购买完整流程（两步协议 + 失败序补偿）。
 *
 * @param bootstrap 第二步的实际执行（宿主提供——例如创建新档 + 应用 Perk 效果）；
 *   抛错时触发补偿
 */
export async function purchasePerk(options: {
  store: ProfileStore;
  perk: PerkDef;
  now: number;
  bootstrap: (profile: Profile) => Promise<void> | void;
}): Promise<PerkPurchaseOutcome> {
  const { store, perk, now, bootstrap } = options;
  // 预检（避免无谓的 mutate；真实校验仍在 chargePerk 内做——并发安全）
  const snapshot = await store.load();
  const precheck = validatePerkPurchase(snapshot, perk);
  if (precheck !== null) {
    return { perkId: perk.id, charged: false, bootstrapped: false, rejection: precheck };
  }
  const chargeResult = await chargePerk(store, perk, now);
  if (chargeResult !== 'ok') {
    return { perkId: perk.id, charged: false, bootstrapped: false, rejection: chargeResult };
  }
  try {
    const charged = await store.load();
    await bootstrap(charged);
    return { perkId: perk.id, charged: true, bootstrapped: true };
  } catch (error) {
    // 失败序：补偿回加（幂等），再向上冒泡原始错误
    await compensatePerk(store, perk);
    throw error;
  }
}
