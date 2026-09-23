import type { CSSProperties, ReactNode } from 'react';
import type { HistoryGroup } from './history-projection.js';

/**
 * 历史回看面板（设计 §6.4 / FR-READ-04，25 号 B1）。
 *
 * 数据面 = 宿主的 `history()` 投影（`projectHistory`：按「场景 + 游戏日」分组，
 * 数据源为 SceneRunner 环形缓冲 500 段）。本面板只承担 UI：
 * 分组标题（场景 + 日期）、段落列表、回退入口。
 *
 * 受控契约（与 QuestLogPanel 同规）：
 * - 全部数据经 props 注入，面板不持有运行时引用；
 * - 回退经 `onRollback(steps)` 回调请求（步数由「本组之前的分组数」推导，
 *   玩家点某组标题的「回到这里」即回退到该组之前的检查点数量）。
 *
 * 性能：单次会话最多 500 段——规模可控，先用普通列表（虚拟化列在
 * `docs/plans/M2-stage5-qol-plan.md` 登记为「内容规模增长后再引入」）。
 */

/** 文案注入（缺省中文可用性回退；D4：正式文案由宿主提供） */
export interface HistoryPanelLabels {
  readonly title?: string;
  /** 分组标题模板（`{scene}` / `{day}` 占位） */
  readonly groupTitle?: string;
  /** 回退按钮（`{steps}` 占位） */
  readonly rollbackTo?: string;
  /** 空态 */
  readonly empty?: string;
}

const DEFAULT_LABELS: Required<HistoryPanelLabels> = {
  title: '历史',
  groupTitle: '第{day}天 · {scene}',
  rollbackTo: '回退 {steps} 步到这里',
  empty: '暂无历史记录',
};

export interface HistoryPanelProps {
  /** 分组历史（宿主 history() 投影） */
  readonly groups: readonly HistoryGroup[];
  /**
   * 回退请求：steps = 该组之前的选择步数（1 起；0 表示已在最前，不渲染按钮）。
   * 口径甲（2026-09-23 裁定）：状态精确还原，叙事位置回入口场景。
   */
  readonly onRollback?: (steps: number) => void;
  /** 回滚是否可用（宿主据 rollback 栈状态传入；false 时按钮禁用） */
  readonly canRollback?: boolean;
  readonly labels?: HistoryPanelLabels;
}

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  overflowY: 'auto',
};

const GROUP_STYLE: CSSProperties = {
  borderBottom: '1px solid rgba(128, 128, 128, 0.25)',
  paddingBottom: '6px',
};

const GROUP_HEAD_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '8px',
  fontSize: '0.85em',
  opacity: 0.8,
};

const ENTRY_STYLE: CSSProperties = {
  margin: '4px 0 0',
  whiteSpace: 'pre-wrap',
  lineHeight: 1.5,
};

/**
 * 历史回看面板。
 *
 * 「回退到这里」按钮的可用性：
 * - `canRollback === false`（回滚栈空）→ 全部按钮禁用；
 * - 组内步数 0（当前所在组）→ 不渲染按钮（无处可退）。
 */
export function HistoryPanel(props: HistoryPanelProps): ReactNode {
  const labels: Required<HistoryPanelLabels> = { ...DEFAULT_LABELS, ...props.labels };
  const groups = props.groups;
  if (groups.length === 0) {
    return (
      <section style={PANEL_STYLE} aria-label={labels.title}>
        <h3 style={{ margin: 0, fontSize: '1em' }}>{labels.title}</h3>
        <p style={{ margin: 0, opacity: 0.7 }}>{labels.empty}</p>
      </section>
    );
  }
  const lastIndex = groups.length - 1;
  return (
    <section style={PANEL_STYLE} aria-label={labels.title}>
      <h3 style={{ margin: 0, fontSize: '1em' }}>{labels.title}</h3>
      {groups.map((group, index) => {
        // 步数 = 该组之后的分组数（每换一场景/跨一天至少一次选择——
        // 精确步数与 checkpoints 的对应关系由宿主保证；此处用组距近似并以
        // 宿主 canRollback 兜底）
        const steps = lastIndex - index;
        const title = labels.groupTitle
          .replace('{day}', String(group.day))
          .replace('{scene}', group.sceneId);
        return (
          <div key={`${group.sceneId}-${group.day}-${index}`} style={GROUP_STYLE}>
            <div style={GROUP_HEAD_STYLE}>
              <span>{title}</span>
              {steps > 0 && props.onRollback !== undefined ? (
                <button
                  type="button"
                  disabled={props.canRollback === false}
                  onClick={() => props.onRollback?.(steps)}
                  style={{ minHeight: '32px', cursor: 'pointer' }}
                >
                  {labels.rollbackTo.replace('{steps}', String(steps))}
                </button>
              ) : null}
            </div>
            {group.entries.map((entry) => (
              <p key={entry.seq} style={ENTRY_STYLE}>
                {entry.text}
              </p>
            ))}
          </div>
        );
      })}
    </section>
  );
}
