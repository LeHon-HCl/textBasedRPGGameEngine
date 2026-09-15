import type { EffectRegistry } from '../effects/index.js';
import type { Diagnostic } from './types.js';
import type { EffectSite, PackageInventory } from './walk.js';
import type { EffectArgDiagnostic, EffectValidationContext } from '../effects/types.js';

/**
 * 效果指令参数语义校验（管线步骤 6.5；develop.md 约束 8 / 设计 §7.7
 * `invalid-instruction-arg`）。
 *
 * 职责：把「指令参数的**跨数据语义**」从运行期前移到加载期。结构校验（类型/必填）
 * 已由 02 号 `effectParamSchemas` 在 validate 步骤完成；本步骤跑的是各指令注册表
 * 声明的 `validateArg` 钩子——例如：
 * - `set` / `add` 的 key 形态（`attr.<id>` / `flag.<n>` / `counter.<n>` /
 *   `npc.<id>.flags.<n>`）——M1 收尾实测的 `set { key: 'npc.x.met' }` 即此类；
 * - `favor` / `reputation` 的目标实体是否存在；
 * - `give` / `take` / `wear` 的物品是否存在且类型匹配。
 *
 * 为什么必须在这一步：这些错误此前只在 `execute` 暴露，表现为「包加载零诊断通过、
 * 玩家点到该选项才炸」（见 `docs/retros/content-integrity-postmortem.md`）。
 *
 * 时序：在 scripts 步骤（6）之后、freeze（7）之前——注册表此时已含作者扩展指令
 * （`x.*`），校验面对完整指令集；未注册的指令 id 由 scripts 步骤单独报
 * `SCRIPT_CONTRACT`，本步骤跳过它们（避免重复诊断）。
 *
 * 位置信息：`where.phase = 'validateEffects'`、`where.from` = 数据路径（与 crossRef
 * 的定位口径一致，编辑器诊断列表可直接跳转）。
 */
export function validateEffectArgs(
  inventory: PackageInventory,
  registry: EffectRegistry,
): readonly Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const site of inventory.effects) {
    const def = registry.getDef(site.id);
    // 未注册指令（含 `x.*` 脚本指令缺失）由 scripts 步骤负责报错，此处跳过
    if (def === undefined || def.validateArg === undefined) continue;
    const ctx: EffectValidationContext = {
      npcs: undefined,
      items: undefined,
      quests: undefined,
      factions: undefined,
      endings: undefined,
      scenes: undefined,
    };
    // ErasedEffectDef 的 validateArg 泛型已擦除为 never（注册表分发面），
    // 此处传入的 arg 已通过 schema 校验，转型是安全的（与 registry.resolve 同规）。
    const validate = def.validateArg as (
      a: unknown,
      c: EffectValidationContext,
    ) => readonly EffectArgDiagnostic[];
    for (const argDiagnostic of safeValidate(validate, site.arg, ctx, site)) {
      out.push({
        severity: argDiagnostic.severity,
        // ErrCode 面用 SCHEMA_INVALID（参数违反该指令的参数契约）；
        // 规则 id（invalid-instruction-arg，设计 §7.7）放 where.rule——
        // 与 crossRef 把规则语义放 where 的口径一致。
        code: 'SCHEMA_INVALID',
        where: {
          phase: 'validateEffects',
          rule: argDiagnostic.code,
          from: site.dataPath,
          instruction: site.id,
          detail: argDiagnostic.detail,
        },
      });
    }
  }
  return out;
}

/**
 * 执行单条指令的 validateArg，把「钩子自身抛错」收敛为一条诊断。
 *
 * 为什么要兜底：`validateArg` 由各指令（以及未来的作者脚本）实现，若它自身有缺陷
 * （抛异常），不应让整个加载崩溃——收敛为 error 诊断即可（DD-01 严格语义：
 * 加载期错误显性化，但不以崩溃形式）。
 */
function safeValidate(
  validate: (arg: unknown, ctx: EffectValidationContext) => readonly EffectArgDiagnostic[],
  arg: unknown,
  ctx: EffectValidationContext,
  site: EffectSite,
): readonly EffectArgDiagnostic[] {
  try {
    return validate(arg, ctx);
  } catch (error) {
    return [
      {
        code: 'invalid-instruction-arg',
        severity: 'error',
        detail: `指令 '${site.id}' 的参数校验器抛错：${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    ];
  }
}
