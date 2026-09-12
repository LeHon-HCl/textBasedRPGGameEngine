import { EngineError } from '@game/shared';
import type {
  CompiledExpr,
  EvalContext,
  ExprFunctionRegistry,
  ExprSource,
  Lang,
  TextKey,
} from '@game/shared';
import { compileExpr, evalExpr } from '../expr-eval/index.js';
import type { LocalePack, LocaleRecord, LocaleValue } from '../loader/index.js';

/**
 * 文本解析与本地化运行时（设计 §4.1，07 号模块）。
 *
 * 文本键 → 当前语言 → 插值 → {@link ResolvedText} 的唯一入口（FR-L10N-01/03/04/06）：
 * - resolve 链：目标语言缺键 → 主语言回退 + `fallbackUsed` 标记 + engine 级
 *   告警（console / 调试面板可见，**不抛错**，FR-L10N-06）；主语言亦缺 →
 *   `text` 为原始键 + `found=false` + 告警（§4.1 缺失策略，MEDIA_MISSING
 *   同级告警——调试期显性化，不静默）；
 * - 插值：`{path}` 取自 InterpVars（调用方预先经表达式准备好，引擎不做插值内
 *   求表达式——避免文本层触发副作用）；格式化子集 `{path|fmt:number:1}`（精度，
 *   `+` 前缀显式正负号）；插值失败保留原始占位符并告警（FR-L10N-03）；
 * - 结构文本值（FR-L10N-04，§4.1「键值可为结构」）：`{plural: {one, other}}`
 *   按 vars 中的数量选择（简版规则 `=1 → one，否则 other`，ICU 完整复数规则
 *   zero/few/many 不做）；`{select: {expr, cases}}` 的 expr 在构造期经
 *   compileExpr 编译（DD-01 加载期编译语义的 resolver 装配点）、resolve 期以
 *   注入的 EvalContext 求值选 case，未知 case 回退 other，再无兜底则沿回退链
 *   落主语言；
 * - 词典来源为 {@link LocalePack}（06 号加载器产物，键级 Map；plural/select
 *   结构由加载器按 §4.1 透传）；本模块对语言包只读（管线产物已深冻结）；
 * - resolve 每次按传入 `lang` 现查，**无内部语言缓存状态**——运行时切换语言
 *   即时生效（FR-L10N-05）；select 表达式按原文 memo 编译产物（非词典内容缓存）；
 * - 独立测试（§4.1「独立测试」）：纯函数 + 词典夹具，不依赖运行时其他模块。
 */

/**
 * 插值变量（设计 §4.1 InterpVars）：调用方预先经表达式准备好的键值袋
 * （引擎不做插值内表达式求值——避免文本层触发副作用，§4.1）。
 *
 * 键支持两种形态：扁平点路径（如 `'player.name'`，优先）与嵌套对象
 * （`vars.player.name` 逐段下探）。复数计数取约定键 `count`（兼容 `n`）。
 */
export type InterpVars = Record<string, unknown>;

/** 解析产物（设计 §4.1 ResolvedText） */
export interface ResolvedText {
  /** 已插值的最终文本；键缺失时为原始键本身 */
  readonly text: string;
  /** 是否取到了有效文本（false = 键缺失或结构值不可解析，text 为原始键） */
  readonly found: boolean;
  /** 是否回退了主语言（FR-L10N-06：目标语言缺失键时的标记） */
  readonly fallbackUsed: boolean;
  /** 原始文本键 */
  readonly key: TextKey;
}

/** 文本解析器（设计 §4.1 TextResolver 接口） */
export interface TextResolver {
  /**
   * 解析文本键：目标语言 → 主语言回退 → 缺失告警（见模块 TSDoc）。
   *
   * 抛错面（数据缺陷显性化，NFR-05；键缺失**不**在此列）：词典接入校验
   * （结构形态违例 → `SCHEMA_INVALID`）、select 表达式编译失败 →
   * `EXPR_COMPILE`（DD-01）、select 求值遵循严格语义 → `EVAL_ERROR`、
   * 装配契约违规 → `INTERNAL`。
   */
  resolve(key: TextKey, lang: Lang, vars?: InterpVars): ResolvedText;
  /** 已注册语言清单（注册顺序；空包语言也在列） */
  availableLangs(): Lang[];
}

/** engine 级告警出口（§4.1 缺失策略：控制台与调试面板可见，不抛错） */
export type TextResolverWarn = (message: string, where: Readonly<Record<string, string>>) => void;

/** 默认告警出口：console.warn（调试期显性化，§4.1 / §10.2 engine.warn 级） */
export const consoleWarn: TextResolverWarn = (message, where) => {
  const detail = Object.entries(where)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  console.warn(`[i18n] ${message}${detail === '' ? '' : ` (${detail})`}`);
};

/** createTextResolver 选项（构造期装配契约） */
export interface TextResolverOptions {
  /** 主语言（GameDefinition.manifest.mainLang；回退链终点） */
  readonly mainLang: Lang;
  /**
   * 语言包全量常驻来源（默认形态：`locales: def.locales`，即 §4.1
   * 「主语言常驻内存」的缺省词典提供方式）。
   */
  readonly locales: Record<Lang, LocalePack>;
  /**
   * select 表达式编译用函数注册表（缺省 = 空注册表，仅路径型表达式可编译）；
   * 装配自 GameDefinition 时传 `def.functionRegistry`（内置 20 函数 + x.* 扩展）。
   */
  readonly functionRegistry?: ExprFunctionRegistry;
  /**
   * select 表达式求值上下文提供器：resolve 期调用，注入当前状态作用域
   * （§3.1 buildExprScope 产物 + Rng + 注册表）。词典含 select 结构时必填。
   */
  readonly evalContext?: () => EvalContext;
  /** 告警出口（缺省 {@link consoleWarn}；测试与调试面板可注入记录器） */
  readonly warn?: TextResolverWarn;
}

/**
 * 构造 TextResolver（设计 §4.1）。
 *
 * 抛错契约（构造期装配校验，NFR-05「失败要响」）：
 * - `locales` 缺失 → `INTERNAL`（装配契约违规，非词典数据缺陷）；
 * - 词典结构值形态违例 → `SCHEMA_INVALID`（§4.1 plural/select 形态裁决）；
 * - select 表达式编译失败 → `EXPR_COMPILE`（DD-01 编译期阻断，where 携带
 *   表达式原文与键定位）；
 * - 词典含 select 但未注入 evalContext → `INTERNAL`（无法完成 resolve 装配）。
 */
export function createTextResolver(options: TextResolverOptions): TextResolver {
  const { mainLang } = options;
  const warn = options.warn ?? consoleWarn;
  const locales = options.locales;
  if (locales === undefined) {
    throw new EngineError({
      code: 'INTERNAL',
      where: { detail: 'createTextResolver 缺少 locales 词典来源' },
      messageKey: 'error.i18n.noLocaleSource',
    });
  }
  const packs = new Map<Lang, LocalePack>(Object.entries(locales));
  const registry: ExprFunctionRegistry = options.functionRegistry ?? EMPTY_FUNCTION_REGISTRY;
  const runtime: ResolverRuntime = {
    warn,
    evalContext: options.evalContext,
    selectCache: new Map<ExprSource, CompiledExpr>(),
    validatedPacks: new WeakSet<object>(),
  };

  // 构造期词典接入校验：结构形态裁决 + select 表达式编译入缓存（07 任务 3）
  let selectCount = 0;
  for (const [lang, pack] of packs) {
    selectCount += ensurePackValidated(pack, lang, registry, runtime);
  }
  if (selectCount > 0 && options.evalContext === undefined) {
    throw new EngineError({
      code: 'INTERNAL',
      where: { detail: '词典含 select 结构，必须注入 evalContext 求值上下文（07 任务 3）' },
      messageKey: 'error.i18n.missingEvalContext',
    });
  }

  const packOf = (lang: Lang): LocalePack | undefined => packs.get(lang);

  return {
    resolve(key: TextKey, lang: Lang, vars: InterpVars = {}): ResolvedText {
      const target = packOf(lang)?.keys.get(key);
      if (target !== undefined) {
        const text = materialize(target, { key, lang, vars, runtime });
        if (text !== null) {
          return { text, found: true, fallbackUsed: false, key };
        }
      }
      if (lang !== mainLang) {
        const mainValue = packOf(mainLang)?.keys.get(key);
        if (mainValue !== undefined) {
          const text = materialize(mainValue, { key, lang: mainLang, vars, runtime });
          if (text !== null) {
            warn('文本键在目标语言缺失，已回退主语言', { key, lang, mainLang });
            return { text, found: true, fallbackUsed: true, key };
          }
        }
      }
      warn('文本键在主语言亦缺失，显示原始键', { key, lang, mainLang });
      return { text: key, found: false, fallbackUsed: false, key };
    },

    availableLangs(): Lang[] {
      return [...packs.keys()];
    },
  };
}

/** 空函数注册表（未注入 functionRegistry 时的缺省：仅路径型 select 可编译） */
const EMPTY_FUNCTION_REGISTRY: ExprFunctionRegistry = new Map();

/** resolve 期运行时装配（构造期确定，跨 resolve 复用） */
interface ResolverRuntime {
  readonly warn: TextResolverWarn;
  readonly evalContext: (() => EvalContext) | undefined;
  /** select 表达式编译缓存（键 = 表达式原文；按原文 memo，非词典内容缓存） */
  readonly selectCache: Map<ExprSource, CompiledExpr>;
  /** 已完成接入校验的语言包（按包对象记忆，随 runtime 生命周期） */
  readonly validatedPacks: WeakSet<object>;
}

/** 单次 resolve 的物化上下文 */
interface MaterializeContext {
  readonly key: TextKey;
  readonly lang: Lang;
  readonly vars: InterpVars;
  readonly runtime: ResolverRuntime;
}

// —— 结构文本值（§4.1 / FR-L10N-04，07 任务 3） ——————————————————————————————

/** 复数结构（简版规则：=1 → one，否则 other；ICU 完整复数规则不做） */
interface PluralStructure {
  readonly kind: 'plural';
  readonly branches: Readonly<Record<string, string>>;
}

/** select 结构（expr 构造期编译、resolve 期求值选 case） */
interface SelectStructure {
  readonly kind: 'select';
  readonly expr: ExprSource;
  readonly cases: Readonly<Record<string, string>>;
}

type TextStructure = PluralStructure | SelectStructure;

function isLocaleRecord(value: unknown): value is LocaleRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Readonly<Record<string, LocaleValue>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** 结构缺陷错误（SCHEMA_INVALID，定位到语言 + 键 + 细节；NFR-05 显性化） */
function structureError(lang: Lang, key: TextKey, detail: string): EngineError {
  return new EngineError({
    code: 'SCHEMA_INVALID',
    where: { lang, key, detail },
    messageKey: 'error.i18n.invalidStructure',
  });
}

/**
 * 键值 → 结构文本值：仅当记录含顶层 `plural`/`select` 属性时按 §4.1 结构
 * 解释（两者互斥防歧义）；其余形态返回 null（由调用方按不可渲染处理）。
 * 形态违例抛 `SCHEMA_INVALID`（词典接入期已裁决，此处重复调用不会命中）。
 */
function parseTextStructure(lang: Lang, key: TextKey, value: LocaleValue): TextStructure | null {
  if (!isLocaleRecord(value)) return null;
  const hasPlural = hasOwn(value, 'plural');
  const hasSelect = hasOwn(value, 'select');
  if (hasPlural && hasSelect) {
    throw structureError(lang, key, 'plural 与 select 结构互斥（§4.1 键值结构二选一）');
  }
  if (hasSelect) {
    const select = value['select'];
    if (!isLocaleRecord(select)) {
      throw structureError(lang, key, 'select 须为记录形态 {expr, cases}');
    }
    const expr = select['expr'];
    if (typeof expr !== 'string') {
      throw structureError(lang, key, 'select.expr 须为表达式字符串（ExprSource）');
    }
    const cases = select['cases'];
    if (!isLocaleRecord(cases)) {
      throw structureError(lang, key, 'select.cases 须为记录形态（case 名 → 文本）');
    }
    return { kind: 'select', expr, cases: stringBranches(lang, key, 'select.cases', cases) };
  }
  if (hasPlural) {
    const plural = value['plural'];
    if (!isLocaleRecord(plural)) {
      throw structureError(lang, key, 'plural 须为记录形态（one/other → 文本）');
    }
    return { kind: 'plural', branches: stringBranches(lang, key, 'plural', plural) };
  }
  return null;
}

/** 结构分支收敛：全部分支须为字符串文本（违例 SCHEMA_INVALID，定位分支名） */
function stringBranches(
  lang: Lang,
  key: TextKey,
  field: string,
  branches: Readonly<Record<string, LocaleValue>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(branches)) {
    if (typeof value !== 'string') {
      throw structureError(lang, key, `${field} 分支 '${name}' 须为字符串文本`);
    }
    out[name] = value;
  }
  return out;
}

/**
 * 语言包接入校验（构造期 / 懒加载包首见时各一次）：逐键裁决结构形态并编译
 * select 表达式入缓存（DD-01：编译失败 → EXPR_COMPILE 阻断）。返回发现的
 * select 结构数量（构造期装配校验用）。按包对象 memo——同一 resolver 对
 * 同一语言包只做一次全包走查（resolve 热路径不重复扫描，NFR-01）。
 */
function ensurePackValidated(
  pack: LocalePack,
  lang: Lang,
  registry: ExprFunctionRegistry,
  runtime: ResolverRuntime,
): number {
  if (runtime.validatedPacks.has(pack)) return 0;
  let selects = 0;
  for (const [key, value] of pack.keys) {
    const structure = parseTextStructure(lang, key, value);
    if (structure !== null && structure.kind === 'select') {
      compileSelectIntoCache(structure.expr, lang, key, registry, runtime.selectCache);
      selects += 1;
    }
  }
  runtime.validatedPacks.add(pack);
  return selects;
}

/** select 表达式编译入缓存（按原文 memo；失败包装 EXPR_COMPILE 并补键定位） */
function compileSelectIntoCache(
  expr: ExprSource,
  lang: Lang,
  key: TextKey,
  registry: ExprFunctionRegistry,
  selectCache: Map<ExprSource, CompiledExpr>,
): void {
  if (selectCache.has(expr)) return;
  try {
    selectCache.set(expr, compileExpr(expr, registry));
  } catch (cause) {
    if (cause instanceof EngineError) {
      throw new EngineError({
        code: 'EXPR_COMPILE',
        where: { ...cause.where, key, lang },
        messageKey: cause.messageKey,
        cause,
      });
    }
    throw cause;
  }
}

/** 复数计数取值约定键：`count` 优先，兼容 `n`（模块 TSDoc 约定） */
const PLURAL_COUNT_KEYS = ['count', 'n'] as const;

/** 复数解析：计数缺失/非 number → 告警并走回退链；=1 → one（缺省落 other） */
function resolvePlural(structure: PluralStructure, context: MaterializeContext): string | null {
  const { runtime } = context;
  let count: unknown;
  let counted = false;
  let countKey: string = PLURAL_COUNT_KEYS[0];
  for (const name of PLURAL_COUNT_KEYS) {
    const lookup = lookupVar(context.vars, name);
    if (lookup.found) {
      count = lookup.value;
      counted = true;
      countKey = name;
      break;
    }
  }
  if (!counted || typeof count !== 'number') {
    runtime.warn('复数文本缺少数值型计数变量', {
      key: context.key,
      lang: context.lang,
      detail: `约定键 ${PLURAL_COUNT_KEYS.join('/')} 须为 number（实际 ${
        counted ? describeValueKind(count) : '未提供'
      }）`,
    });
    return null;
  }
  // 分支模板统一以 {count} 取计数：经兼容键 n 传入时注入 count 别名
  const branchVars: InterpVars = countKey === 'count' ? context.vars : { ...context.vars, count };
  const branch =
    count === 1
      ? (structure.branches['one'] ?? structure.branches['other'])
      : structure.branches['other'];
  if (branch === undefined) {
    runtime.warn('复数文本无可用分支', {
      key: context.key,
      lang: context.lang,
      detail: `count=${String(count)}：one/other 分支均缺失`,
    });
    return null;
  }
  return interpolate(branch, { ...context, vars: branchVars });
}

/** select 解析：求值（DD-01 严格语义）→ case 匹配 → other 兜底 → 回退链 */
function resolveSelect(structure: SelectStructure, context: MaterializeContext): string | null {
  const { runtime } = context;
  const evalContext = runtime.evalContext?.();
  if (evalContext === undefined) {
    throw new EngineError({
      code: 'INTERNAL',
      where: { key: context.key, expr: structure.expr, detail: 'select 求值上下文未注入' },
      messageKey: 'error.i18n.missingEvalContext',
    });
  }
  const compiled = runtime.selectCache.get(structure.expr);
  if (compiled === undefined) {
    throw new EngineError({
      code: 'INTERNAL',
      where: { key: context.key, expr: structure.expr, detail: 'select 表达式未经构造期编译' },
      messageKey: 'error.i18n.selectNotCompiled',
    });
  }
  const result = evalExpr(compiled, evalContext);
  const caseName = typeof result === 'string' ? result : String(result);
  const branch = structure.cases[caseName] ?? structure.cases['other'];
  if (branch === undefined) {
    runtime.warn('select 文本无匹配分支', {
      key: context.key,
      lang: context.lang,
      detail: `表达式结果 '${caseName}' 无对应 case 且无 other 兜底`,
    });
    return null;
  }
  return interpolate(branch, context);
}

// —— 插值与格式化（设计 §4.1 / FR-L10N-03，07 任务 2） ————————————————————————

/**
 * 键值 → 最终文本：字符串模板经插值；plural/select 结构按 §4.1 解析
 * （07 任务 3）；其余形态视为不可渲染，走回退链与告警。
 * 返回 null 表示不可解析（detail 由告警出口携带）。
 */
function materialize(value: LocaleValue, context: MaterializeContext): string | null {
  if (typeof value === 'string') return interpolate(value, context);
  if (isLocaleRecord(value)) {
    const structure = parseTextStructure(context.lang, context.key, value);
    if (structure !== null) {
      return structure.kind === 'plural'
        ? resolvePlural(structure, context)
        : resolveSelect(structure, context);
    }
  }
  context.runtime.warn('文本键值不是可渲染的文本形态', {
    key: context.key,
    lang: context.lang,
    detail: describeValueKind(value),
  });
  return null;
}

/**
 * 占位符语法：`{path}` 或 `{path|fmt:number:精度}`（格式段以 `|` 引入、
 * `:` 分段）。路径不含 `{}`/`|`；不匹配该语法的花括号文本原样保留。
 */
const PLACEHOLDER_PATTERN = /\{([^{}|]+)(?:\|([^{}]+))?\}/g;

/** 数值格式化规格（`fmt:number` 段解析产物；digits=null = 默认字符串形态） */
interface NumberFormat {
  readonly signed: boolean;
  readonly digits: number | null;
}

/**
 * 解析格式段：`fmt:number` / `fmt:number:<N>`（保留 N 位小数）/
 * `fmt:number:+<N>`（显式正负号，FR-L10N-03「数值精度、正负号」子集）。
 * 语法外规格 → null（调用方按插值失败处理，保留原始占位符）。
 */
function parseNumberFormat(spec: string): NumberFormat | null {
  const parts = spec.split(':');
  if (parts[0] !== 'fmt' || parts[1] !== 'number' || parts.length > 3) return null;
  const precision = parts[2];
  if (precision === undefined) return { signed: false, digits: null };
  const signed = precision.startsWith('+');
  const digitsText = signed ? precision.slice(1) : precision;
  if (!/^\d+$/.test(digitsText)) return null;
  return { signed, digits: Number.parseInt(digitsText, 10) };
}

/** 数值格式化：digits 非 null 时按 toFixed 保留 N 位；signed 且非负时补 `+` */
function formatNumber(value: number, format: NumberFormat): string {
  const magnitude = format.digits === null ? String(value) : value.toFixed(format.digits);
  return format.signed && value >= 0 ? `+${magnitude}` : magnitude;
}

/** 变量查找结果（found=false = InterpVars 未提供该路径） */
interface VarLookup {
  readonly found: boolean;
  readonly value: unknown;
}

/**
 * 占位符取值：扁平点路径键优先（调用方预先经表达式准备好的形态，§4.1），
 * 其次嵌套对象逐段下探（`vars.player.name`）。数组下探不支持（数组值本身
 * 不可渲染）。
 */
function lookupVar(vars: InterpVars, path: string): VarLookup {
  if (Object.prototype.hasOwnProperty.call(vars, path)) {
    const direct = vars[path];
    if (direct !== undefined) return { found: true, value: direct };
  }
  let current: unknown = vars;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) return { found: false, value: undefined };
  }
  return { found: true, value: current };
}

/**
 * 值 → 可渲染文本；null = 不可渲染。严格类型（无隐式转换，与 DD-01 同源）：
 * 仅 string/number/boolean 可渲染；数值格式化段只接受 number。
 */
function renderValue(value: unknown, format: NumberFormat | null): string | null {
  if (typeof value === 'string') return format === null ? value : null;
  if (typeof value === 'number') {
    return format === null ? String(value) : formatNumber(value, format);
  }
  if (typeof value === 'boolean') return format === null ? String(value) : null;
  return null;
}

/** 诊断用值形态描述（不渲染对象内容，§10.2 诊断脱敏） */
function describeValueKind(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * 模板插值：`{path}` 从 InterpVars 取值（引擎不做插值内表达式求值——避免
 * 文本层触发副作用，§4.1）；插值失败（变量缺失 / 值不可渲染 / 格式不合法）
 * 保留原始占位符并告警一次（FR-L10N-03）。插值值不参与二次插值。
 */
function interpolate(template: string, context: MaterializeContext): string {
  const { runtime } = context;
  return template.replace(
    PLACEHOLDER_PATTERN,
    (raw: string, path: string, spec: string | undefined) => {
      const fail = (detail: string): string => {
        runtime.warn('插值失败，保留原始占位符', {
          key: context.key,
          lang: context.lang,
          placeholder: path,
          detail,
        });
        return raw;
      };
      let format: NumberFormat | null = null;
      if (spec !== undefined) {
        format = parseNumberFormat(spec);
        if (format === null) return fail(`未知格式化规格 '${spec}'`);
      }
      const lookup = lookupVar(context.vars, path);
      if (!lookup.found) return fail('变量未提供');
      const text = renderValue(lookup.value, format);
      if (text === null) {
        return fail(
          format === null
            ? `值类型 ${describeValueKind(lookup.value)} 不可渲染为文本`
            : `值类型 ${describeValueKind(lookup.value)} 不可渲染为文本（格式化要求 number）`,
        );
      }
      return text;
    },
  );
}
