import type { Lang, TextKey } from '@game/shared';
import type { LocalePack, LocaleValue } from '../loader/index.js';
import { extractPlaceholderPaths } from './text-resolver.js';

/**
 * 翻译完成度统计（07 任务 7；设计 §7.8 翻译管理「缺失 / 占位符不一致」
 * 状态来源，供 26 号编辑器翻译管理 FR-EDTR-13 复用）。
 *
 * 以主语言包为基准与目标语言包做**键级集合比对**（纯函数，无副作用、
 * 不抛错、不做结构形态校验——那是加载器 / TextResolver 的接入职责）：
 * - 缺失：主语言有而目标语言没有的键（翻译缺口，FR-L10N-06 渐进翻译的
 *   待办清单）；
 * - 未使用（口径注明）：**词典键 vs 主语言键的差集**——目标语言有而主语言
 *   没有的键（主语言已删除或键名拼错的孤儿键，resolve 永远不会命中）。
 *   设计 §7.8 的完整「扫描全包 TextKey 使用点 ↔ locales 比对」口径（含
 *   scenes/事件等数据域引用扫描）属 26 号编辑器翻译管理职责，此处不复制
 *   其多域走查（误漏一个引用域即产生假阳性清单），故采用上述键级降级口径；
 * - 占位符不一致：两语言都有该键，但 `{path}` 占位符**集合**不同（任务书
 *   定义：主语言与译文 {path} 集合不同）。集合语义——出现次数与顺序无关；
 *   比较的是变量路径，格式化段 `{path|fmt:number:…}` 剥离后参与比较（格式
 *   差异不属于占位符缺失）。占位符提取复用 resolve 的同一权威语法解析
 *   （{@link extractPlaceholderPaths}），统计口径与运行时插值一致；
 * - 结构值（FR-L10N-04）：plural/select 的占位符集合为**全部分支模板的
 *   并集**（译文可只在部分分支承载某变量）；`select.expr` 为表达式原文
 *   （§2.3 语法无占位符形态），泛递归自然不提取；
 * - 输出按键名字典序排序（编辑器表格展示与断言的确定性）；
 * - `lang == mainLang` → 与自身比对，三个清单均空；目标语言包未注册 →
 *   全部主语言键记缺失（翻译完成度 0% 的起点形态）。
 */

/** 统计产物（键名清单均按键名字典序排序） */
export interface TranslationStats {
  /** 主语言有而目标语言没有的键（译文缺失） */
  readonly missingKeys: readonly TextKey[];
  /** 目标语言有而主语言没有的键（孤儿键，resolve 永不命中） */
  readonly unusedKeys: readonly TextKey[];
  /** 两语言占位符集合不同的键（§7.8「占位符不一致」） */
  readonly placeholderMismatchKeys: readonly TextKey[];
}

/**
 * 统计输入：GameDefinition（设计 §3.4 冻结产物）的结构子集——
 * `manifest.mainLang` + `locales`。直接传 `loadGamePackage` 产物
 * GameDefinition 即可；26 号编辑器亦可传其 DocModel 投影（结构等价即可，
 * 避免为统计构造完整冻结产物）。
 */
export interface TranslationStatsInput {
  /** 主语言（回退链终点，缺失比对的基准语言） */
  readonly manifest: { readonly mainLang: Lang };
  /** 语言包表（§3.4 加载产物；未注册语言按空包参与比对） */
  readonly locales: Readonly<Record<Lang, LocalePack>>;
}

/**
 * 收集 `lang` 相对主语言的翻译完成度统计（见模块 TSDoc 的口径定义）。
 *
 * 纯函数：只读入参，不校验、不冻结、不抛错——畸形结构值按其包含的
 * 字符串模板自然参与占位符提取（形态裁决由加载器 / TextResolver 负责）。
 */
export function collectTranslationStats(def: TranslationStatsInput, lang: Lang): TranslationStats {
  const mainPack: LocalePack | undefined = def.locales[def.manifest.mainLang];
  const targetPack: LocalePack | undefined = def.locales[lang];
  const mainKeys = [...(mainPack?.keys.keys() ?? [])];
  const targetKeys = [...(targetPack?.keys.keys() ?? [])];
  const mainKeySet = new Set<string>(mainKeys);
  const targetKeySet = new Set<string>(targetKeys);

  const missingKeys = mainKeys.filter((key) => !targetKeySet.has(key)).sort();
  const unusedKeys = targetKeys.filter((key) => !mainKeySet.has(key)).sort();

  const placeholderMismatchKeys: TextKey[] = [];
  for (const key of mainKeys) {
    if (!targetKeySet.has(key)) continue; // 缺失键不重复计入占位符比对
    const sourcePaths = placeholderSetOf(mainPack?.keys.get(key));
    const targetPaths = placeholderSetOf(targetPack?.keys.get(key));
    if (!setsEqual(sourcePaths, targetPaths)) placeholderMismatchKeys.push(key);
  }
  placeholderMismatchKeys.sort();

  return { missingKeys, unusedKeys, placeholderMismatchKeys };
}

/** 键值的占位符路径集合：字符串模板提取，数组 / 记录递归（结构分支并集） */
function placeholderSetOf(value: LocaleValue | undefined): Set<string> {
  const paths = new Set<string>();
  collectPlaceholderPaths(value, paths);
  return paths;
}

function collectPlaceholderPaths(value: LocaleValue | undefined, paths: Set<string>): void {
  if (value === undefined) return;
  if (typeof value === 'string') {
    for (const path of extractPlaceholderPaths(value)) paths.add(path);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPlaceholderPaths(item, paths);
    return;
  }
  for (const child of Object.values(value)) collectPlaceholderPaths(child, paths);
}

/** 集合相等：元素互含（size 相同 + 子集判定） */
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const path of a) {
    if (!b.has(path)) return false;
  }
  return true;
}
