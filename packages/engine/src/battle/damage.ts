import { EngineError } from '@game/shared';
import type { DamageFn, DamageInput, DamageResult } from './types.js';

/**
 * 伤害公式（detail-design §5.2，16 号 W4 子任务 5；FR-CMBT-08 结算面）。
 *
 * **可插拔预设**：与 CheckRule（15 号）同级的按名解析模式——
 * - 内置预设 `'default'`：`atk*mult − def`，下限 0（会话统一入账 HP 并判倒下，
 *   types.ts `DamageResult` 口径）。**确定性**：默认公式不消耗随机——表现层
 *   浮动（掷骰可视化，FR-CMBT-10）留作者预设经注入 Rng 实现（DD-09）；
 * - `DamagePresetResolver`：按名解析缝（W2 `ResolutionOptions.damageFn` 的
 *   装配源；测试可注入桩）。作者脚本注册覆盖的**接线**归 23 号（阶段六，
 *   FR-SCR-01），本模块只保证「可注册、可按名解析」的缝与保留名纪律。
 *
 * 纯函数约定：DamageFn 的随机只经第二参注入 Rng（types.ts 冻结签名），本文件
 * 无任何模块级可变状态。
 */

/**
 * 内置默认公式：`atk*mult − def`，下限 0；守方防御态（`input.defending`，
 * W1 置位 → W2 传递）= **最终伤害减半（向下取整）**——对作者最可预测的口径
 * （「防御 = 伤害减半」），且与 def 的乘法交互最小。types.ts 原注释「调用方
 * 折算进 def」随 W2 的旗标传递实现演进为本公式消费（宁加不改的 additive 演进，
 * 已在 #28 向 B 方说明——本实现即该说明的落地）。
 */
export function createDefaultDamageFn(): DamageFn {
  return (input: DamageInput): DamageResult => {
    const atk = input.attacker['atk'] ?? 0;
    const def = input.defender['def'] ?? 0;
    const raw = Math.max(0, atk * input.mult - def);
    const amount = input.defending === true ? Math.floor(raw / 2) : raw;
    return { amount };
  };
}

/** 伤害预设解析器（与 15 号 CheckRuleResolver 同型的按名缝） */
export interface DamagePresetResolver {
  /** 按名解析；未知预设返回 null（调用方显性化，本模块不猜） */
  resolve(name: string): DamageFn | null;
  /**
   * 注册预设：新名有效；重复名抛错——**不静默覆盖**（预设被悄悄换掉是调试
   * 黑洞）；`'default'` 为保留名（内置语义漂移会波及所有未显式选预设的战斗）。
   */
  register(name: string, fn: DamageFn): void;
}

/** 内置保留预设名（作者脚本不得覆盖） */
const DEFAULT_PRESET_NAME = 'default';

export function createDamagePresetResolver(): DamagePresetResolver {
  const presets = new Map<string, DamageFn>([[DEFAULT_PRESET_NAME, createDefaultDamageFn()]]);
  return {
    resolve(name: string): DamageFn | null {
      return presets.get(name) ?? null;
    },
    register(name: string, fn: DamageFn): void {
      if (presets.has(name)) {
        throw new EngineError({
          code: 'INTERNAL',
          where: { op: 'battle.damage', preset: name },
          messageKey: 'error.battle.damagePresetDuplicate',
        });
      }
      presets.set(name, fn);
    },
  };
}
