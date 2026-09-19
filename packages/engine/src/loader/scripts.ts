import { EngineError } from '@game/shared';
import type { ExprFunctionDef } from '@game/shared';
import { createBuiltinEffectRegistry } from '../effects/index.js';
import type {
  CheckRule,
  CheckRuleResolver,
  EffectRegistry,
  EffectRegistryOptions,
} from '../effects/index.js';
import { createBuiltinCheckResolver } from '../checks/index.js';
import { createBuiltinFunctionRegistry } from '../expr-eval/index.js';
import type { LoadGameOptions, PackageDomains } from './types.js';
import type { PackageInventory } from './walk.js';

/**
 * 管线步骤 6 scripts（设计 §3.4「宿主注入 ScriptModule[] → 注册 → 注册表
 * 冻结」，§5.9 注册时序、FR-SCR-04 契约校验、DD-08 命名空间）。
 *
 * - 效果注册表由游戏包目录投影构造（§1.3 显式注入：items/npcs/factions/
 *   quests/bodyDefs），内置 25 指令在构造期装配（05 号）；
 * - 表达式函数注册表以内置 20 函数为基座（03 号），脚本经
 *   setup(api.registerFunction) 追加（name 必须 `x.<script>.<name>`，DD-08，
 *   违例 → SCRIPT_CONTRACT）；步骤 6 结束后整体冻结为最终注册表；
 * - ScriptModule.setup 逐模块执行：registerEffect 转发注册表（命名空间与
 *   DUP_ID 由 05 号注册表裁决）；registerCheckRule 收录脚本判定规则
 *   （§5.1），合成「脚本规则 → 宿主解析器 → 内置 coc/generic 兜底」解析链并
 *   注入效果注册表（15 号）；
 * - 步骤末尾完成 x.* 悬空校验（FR-SCR-04）：
 *   ① call 指令的 `x.*` fn 必须已注册（缺失 → SCRIPT_CONTRACT）；
 *   ② 表达式引用的 `x.*` 函数必须已注册（缺失 → SCRIPT_CONTRACT）；
 *   ③ 非纯 x.* 函数出现在缓存敏感位置（事件 require）→ EXPR_COMPILE
 *     （DD-01，纯度核对在函数注册完成后进行）；
 * - 校验通过后 EffectRegistry.freeze()——注册窗口关闭，此后 register 一律
 *   报 SCRIPT_CONTRACT（05 号注册表冻结语义，§3.4 步骤 6 完成的分界）。
 */

/** 作者脚本函数/指令的命名空间形态（DD-08），与 05 号注册表约束一致 */
const X_NAMESPACE_PATTERN = /^x\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** scripts 步骤输入（管线中由步骤 5 产物与加载选项装配） */
export interface ScriptStepInput {
  readonly domains: PackageDomains;
  /** compile 期延迟登记的 x.* 函数引用（DeferredXFunctionRegistry.referenced()） */
  readonly deferredXRefs: readonly { name: string; requirePure: boolean }[];
  readonly inventory: PackageInventory;
  readonly options: LoadGameOptions;
}

/**
 * scripts 步骤产物（设计 §3.4 步骤 6；06 号）。
 *
 * 宿主注入的作者脚本模块在此完成注册与 `x.*` 调用存在性/纯度核对（FR-SCR-04），
 * 随后注册表冻结交由 freeze 步骤组装进 `GameDefinition`。安全不变式：
 * 运行期不解释源码——脚本只在加载期执行注册（NFR-19/20，FR-SCR-06）。
 */
export interface ScriptStepResult {
  /** 冻结后的效果注册表（GameRuntime 的 effectExecutor 注入面） */
  readonly effectRegistry: EffectRegistry;
  /** 冻结后的最终表达式函数注册表（内置 20 函数 + 脚本 x.* 扩展） */
  readonly functionRegistry: ReadonlyMap<string, ExprFunctionDef>;
  /**
   * 判定规则解析链（15 号）：脚本规则 → 宿主解析器 → 内置 coc/generic 兜底。
   * 同一实例已注入效果注册表（check 指令的运行期解析面）——脚本规则在 setup
   * 期间注册，而 check 只在运行期 resolve，故以「可变 Map + 稳定引用」承接，
   * 无需注册表重建。
   */
  readonly checkResolver: CheckRuleResolver;
}

/** scripts 步骤入口（管线步骤 6）：注册 → x.* 悬空校验 → 冻结 */
export function runScriptStep(input: ScriptStepInput): ScriptStepResult {
  const { domains, deferredXRefs, inventory, options } = input;

  // 表达式函数注册表：内置为基座，脚本函数在 setup 期间追加（同一 Map 实例
  // 交予效果注册表，步骤末冻结——运行期经同一实例编译参数表达式）
  const functionRegistry = new Map<string, ExprFunctionDef>(createBuiltinFunctionRegistry());
  const scriptRules = new Map<string, CheckRule>();

  // 判定解析链（15 号）：脚本规则（setup 期间写入 scriptRules）→ 宿主解析器 →
  // 内置 coc/generic 兜底。合成实例先于注册表构造交付（check 指令在构造期捕获
  // options.checkResolver 引用），运行期经同一引用读到 setup 后期注册的脚本规则。
  const builtinResolver = createBuiltinCheckResolver();
  const hostResolver = options.checkResolver;
  const checkResolver: CheckRuleResolver = {
    resolve(ruleId: string) {
      return scriptRules.get(ruleId) ?? hostResolver?.resolve(ruleId) ?? builtinResolver.resolve(ruleId);
    },
  };

  const registryOptions: EffectRegistryOptions = {
    functionRegistry,
    items: domains.items,
    npcs: domains.npcs,
    factions: domains.factions,
    quests: domains.quests,
    bodyDefs: domains.body,
    checkResolver,
  };
  const effectRegistry = createBuiltinEffectRegistry(registryOptions);

  const api = {
    registerEffect: (def: Parameters<typeof effectRegistry.register>[0]): void => {
      effectRegistry.register(def);
    },
    registerFunction: (def: ExprFunctionDef): void => {
      if (!X_NAMESPACE_PATTERN.test(def.name)) {
        throw new EngineError({
          code: 'SCRIPT_CONTRACT',
          where: { fn: def.name, detail: "脚本函数名必须为 'x.<script>.<name>'（DD-08）" },
          messageKey: 'error.loader.scriptNamespace',
        });
      }
      if (functionRegistry.has(def.name)) {
        throw new EngineError({
          code: 'DUP_ID',
          where: { fn: def.name, detail: '脚本函数重复注册' },
          messageKey: 'error.loader.dupFunction',
        });
      }
      functionRegistry.set(def.name, def);
    },
    registerCheckRule: (rule: CheckRule): void => {
      if (scriptRules.has(rule.id)) {
        throw new EngineError({
          code: 'DUP_ID',
          where: { rule: rule.id, detail: '脚本判定规则重复注册' },
          messageKey: 'error.loader.dupCheckRule',
        });
      }
      scriptRules.set(rule.id, rule);
    },
  };

  for (const module of options.scripts ?? []) {
    module.setup(api);
  }

  // —— x.* 悬空校验（FR-SCR-04，注册完成后执行） ——
  const contractError = firstXContractError(
    inventory.calls,
    deferredXRefs,
    effectRegistry,
    functionRegistry,
  );
  if (contractError !== undefined) throw contractError;

  // —— 注册表冻结（§3.4 步骤 6 完成的分界） ——
  effectRegistry.freeze();

  return { effectRegistry, functionRegistry, checkResolver };
}

/** x.* 引用核对的首个违约（call 指令与表达式函数的存在性、缓存位置纯度） */
function firstXContractError(
  calls: PackageInventory['calls'],
  deferredXRefs: readonly { name: string; requirePure: boolean }[],
  effectRegistry: EffectRegistry,
  functionRegistry: ReadonlyMap<string, ExprFunctionDef>,
): EngineError | undefined {
  // ① call 指令：fn 'x.*' 必须已注册（非 x.* 命名空间由 call 指令执行期报错）
  for (const call of calls) {
    if (!call.fn.startsWith('x.')) continue;
    if (effectRegistry.lookup(call.fn) === undefined) {
      return new EngineError({
        code: 'SCRIPT_CONTRACT',
        where: {
          kind: 'call',
          fn: call.fn,
          from: call.dataPath,
          phase: 'scripts',
          detail: `call 指令引用的脚本指令 '${call.fn}' 未注册（FR-SCR-04）`,
        },
        messageKey: 'error.loader.danglingScriptCall',
      });
    }
  }
  // ②③ 表达式函数：compile 期登记的 x.* 引用逐一核对
  for (const ref of deferredXRefs) {
    const def = functionRegistry.get(ref.name);
    if (def === undefined) {
      return new EngineError({
        code: 'SCRIPT_CONTRACT',
        where: {
          kind: 'function',
          fn: ref.name,
          phase: 'scripts',
          detail: `表达式引用的脚本函数 '${ref.name}' 未注册（FR-SCR-04）`,
        },
        messageKey: 'error.loader.danglingScriptFunction',
      });
    }
    if (ref.requirePure && !def.pure) {
      return new EngineError({
        code: 'EXPR_COMPILE',
        where: {
          fn: ref.name,
          phase: 'scripts',
          detail: `非纯脚本函数 '${ref.name}' 出现在缓存敏感位置（事件 require，DD-01）`,
        },
        messageKey: 'error.loader.impureScriptFunctionInRequire',
      });
    }
  }
  return undefined;
}
