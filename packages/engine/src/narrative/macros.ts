import { EngineError } from '@game/shared';
import type { Rng, TextKey } from '@game/shared';

/**
 * 叙事宏（FR-NARR-04，设计 §4.2「宏展开在 renderList() 时惰性求值」）。
 *
 * **数据形态裁决**（§4.2「schema 层先承载『键 + 显示条件』最小面」，scene.ts
 * TSDoc）：02 号 segmentSchema 只承载 `{key, showIf}`，宏结构由**语言包记录值**
 * 透传（loader 只做结构透传与冻结，LocaleRecord 契约），本模块在 renderList
 * 惰性解释——段落键在主语言词典中的记录值若匹配宏形态，即展开为分支键
 * （宏产物最终都映射到键，D4；字面模板由宿主 UI 层经 RenderSegment.literal
 * 承载，运行时宏一律产键）。结构与内容分离：宏结构以主语言词典为准读取，
 * 分支键的文本物化仍由 TextResolver 按会话语言解析（§4.1 集成）。
 *
 * 宏形态（互斥判别，识别自记录值顶层属性）：
 * - 首次/再次：`{first: <key>, again: <key>}`——依据 seen.scenes 的访问快照
 *   选择分支（§4.2「写 seen.scenes 的时机 = 正常会话渲染时」由 SceneRunner
 *   配合实现；readonly 会话强制 again 且不写 seen，FR-GAL-01）；
 * - 条件文本：`{if: <expr>, then: <key>, else?: <key>}`——条件不满足且无
 *   else 分支时该段落不进入渲染列表（proposal §5.2 if/else 示意的落地形态）；
 * - 随机选段：`{random: [{weight: <number>, key: <key>}, ...]}`——按权重经
 *   注入 Rng 抽取（DD-09 单一随机序列，回放一致）；
 * - `{plural}`/`{select}` 及其余记录形态**不是**宏：前者是 i18n 结构文本值
 *   （§4.1，TextResolver 解释），后者显性报 SCHEMA_INVALID（数据缺陷不静默）。
 */

/** 首次/再次宏（first/again 分支键） */
export interface FirstAgainMacro {
  readonly kind: 'firstAgain';
  readonly first: TextKey;
  readonly again: TextKey;
}

/** 条件文本宏（if/else 分支键；else 可省略） */
export interface ConditionalMacro {
  readonly kind: 'cond';
  /** 条件表达式原文（ExprSource，§2.3；编译产物经 def.exprCache 复用） */
  readonly expr: string;
  readonly then: TextKey;
  readonly else?: TextKey;
}

/** 随机选段宏（带权分支；抽取经注入 Rng） */
export interface RandomMacro {
  readonly kind: 'random';
  readonly entries: readonly { readonly weight: number; readonly key: TextKey }[];
}

/** 叙事宏判别联合 */
export type NarrativeMacro = FirstAgainMacro | ConditionalMacro | RandomMacro;

/** 宏展开上下文（SceneRunner 装配：条件求值 + 访问快照 + 随机源） */
export interface MacroExpansionContext {
  /** 条件表达式求值（加载期编译产物复用，§3.4 步骤 5） */
  readonly evalCondition: (expr: string) => boolean;
  /** 本次访问是否首次（seen.scenes 访问快照；readonly 恒 false） */
  readonly firstVisit: boolean;
  /** 会话随机源（DD-09：random 宏消耗运行时单一序列） */
  readonly rng: Rng;
}

type LocaleStructure = Record<string, unknown>;

function isRecord(value: unknown): value is LocaleStructure {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 宏形态缺陷（SCHEMA_INVALID：识别出判别属性但结构不完整，定位段落键） */
function macroError(key: TextKey, detail: string): EngineError {
  return new EngineError({
    code: 'SCHEMA_INVALID',
    where: { key, detail },
    messageKey: 'error.narrative.macroShape',
  });
}

function asBranchKey(key: TextKey, field: string, value: unknown): TextKey {
  if (typeof value !== 'string' || value.length === 0) {
    throw macroError(key, `宏分支 ${field} 须为非空文本键（实际 ${describe(value)}）`);
  }
  return value;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * 段落键的词典记录值 → 宏（FR-NARR-04）。
 *
 * 返回 null = 非宏（字符串文本、i18n plural/select 结构、缺失记录——按普通
 * 文本键渲染）；识别出判别属性但结构违例 → SCHEMA_INVALID（NFR-05 显性化）。
 * 判别属性（first/again、if、random）并存视为形态歧义 → SCHEMA_INVALID。
 */
export function parseMacro(key: TextKey, value: unknown): NarrativeMacro | null {
  if (typeof value === 'string' || !isRecord(value)) return null;
  const hasFirstAgain = 'first' in value || 'again' in value;
  const hasCond = 'if' in value;
  const hasRandom = 'random' in value;
  const i18nStructure = 'plural' in value || 'select' in value;
  const discriminants = [hasFirstAgain, hasCond, hasRandom].filter(Boolean).length;
  if (discriminants > 1) {
    throw macroError(key, '宏判别属性并存（first/again、if、random 三选一）');
  }
  if (discriminants === 0) return null; // plural/select 等结构透传给 TextResolver
  if (i18nStructure) {
    throw macroError(key, '叙事宏与 i18n 结构（plural/select）不可同键混用');
  }
  if (hasFirstAgain) {
    const first = value['first'];
    const again = value['again'];
    if (first === undefined || again === undefined) {
      throw macroError(key, 'first/again 宏须同时声明 first 与 again 分支键');
    }
    return {
      kind: 'firstAgain',
      first: asBranchKey(key, 'first', first),
      again: asBranchKey(key, 'again', again),
    };
  }
  if (hasCond) {
    const expr = value['if'];
    const then = value['then'];
    if (typeof expr !== 'string' || expr.length === 0) {
      throw macroError(key, 'if 宏须为非空条件表达式（ExprSource）');
    }
    if (then === undefined) {
      throw macroError(key, 'if 宏须声明 then 分支键');
    }
    const elseBranch = value['else'];
    return {
      kind: 'cond',
      expr,
      then: asBranchKey(key, 'then', then),
      ...(elseBranch !== undefined ? { else: asBranchKey(key, 'else', elseBranch) } : {}),
    };
  }
  // random 宏：带权分支数组
  const entries = value['random'];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw macroError(key, 'random 宏须为非空分支数组 [{weight, key}]');
  }
  return {
    kind: 'random',
    entries: entries.map((entry, index) => {
      if (!isRecord(entry)) {
        throw macroError(key, `random 分支[${index}] 须为 {weight, key} 记录`);
      }
      const weight = normalizeWeight(entry['weight']);
      const branchKey = entry['key'];
      if (weight === null) {
        throw macroError(
          key,
          `random 分支[${index}].weight 须为非负数值（加载器结构透传将数值字符串化，数值字符串亦可）`,
        );
      }
      if (branchKey === undefined) {
        throw macroError(key, `random 分支[${index}] 须声明 key（分支文本键）`);
      }
      return { weight, key: asBranchKey(key, `random[${index}].key`, branchKey) };
    }),
  };
}

/**
 * 权重归一化：number 直接校验；字符串按十进制数值解析（加载器结构透传
 * toStructuralValue 将数值字符串化——FR-L10N-04 结构值同为字符串面）。
 * 非法（负数/非数值/溢出）→ null，由调用方报 SCHEMA_INVALID。
 */
function normalizeWeight(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * 宏展开（§4.2「惰性求值」）：按访问快照与上下文选出分支键。
 * - firstAgain：firstVisit ? first : again；
 * - cond：条件求值（严格语义经注入的 evalCondition）→ then / else；条件不
 *   满足且无 else → 返回 null（段落不进入渲染列表）；
 * - random：Rng.weighted 按权抽取（全 0 权重为数据缺陷，Rng 抛 INTERNAL）。
 */
export function expandMacro(macro: NarrativeMacro, context: MacroExpansionContext): TextKey | null {
  switch (macro.kind) {
    case 'firstAgain':
      return context.firstVisit ? macro.first : macro.again;
    case 'cond':
      if (context.evalCondition(macro.expr)) return macro.then;
      return macro.else ?? null;
    case 'random':
      return context.rng.weighted(
        macro.entries.map((entry) => ({ weight: entry.weight, item: entry.key })),
      );
  }
}
