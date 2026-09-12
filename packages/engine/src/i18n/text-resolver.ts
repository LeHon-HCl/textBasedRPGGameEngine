import { EngineError } from '@game/shared';
import type { Lang, TextKey } from '@game/shared';
import type { LocalePack, LocaleValue } from '../loader/index.js';

/**
 * 文本解析与本地化运行时（设计 §4.1，07 号模块）。
 *
 * 文本键 → 当前语言 → 插值 → {@link ResolvedText} 的唯一入口（FR-L10N-01/06）：
 * - resolve 链：目标语言缺键 → 主语言回退 + `fallbackUsed` 标记 + engine 级
 *   告警（console / 调试面板可见，**不抛错**，FR-L10N-06）；主语言亦缺 →
 *   `text` 为原始键 + `found=false` + 告警（§4.1 缺失策略，MEDIA_MISSING
 *   同级告警——调试期显性化，不静默）；
 * - 词典来源为 {@link LocalePack}（06 号加载器产物，键级 Map）；本模块对
 *   语言包只读（运行期输入已由加载器深冻结）；
 * - resolve 每次按传入 `lang` 现查，**无内部语言缓存状态**——运行时切换语言
 *   即时生效（FR-L10N-05）；
 * - 独立测试（§4.1「独立测试」）：纯函数 + 词典夹具，不依赖运行时其他模块。
 */

/**
 * 插值变量（设计 §4.1 InterpVars）：调用方预先经表达式准备好的键值袋
 * （引擎不做插值内表达式求值——避免文本层触发副作用，§4.1）。
 *
 * 键支持两种形态：扁平点路径（如 `'player.name'`，优先）与嵌套对象
 * （`vars.player.name` 逐段下探）。
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
   * 纯查询：不抛错（语言包数据缺陷除外，见 select 结构的显性化约定）、
   * 无内部缓存，同一键反复解析始终反映词典当前内容。
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
  /** 告警出口（缺省 {@link consoleWarn}；测试与调试面板可注入记录器） */
  readonly warn?: TextResolverWarn;
}

/**
 * 构造 TextResolver（设计 §4.1）。
 *
 * 抛错契约（构造期装配校验，NFR-05「失败要响」）：
 * - `locales` 缺失 → `INTERNAL`（装配契约违规，非词典数据缺陷）。
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

  const packOf = (lang: Lang): LocalePack | undefined => packs.get(lang);

  return {
    resolve(key: TextKey, lang: Lang, vars: InterpVars = {}): ResolvedText {
      const target = packOf(lang)?.keys.get(key);
      if (target !== undefined) {
        const materialized = materialize(target, { key, lang, vars, warn });
        if (materialized !== null) {
          return { text: materialized, found: true, fallbackUsed: false, key };
        }
      }
      if (lang !== mainLang) {
        const mainValue = packOf(mainLang)?.keys.get(key);
        if (mainValue !== undefined) {
          const materialized = materialize(mainValue, {
            key,
            lang: mainLang,
            vars,
            warn,
          });
          if (materialized !== null) {
            warn('文本键在目标语言缺失，已回退主语言', { key, lang, mainLang });
            return { text: materialized, found: true, fallbackUsed: true, key };
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

/**
 * 键值 → 最终文本：字符串模板经插值（07 任务 2）；数组/结构值视为不可解析，
 * 走回退链与告警（07 任务 3 引入 plural/select 结构后扩展）。
 * 返回 null 表示不可解析（detail 由告警出口携带）。
 */
function materialize(
  value: LocaleValue,
  context: {
    readonly key: TextKey;
    readonly lang: Lang;
    readonly vars: InterpVars;
    readonly warn: TextResolverWarn;
  },
): string | null {
  if (typeof value === 'string') return interpolate(value, context);
  context.warn('文本键值不是可渲染的文本形态', {
    key: context.key,
    lang: context.lang,
    detail: describeValueKind(value),
  });
  return null;
}

// —— 插值与格式化（设计 §4.1 / FR-L10N-03，07 任务 2） ————————————————————————

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
function interpolate(
  template: string,
  context: {
    readonly key: TextKey;
    readonly lang: Lang;
    readonly vars: InterpVars;
    readonly warn: TextResolverWarn;
  },
): string {
  return template.replace(
    PLACEHOLDER_PATTERN,
    (raw: string, path: string, spec: string | undefined) => {
      const fail = (detail: string): string => {
        context.warn('插值失败，保留原始占位符', {
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
