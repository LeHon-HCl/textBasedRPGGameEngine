/**
 * 叙事区类型（设计 §6.2 组件契约）。
 *
 * 与 app 的 SessionView 的分工：SessionView 是 **store 快照**（整屏状态），
 * 本文件是**组件 props**（叙事区子树的输入面）。二者形态刻意保持结构兼容
 * （segment/choice 字段逐字同形），使 AppShell 组装时零转换。
 */

/** 叙事段落视图（RenderSegment 的可渲染投影，D4：文本键 + 延迟插值 vars） */
export interface NarrativeSegmentView {
  readonly kind: 'text' | 'spacing' | 'image';
  readonly key?: string;
  readonly literal?: string;
  /** 插值变量（快照或函数；函数形态由渲染层逐次求值，FR-NARR-04） */
  readonly vars?: Readonly<Record<string, unknown>> | (() => Readonly<Record<string, unknown>>);
  /** 媒体意图透传（播放器消费；叙事区只标注占位） */
  readonly media?: readonly {
    readonly type: 'bg' | 'cg' | 'sprite' | 'bgm' | 'sfx';
    readonly assetId: string;
    readonly transition?: 'fade' | 'cut';
    readonly loop?: true;
    readonly missing?: true;
  }[];
}

/** 选项视图（ChoiceView 的 UI 侧同形投影） */
export interface OptionView {
  readonly id: string;
  readonly textKey: string;
  readonly enabled: boolean;
  readonly disabledReasonKey?: string;
  /** true = 被内容过滤隐藏（不渲染，FR-CGRD-03 应用点 3） */
  readonly hiddenByFilter?: boolean;
}

/** 叙事区文案（可注入本地化；缺省中文可用性回退） */
export interface NarrativeLabels {
  readonly advance?: string;
  readonly end?: string;
  /** 会话终局说明模板（`{ending}` 占位替换为结局 id） */
  readonly ending?: string;
  readonly back?: string;
  readonly loop?: string;
}

/** 缺省文案（D4 边界：正式文案由宿主经 labels 注入） */
export const DEFAULT_NARRATIVE_LABELS: Required<NarrativeLabels> = {
  advance: '继续',
  end: '本段旅程到此为止',
  ending: '—— 结局：{ending} ——',
  back: '—— 返回上层 ——',
  loop: '—— 周目转换 ——',
};

/** 终局说明文本（endReason + endingId → 展示文案；纯函数便于测试与复用） */
export function describeEnding(
  endReason: NarrativeSegmentEndReason | undefined,
  endingId: string | undefined,
  labels: Required<NarrativeLabels>,
): string {
  switch (endReason) {
    case 'ending':
      return labels.ending.replace('{ending}', endingId ?? '');
    case 'back':
      return labels.back;
    case 'loop':
      return labels.loop;
    default:
      return labels.end;
  }
}

/** 会话终局类型（与引擎 NarrativeEndReason 同口径） */
export type NarrativeSegmentEndReason = 'exhausted' | 'ending' | 'back' | 'loop';
