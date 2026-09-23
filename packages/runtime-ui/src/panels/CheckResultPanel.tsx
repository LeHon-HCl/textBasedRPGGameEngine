import type { CSSProperties, ReactNode } from 'react';
import { usePrefersReducedMotion } from '../text/typewriter.js';

/**
 * 判定呈现（设计 §5.1 / FR-CMBT-05 / NFR-26，25 号 C2）。
 *
 * 数据面 = 引擎 `CheckResultEvent`（`check_result`，含 rolls/level/detail）。
 * 本组件只做呈现：
 * - **骰值明细**（含奖惩骰池原文）、等级徽标（critical/extreme/hard/normal/fail/fumble）、
 *   成功/失败判定；
 * - **动画**：等级徽标淡入 + 骰值逐颗揭示（纯 CSS/定时器，不重排渲染结果）；
 * - **减弱动画降级**（NFR-26）：`prefers-reduced-motion` 命中时全部直接呈现
 *   （无淡入、无逐颗揭示），逻辑与信息完全一致。
 *
 * 与战斗的关系：战斗内的判定同样经本组件呈现（战斗面板嵌它或复用其等级徽标）。
 */

/** 判定结果视图（宿主从 CheckResultEvent 投影；与引擎事件字段同名） */
export interface CheckResultView {
  readonly rule: string;
  readonly outcome: 'success' | 'fail';
  readonly level: string;
  /** 最终骰值 + 骰池明细（[最终值, ...十位骰池, 个位]，见 15 号） */
  readonly rolls: readonly number[];
  /** 阈值/余量等（detail 面；可选展示） */
  readonly skill?: number;
  readonly required?: number;
  readonly margin?: number;
}

/** 文案注入（缺省中文可用性回退） */
export interface CheckResultLabels {
  readonly critical?: string;
  readonly extreme?: string;
  readonly hard?: string;
  readonly normal?: string;
  readonly fail?: string;
  readonly fumble?: string;
  readonly success?: string;
  readonly unsuccessful?: string;
  /** 阈值行模板（`{skill}` / `{required}` / `{margin}` 占位） */
  readonly threshold?: string;
}

const DEFAULT_LABELS: Required<CheckResultLabels> = {
  critical: '大成功',
  extreme: '极难成功',
  hard: '困难成功',
  normal: '成功',
  fail: '失败',
  fumble: '大失败',
  success: '判定通过',
  unsuccessful: '判定未过',
  threshold: '技能 {skill} · 需 ≤ {required} · 余量 {margin}',
};

/** 等级 → 展示标签与强调色（六档；未知等级回落原文） */
function levelBadge(
  level: string,
  labels: Required<CheckResultLabels>,
): { text: string; tone: string } {
  switch (level) {
    case 'critical':
      return { text: labels.critical, tone: 'var(--check-critical, #d4a017)' };
    case 'extreme':
      return { text: labels.extreme, tone: 'var(--check-extreme, #2e8b57)' };
    case 'hard':
      return { text: labels.hard, tone: 'var(--check-hard, #3a7bd5)' };
    case 'normal':
      return { text: labels.normal, tone: 'var(--check-normal, #4a7c59)' };
    case 'fumble':
      return { text: labels.fumble, tone: 'var(--check-fumble, #b03030)' };
    default:
      return { text: labels.fail, tone: 'var(--check-fail, #8a5a44)' };
  }
}

const WRAP_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  padding: '8px 10px',
  borderLeft: '3px solid currentColor',
  background: 'rgba(128, 128, 128, 0.06)',
};

export interface CheckResultPanelProps {
  readonly result: CheckResultView;
  /** 是否启用淡入动画（缺省 true；reduced-motion 时自动关，NFR-26） */
  readonly animated?: boolean;
  readonly labels?: CheckResultLabels;
}

/**
 * 判定结果呈现。
 *
 * 无障碍：整体 `role="status"`（屏幕阅读器可播报判定结果）；
 * 减弱动画时保留全部文本信息与 aria 属性（只有视觉过渡被移除）。
 */
export function CheckResultPanel(props: CheckResultPanelProps): ReactNode {
  const labels: Required<CheckResultLabels> = { ...DEFAULT_LABELS, ...props.labels };
  const reducedMotion = usePrefersReducedMotion();
  const animated = (props.animated ?? true) && !reducedMotion;
  const { result } = props;
  const badge = levelBadge(result.level, labels);
  const [finalRoll, ...poolDetail] = result.rolls;

  return (
    <section
      style={{ ...WRAP_STYLE, color: badge.tone }}
      role="status"
      aria-label={`${badge.text} · ${result.outcome === 'success' ? labels.success : labels.unsuccessful}`}
      data-check-level={result.level}
      data-check-outcome={result.outcome}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <strong
          style={{
            fontSize: '1.05em',
            // 减弱动画：无过渡（直接呈现）；否则淡入
            animation: animated ? 'check-badge-in 240ms ease-out' : undefined,
          }}
        >
          {badge.text}
        </strong>
        <span style={{ opacity: 0.85 }}>
          {result.outcome === 'success' ? labels.success : labels.unsuccessful}
        </span>
        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          🎲 {finalRoll ?? '-'}
        </span>
      </div>
      {poolDetail.length > 0 ? (
        <span style={{ fontSize: '0.82em', opacity: 0.75 }}>
          rolls: [{result.rolls.join(', ')}]
        </span>
      ) : null}
      {result.skill !== undefined && result.required !== undefined ? (
        <span style={{ fontSize: '0.85em', opacity: 0.85 }}>
          {labels.threshold
            .replace('{skill}', String(result.skill))
            .replace('{required}', String(result.required))
            .replace('{margin}', String(result.margin ?? 0))}
        </span>
      ) : null}
    </section>
  );
}

/**
 * 从引擎 `check_result` 事件的 detail 投影视图。
 *
 * detail 面为 `Record<string, unknown>`（15 号的自由结构）——本函数做**防御性
 * 取值**（缺失即不展示对应行，不猜默认值）。
 */
export function checkResultFromEvent(event: {
  readonly rule: string;
  readonly outcome: 'success' | 'fail';
  readonly level: string;
  readonly rolls: readonly number[];
  readonly detail: Readonly<Record<string, unknown>>;
}): CheckResultView {
  const numberOr = (key: string): number | undefined => {
    const value = event.detail[key];
    return typeof value === 'number' ? value : undefined;
  };
  return {
    rule: event.rule,
    outcome: event.outcome,
    level: event.level,
    rolls: event.rolls,
    ...(numberOr('skill') !== undefined ? { skill: numberOr('skill') as number } : {}),
    ...(numberOr('required') !== undefined ? { required: numberOr('required') as number } : {}),
    ...(numberOr('margin') !== undefined ? { margin: numberOr('margin') as number } : {}),
  };
}
