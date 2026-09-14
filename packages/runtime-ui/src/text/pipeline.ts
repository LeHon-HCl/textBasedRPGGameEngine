import type { ResolvedText, TextResolver } from '@game/engine';
import type { TextKey } from '@game/shared';
import { richTextToPlainText, sanitizeRichText } from './sanitize.js';
import type { RichTextNode } from './sanitize.js';

/**
 * 文本渲染管线（设计 §6.1）。
 *
 * ```
 * RenderSegment ─► TextResolver.resolve(key, lang, vars) ─► 插值文本 ─► sanitize ─► ReactNode
 * ```
 *
 * 分工不变式（避免双份真相）：
 * - **插值**归引擎 TextResolver（§4.1；含回退链、复数/select、格式化子集）——
 *   UI 侧不重复实现插值，只负责把 RenderSegment 的 vars 传下去；
 * - **sanitize** 归 UI（§6.1「富白名单在 UI 层，NFR-18」）——引擎产出的文本
 *   一律视为不可信（译文与 Mod 同源处理）；
 * - 次序：先插值后 sanitize。插值值来源是状态数据，其中的尖括号会被本管线
 *   当作文本处理，永不引入标签。
 *
 * 本模块为纯逻辑（不依赖 React），便于在 node/jsdom 两种环境直接断言节点树。
 */

/** 渲染输入（RenderSegment 的 UI 侧最小视图，避免深绑引擎内部类型） */
export interface RenderInput {
  readonly kind: 'text' | 'spacing' | 'image';
  readonly key?: TextKey;
  /** 延迟插值变量（对象 = 快照；函数 = 每次渲染时组装，FR-NARR-04） */
  readonly vars?: Readonly<Record<string, unknown>> | (() => Readonly<Record<string, unknown>>);
  /** 媒体意图透传（DD-05：播放器消费；本管线不解释） */
  readonly media?: readonly RenderMedia[];
}

/** 媒体意图的 UI 侧最小视图（与引擎 MediaIntent 结构等价） */
export interface RenderMedia {
  readonly type: 'bg' | 'cg' | 'sprite' | 'bgm' | 'sfx';
  readonly assetId: string;
  readonly transition?: 'fade' | 'cut';
  readonly loop?: true;
  readonly missing?: true;
}

/** 单段渲染结果（组件与打字机消费的纯数据） */
export interface RenderResult {
  /** 白名单节点树（RichText 渲染器的输入） */
  readonly nodes: readonly RichTextNode[];
  /** 纯文本投影（打字机计数、无障碍备选文本、搜索） */
  readonly plainText: string;
  /** 键是否取到有效文本（false = 键缺失/结构值不可解析，plainText 为原始键） */
  readonly found: boolean;
  /** 是否回退了主语言（FR-L10N-06；UI 可提示译文缺失） */
  readonly fallbackUsed: boolean;
  /** 媒体意图（kind='image' 或段落携带媒体时有值） */
  readonly media?: readonly RenderMedia[];
}

/** 渲染管线构造选项 */
export interface RenderPipelineOptions {
  /** 引擎文本解析器（唯一插值入口，§4.1） */
  readonly resolver: TextResolver;
  /** 当前语言（切换语言即重建管线或传新值；FR-L10N-05） */
  readonly lang: string;
  /**
   * UI 侧补充告警出口（键缺失已由 resolver 自理；本出口用于「物化异常」等
   * UI 侧可观测事件）。缺省丢弃（与引擎 onWarn 同口径）。
   */
  readonly onWarn?: (message: string) => void;
}

/** 渲染管线（见模块 TSDoc） */
export interface RenderPipeline {
  /** 渲染单个段落 */
  render(input: RenderInput): RenderResult;
  /** 批量渲染（一次推进揭示的整段列表） */
  renderAll(inputs: readonly RenderInput[]): RenderResult[];
}

/** 取本次渲染的插值变量（函数形态逐次求值——延迟插值反映渲染时刻状态） */
function resolveVars(vars: RenderInput['vars']): Readonly<Record<string, unknown>> | undefined {
  if (vars === undefined) return undefined;
  return typeof vars === 'function' ? vars() : vars;
}

/**
 * 转义插值变量中的字符串叶子节点（§6.1「插值值永不引入标签」）。
 *
 * 为什么在 UI 侧做：插值本身归引擎（回退链/复数/select/格式化只有一份实现），
 * 但引擎只做字符串拼接、不知道下游要按 HTML 白名单解析。若把状态数据里的
 * `<b>` 原样代入模板，sanitize 阶段会把它当**标签**放行——那不是作者声明的
 * 富文本，而是数据注入。故在进入 resolver 之前把值转义为实体：模板（作者
 * 声明的白名单标记）不受影响，值经 parse5 解码后仍是字面文本。
 *
 * 只处理字符串叶子（数字/布尔/缺失值无需转义）；数组与对象递归下探。
 *
 * @param vars 调用方提供的插值变量（不修改入参；需要转义的路径返回新对象）
 */
function escapeInterpVars(vars: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(vars)) {
    out[key] = escapeInterpValue(value);
  }
  return out;
}

/** 单个插值值的转义（字符串转义；数组/对象递归；其余原样） */
function escapeInterpValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
  if (Array.isArray(value)) return value.map(escapeInterpValue);
  if (value !== null && typeof value === 'object') {
    return escapeInterpVars(value as Readonly<Record<string, unknown>>);
  }
  return value;
}

/**
 * 创建渲染管线（见模块 TSDoc）。
 *
 * @param options resolver / lang / onWarn（见 {@link RenderPipelineOptions}）
 * @returns 可复用的管线实例；`lang` 在创建时固定，切换语言请重建实例
 *   （与引擎「resolve 每次现查 lang」的无状态语义一致，重建是最简正确做法）
 */
export function createRenderPipeline(options: RenderPipelineOptions): RenderPipeline {
  const { resolver, lang, onWarn } = options;

  const render = (input: RenderInput): RenderResult => {
    const media = input.media;
    if (input.kind !== 'text' || input.key === undefined) {
      // spacing / image 段落无文本；image 段落的媒体意图原样透传
      return {
        nodes: [],
        plainText: '',
        found: true,
        fallbackUsed: false,
        ...(media !== undefined ? { media } : {}),
      };
    }
    let resolved: ResolvedText;
    try {
      const raw = resolveVars(input.vars);
      resolved = resolver.resolve(
        input.key,
        lang,
        raw !== undefined ? escapeInterpVars(raw) : undefined,
      );
    } catch (error) {
      // 结构值违例 / select 求值失败等属数据缺陷（§4.1 抛错面）：不把异常
      // 抛给渲染层（否则整屏白），转为可见的占位文本 + 告警（显性但不致命）
      const detail = error instanceof Error ? error.message : String(error);
      onWarn?.(`文本键 '${input.key}' 物化失败：${detail}`);
      return {
        nodes: [{ kind: 'text', text: input.key }],
        plainText: input.key,
        found: false,
        fallbackUsed: false,
        ...(media !== undefined ? { media } : {}),
      };
    }
    const nodes = sanitizeRichText(resolved.text);
    return {
      nodes,
      plainText: richTextToPlainText(nodes),
      found: resolved.found,
      fallbackUsed: resolved.fallbackUsed,
      ...(media !== undefined ? { media } : {}),
    };
  };

  return {
    render,
    renderAll: (inputs) => inputs.map(render),
  };
}
