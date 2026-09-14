import type { CSSProperties, ReactNode } from 'react';
import type { TextResolver } from '@game/engine';
import { RichText } from '../text/RichText.js';
import { sanitizeRichText } from '../text/sanitize.js';
import { sliceRichTextNodes } from '../text/typewriter.js';
import { TOUCH_TARGET_PX } from '../app/AppShell.js';
import { DEFAULT_NARRATIVE_LABELS, describeEnding } from './types.js';
import type {
  NarrativeLabels,
  NarrativeSegmentEndReason,
  NarrativeSegmentView,
  OptionView,
} from './types.js';

/**
 * 叙事视图与选项列表（设计 §6.2 组件契约；FR-READ-03/05）。
 *
 * 设计要点：
 * - **props 受控**：段落/选项/相位/揭示进度都由调用方给出，组件自身不读
 *   store、不持有会话；交互只经 `onAdvance` / `onChoice` 回调（唯一入口，
 *   宿主在此挂 checkpoint，FR-READ-03）；
 * - 文本经引擎 `TextResolver` 物化后交 {@link RichText} / {@link TypewriterText}
 *   渲染（sanitize 在同一路径内，NFR-18）；
 * - 打字机只作用于**最后一段**（新揭示的段落）：已读段落保持完整，符合
 *   「已读跳过」与回看的直觉（FR-READ-01/04）；
 * - 排版（字号/行距）经 CSS 变量下发（FR-READ-05 即时生效，无需重建组件）。
 */

/** NarrativeView 属性（全部受控） */
export interface NarrativeViewProps {
  /** 段落流（renderList 快照；含已揭示前缀） */
  readonly segments: readonly NarrativeSegmentView[];
  /** 引擎文本解析器（插值唯一入口） */
  readonly resolver: TextResolver;
  /** 当前语言（FR-L10N-05） */
  readonly lang: string;
  /** 文本速度（`settings.textSpeed`；≤0 或 reduced-motion 时全部段落直接全显） */
  readonly textSpeed: number;
  /** 最后一段已揭示的字符数（宿主经 useTypewriter(textSpeed) 推进，FR-READ-05） */
  readonly revealed: number;
  /** 会话相位（决定底部交互面；缺省不渲染任何交互） */
  readonly phase?: 'entering' | 'await_advance' | 'await_choice' | 'resolving' | 'finished';
  /** 推进回调（await_advance 相位的唯一入口） */
  readonly onAdvance?: () => void;
  /** 终局类型（finished 相位） */
  readonly endReason?: NarrativeSegmentEndReason;
  /** 结局 id（endReason='ending'） */
  readonly endingId?: string;
  /** 字号（px；FR-READ-05，经 CSS 变量下发） */
  readonly fontSize?: number;
  /** 行距（倍数；FR-READ-05） */
  readonly lineHeight?: number;
  /** 文案注入（可部分覆盖） */
  readonly labels?: NarrativeLabels;
  /** 选项区（由宿主组装 OptionList；放在叙事区底部保持阅读流位置稳定） */
  readonly options?: ReactNode;
}

/**
 * 叙事区（见模块 TSDoc）。
 *
 * 段落渲染规则：
 * - `kind='spacing'` → 空占位块（视觉段落间距）；
 * - `kind='image'` → 媒体意图标注（`missing` 时提示缺失，FR-MEDIA-06）；
 * - `kind='text'` → resolver 物化 + sanitize 渲染；**索引最后一段**使用
 *   打字机，其余段落全显。
 */
export function NarrativeView(props: NarrativeViewProps): ReactNode {
  const labels = { ...DEFAULT_NARRATIVE_LABELS, ...props.labels };
  const lastIndex = props.segments.length - 1;
  const style: CSSProperties = {
    ...styles.root,
    ...(props.fontSize !== undefined
      ? { ['--narrative-font-size' as string]: `${props.fontSize}px` }
      : {}),
    ...(props.lineHeight !== undefined
      ? { ['--narrative-line-height' as string]: String(props.lineHeight) }
      : {}),
  };

  return (
    <div style={style} data-phase={props.phase ?? ''}>
      <div style={styles.segments} aria-live="polite">
        {props.segments.map((segment, index) =>
          renderSegment(
            segment,
            index === lastIndex ? props.revealed : Number.POSITIVE_INFINITY,
            props,
          ),
        )}
      </div>
      {props.phase === 'finished' ? (
        <div style={styles.end}>{describeEnding(props.endReason, props.endingId, labels)}</div>
      ) : null}
      {props.options}
      {props.phase === 'await_advance' && props.onAdvance !== undefined ? (
        <button
          type="button"
          data-action="advance"
          onClick={props.onAdvance}
          style={styles.advanceButton}
        >
          {labels.advance}
        </button>
      ) : null}
    </div>
  );
}

/** 单段渲染（揭示预算仅影响最后一段；其余段传 Infinity 即全显） */
function renderSegment(
  segment: NarrativeSegmentView,
  revealed: number,
  props: NarrativeViewProps,
): ReactNode {
  if (segment.kind === 'spacing') {
    return <div key={segmentKey(segment)} style={styles.spacing} aria-hidden="true" />;
  }
  if (segment.kind === 'image') {
    return (
      <div key={segmentKey(segment)} style={styles.mediaMark}>
        {(segment.media ?? []).map((intent, index) => (
          <div key={`${intent.assetId}-${index}`}>
            {`[媒体 ${intent.type}: ${intent.assetId}]`}
            {intent.missing === true ? ' （资源缺失）' : ''}
          </div>
        ))}
      </div>
    );
  }
  const key = segment.key ?? '';
  const text = segment.literal ?? props.resolver.resolve(key, props.lang, varsOf(segment)).text;
  if (revealed === Number.POSITIVE_INFINITY) {
    return (
      <div key={segmentKey(segment)} style={styles.paragraph}>
        <RichText text={text} as="p" className="narrative-paragraph" />
      </div>
    );
  }
  // 最后一段按宿主持有的字符预算裁剪（受控：进度归宿主，组件不持定时器）
  const nodes = sliceRichTextNodes(sanitizeRichText(text), revealed);
  return (
    <div key={segmentKey(segment)} style={styles.paragraph}>
      <RichText nodes={nodes} as="p" className="narrative-paragraph" />
    </div>
  );
}

/** 段落键（React 列表 key：键缺失时用媒体首项或序号占位） */
function segmentKey(segment: NarrativeSegmentView): string {
  return segment.key ?? segment.media?.[0]?.assetId ?? segment.kind;
}

/** 取段落插值变量（函数形态逐次求值，FR-NARR-04） */
function varsOf(segment: NarrativeSegmentView): Readonly<Record<string, unknown>> | undefined {
  if (segment.vars === undefined) return undefined;
  return typeof segment.vars === 'function' ? segment.vars() : segment.vars;
}

/**
 * 选项列表（FR-READ-03 的唯一交互入口）。
 *
 * 渲染规则：
 * - `hiddenByFilter` 的选项**不渲染**（FR-CGRD-03 应用点 3）；
 * - `enabled=false` 的选项渲染为禁用按钮并在下方显示原因（可见不可点）；
 * - 点击经 `onChoice(id)` 回调——checkpoint 由宿主在该回调内完成
 *   （{@link withChoiceCheckpoint}），组件不接触运行时（保持可测与受控）。
 */
export function OptionList({
  choices,
  resolver,
  lang,
  onChoice,
}: {
  readonly choices: readonly OptionView[];
  readonly resolver: TextResolver;
  readonly lang: string;
  readonly onChoice: (id: string) => void;
}): ReactNode {
  const visible = choices.filter((choice) => choice.hiddenByFilter !== true);
  return (
    <div style={styles.options} role="group" aria-label="选项">
      {visible.map((choice) => {
        const label = resolver.resolve(choice.textKey, lang).text;
        const reason =
          choice.enabled || choice.disabledReasonKey === undefined
            ? undefined
            : resolver.resolve(choice.disabledReasonKey, lang).text;
        return (
          <button
            key={choice.id}
            type="button"
            data-choice={choice.id}
            disabled={!choice.enabled}
            onClick={() => onChoice(choice.id)}
            style={styles.optionButton}
          >
            <span style={styles.optionLabel}>{label}</span>
            {reason !== undefined ? <span style={styles.optionReason}>{reason}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** 样式（内联；只锁定触控尺寸与阅读流结构这类契约性属性） */
const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    // 排版经 CSS 变量下发；组件不硬编码消费方，主题可覆盖（FR-READ-05）
    fontSize: 'var(--narrative-font-size, 16px)',
    lineHeight: 'var(--narrative-line-height, 1.8)',
  },
  segments: { display: 'flex', flexDirection: 'column', gap: '4px' },
  paragraph: { margin: 0 },
  spacing: { height: '0.6em' },
  mediaMark: { fontSize: '13px', opacity: 0.7, fontStyle: 'italic' },
  end: { opacity: 0.85, fontStyle: 'italic' },
  options: { display: 'flex', flexDirection: 'column', gap: '8px' },
  optionButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    minHeight: `${TOUCH_TARGET_PX}px`,
    padding: '8px 16px',
    fontSize: '15px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  optionLabel: { display: 'block' },
  optionReason: { display: 'block', fontSize: '12px', opacity: 0.72 },
  advanceButton: {
    minHeight: `${TOUCH_TARGET_PX}px`,
    padding: '8px 16px',
    fontSize: '15px',
    cursor: 'pointer',
  },
};
