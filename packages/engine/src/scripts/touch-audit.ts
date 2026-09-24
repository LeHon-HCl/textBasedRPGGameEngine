import type { TouchReport } from '../effects/index.js';
import type { ScriptModule } from './types.js';

/**
 * touchState 域校验（设计 §5.9 FR-SCR-05，23 号 C 线）。
 *
 * **问题**：脚本指令可以声明任意 `TouchReport`（迁移登记 / 调试监视 / 订阅触发
 * 三方复用该声明）。若脚本声明了一个**内置清单外的新存档域**（如 `x_custom.…`），
 * 该域不会进 schema、不会进迁移脚本，读档时静默丢失——发布后才暴露。
 *
 * **做法**（设计原文「加载器 warn + 发布向导阻断，提示补 schema/迁移登记」）：
 * - 本模块提供 `KNOWN_STATE_DOMAINS`（内置域清单的**权威来源**，从测试提升到
 *   引擎——此前它只存在于测试里，导致「清单与实现可能漂移」）+ 校验函数；
 * - 校验以**前缀匹配**为准：声明域必须等于清单项或以清单项为前缀（如
 *   `world.flags.quest_x` 由 `world.flags` 覆盖）；
 * - 严重级为 **warning**（不阻断加载——脚本可能有意为将来的迁移做预留），
 *   但发布向导（§7.9）据此阻断发布；26 号编辑器校验中心复用本函数。
 */

/**
 * 内置存档域清单（权威来源；与 §3.1 状态树一一对应）。
 * 维护约定：**新增状态域必须同时进本清单 + save schema + 迁移登记**，
 * 三者齐备才算完成（此前清单只在测试文件里，本模块将其提升为引擎产物）。
 */
export const KNOWN_STATE_DOMAINS: readonly string[] = Object.freeze([
  'player.attrs',
  'player.skills',
  'player.statuses',
  'player.body',
  'player.bodyProgress',
  'player.bodyTemp',
  'player.equip',
  'player.outfit',
  'player.outfitPresets',
  'player.wornMeta',
  'player.bag',
  'player.wallet',
  'player.derived',
  'world.time',
  'world.unlockedAreas',
  'world.flags',
  'world.counters',
  'world.eventCooldowns',
  'world.npcLocationCache',
  'world.shopStock',
  'world.shopRestock',
  'npcs',
  'factions',
  'quests',
  'seen.scenes',
  'seen.gallery',
  'seen.endings',
  'seen.codex',
  'readStats',
  'loop',
  'meta',
]);

/** 域校验结果（单条声明） */
export interface TouchDomainViolation {
  /** 违规的脚本模块 id */
  readonly scriptId: string;
  /** 违规的指令 id（如 `x.mymod.custom`） */
  readonly instructionId: string;
  /** 声明的未知域 */
  readonly domain: string;
  readonly detail: string;
}

/** 判断域声明是否落在内置清单内（精确匹配或前缀覆盖） */
export function isKnownDomain(domain: string): boolean {
  return KNOWN_STATE_DOMAINS.some(
    (known) => domain === known || domain.startsWith(`${known}.`),
  );
}

/**
 * 校验脚本注册的指令的 `touch` 声明（FR-SCR-05）。
 *
 * @param modules 脚本模块清单（用于归因 scriptId）
 * @param defs 各模块注册的指令（id + touch）——由 ScriptSetupApi 的 registerEffect
 *   收集面提供（宿主在加载期收集后传入）
 */
export function auditTouchDomains(
  modules: readonly ScriptModule[],
  defs: readonly {
    readonly scriptId: string;
    readonly id: string;
    readonly touch: TouchReport;
  }[],
): readonly TouchDomainViolation[] {
  const violations: TouchDomainViolation[] = [];
  for (const def of defs) {
    const declared = [...(def.touch.writes ?? []), ...(def.touch.reads ?? [])];
    for (const domain of declared) {
      // 读声明允许更宽松（读一个新的只读视图无害）；**写声明**必须在内置清单内
      if (def.touch.writes?.includes(domain) === true && !isKnownDomain(domain)) {
        violations.push({
          scriptId: def.scriptId,
          instructionId: def.id,
          domain,
          detail: `脚本指令 '${def.id}' 声明写入未知状态域 '${domain}'——该域不会进 schema/迁移脚本，读档时静默丢失；请在游戏包中登记该域（schema + 迁移）或改用已有域`,
        });
      }
    }
  }
  void modules; // 参数保留：将来可校验「模块未注册任何指令」等交叉约束
  return violations;
}
