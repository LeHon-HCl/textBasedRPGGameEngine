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
 * 键值 → 最终文本（无结构值形态时仅接受字符串；数组/结构值视为不可解析，
 * 走回退链与告警——07 任务 3 引入 plural/select 结构后扩展）。
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
  if (typeof value === 'string') return value;
  context.warn('文本键值不是可渲染的文本形态', {
    key: context.key,
    lang: context.lang,
    detail: describeValueKind(value),
  });
  return null;
}

/** 不可解析键值的形态描述（诊断用，避免渲染对象内容） */
function describeValueKind(value: LocaleValue): string {
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' && value !== null ? 'record' : typeof value;
}
