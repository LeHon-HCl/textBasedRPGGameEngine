import { collectPackage } from './collect.js';
import { compilePackage } from './compile.js';
import { crossRefCheck, buildRefRegistries } from './cross-ref.js';
import { resolveLocationEntries } from './navigation.js';
import { validateEffectArgs } from './validate-effects.js';
import { throwIfErrors } from './diagnostics.js';
import { buildGameDefinition } from './freeze.js';
import { parsePackage } from './parse.js';
import { runScriptStep } from './scripts.js';
import { validatePackage } from './validate.js';
import { inventoryPackage } from './walk.js';
import type { GameDefinition, LoadGameOptions, PackageSource } from './types.js';

/**
 * 七步加载管线编排（设计 §3.4，顺序固定）：
 *
 * ```
 * 1 collect   —— PackageSource 列目录（scenes/ 按 DD-02 逐文件聚合）
 * 2 parse     —— YAML→对象（预编译静态包宿主此步退化为直读，§9.1）
 * 3 validate  —— 逐域 Zod + 重复 ID（SCHEMA_INVALID / DUP_ID）+ 语言包
 * 4 crossRef  —— refKind 元数据驱动的悬空引用检查（DANGLING_REF）
 * 5 compile   —— 表达式编译入缓存；事件池索引；refs 反查表；媒体目录
 * 6 scripts   —— 宿主注入 ScriptModule[] → 注册 → x.* 悬空校验 → 注册表冻结
 * 7 freeze    —— GameDefinition 全部字段深冻结（运行期不可变）
 * ```
 *
 * 错误语义（取「抛出」一种）：任一步骤产出 error 级诊断时在步骤边界抛出
 * 首个 EngineError（fail-fast，where 携带 file/from/expr 等精确定位，§2.2
 * 三元组）；warning 级诊断累积进入 {@link GameDefinition.diagnostics} 供
 * UI / 编辑器校验中心显示（DD-12，规则与编辑器同源）。
 *
 * 诊断在各步骤边界阻断，因此步骤 4-7 的函数输入保证「无 error 级诊断」。
 */

/**
 * 加载游戏包（设计 §3.4 加载入口）：三宿主（目录 / 静态包 / 编辑器内存）
 * 共用同一条管线，产出冻结的 GameDefinition。
 *
 * @throws EngineError 加载失败（error 级诊断，code ∈ SCHEMA_INVALID /
 *   DUP_ID / DANGLING_REF / EXPR_COMPILE / SCRIPT_CONTRACT 等，§2.2）。
 */
export async function loadGamePackage(
  source: PackageSource,
  options: LoadGameOptions = {},
): Promise<GameDefinition> {
  // 1 collect
  const collected = await collectPackage(source);
  throwIfErrors(collected.diagnostics);

  // 2 parse
  const parsed = await parsePackage(source, collected);
  throwIfErrors(parsed.diagnostics);

  // 3 validate
  const validated = validatePackage(parsed, { lang: options.lang });
  throwIfErrors(validated.diagnostics);

  // 4 crossRef
  const inventory = inventoryPackage(validated.domains);
  const registries = buildRefRegistries(validated.domains, collected.mediaIds, validated.locales);
  const crossRefDiagnostics = crossRefCheck(inventory, registries);
  throwIfErrors(crossRefDiagnostics);

  // 5 compile
  const compiled = await compilePackage(source, validated, inventory);
  throwIfErrors(compiled.diagnostics);

  // 6 scripts
  const scriptResult = runScriptStep({
    domains: validated.domains,
    deferredXRefs: compiled.artifacts.xFunctionRefs,
    inventory,
    options,
  });

  // 6.5 指令参数语义校验（develop.md 约束 8；设计 §7.7 invalid-instruction-arg）
  //   必须在 scripts 步骤之后：注册表此时已冻结（含作者扩展指令），校验面对完整指令集。
  const effectArgDiagnostics = validateEffectArgs(inventory, scriptResult.effectRegistry);
  throwIfErrors(effectArgDiagnostics);

  // 6.6 地点→入口场景导航解析（FR-XPLR-02；2026-09-15）
  //   放在 crossRef 之后（entryScene 的悬空引用已由 refKind 检查拦下）、freeze 之前；
  //   产出运行期只读映射（宿主 moveTo 查表，无运行期推断）。
  const navigation = resolveLocationEntries(validated.domains);
  throwIfErrors(navigation.diagnostics);

  // 7 freeze
  return buildGameDefinition({
    validated,
    artifacts: compiled.artifacts,
    scriptResult,
    locationEntries: navigation.entries,
    warnings: [
      ...validated.diagnostics,
      ...crossRefDiagnostics,
      ...effectArgDiagnostics,
      ...navigation.diagnostics,
    ],
  });
}
