import type { CSSProperties, ReactNode } from 'react';
import type { AchievementGalleryEntry } from '@game/engine';
import type { AchievementGalleryGroup, AchievementGalleryView } from './achievements-projection.js';
import { progressPercent } from './achievements-projection.js';

/**
 * 成就图鉴面板（设计 §6.4 / FR-ACHV-04，25 号 C1）。
 *
 * 数据面 = 宿主投影的 {@link AchievementGalleryView}（引擎 `gallery()` +
 * Profile 已解锁集合）。本面板只承担渲染：
 * 分组、隐藏占位、进度条、收集率摘要。
 *
 * 受控契约（与既有面板同规）：全部数据经 props 注入；`resolveName` 由宿主
 * 提供（文本物化入口，未提供时回落到 key 显示）。
 *
 * 隐藏成就的呈现（FR-ACHV-04）：未解锁的 hidden 条目不显示名称与条件，
 * 仅显示占位（「???」）——**存在性以外零信息**（由引擎 gallery 保证数据面
 * 不下发 nameKey）。
 */

/** 文案注入（缺省中文可用性回退） */
export interface AchievementGalleryLabels {
  readonly title?: string;
  /** 收集率模板（`{unlocked}` / `{total}` / `{percent}` 占位） */
  readonly rate?: string;
  /** 隐藏成就占位 */
  readonly hiddenEntry?: string;
  /** 已解锁标记 */
  readonly unlockedTag?: string;
  readonly empty?: string;
  /** 分数展示（`{points}` 占位） */
  readonly points?: string;
  /** 分组标题（缺省用分组名） */
  readonly groupNames?: Readonly<Record<string, string>>;
}

const DEFAULT_LABELS: Required<Omit<AchievementGalleryLabels, 'groupNames'>> = {
  title: '成就',
  rate: '已解锁 {unlocked}/{total}（{percent}%）',
  hiddenEntry: '???',
  unlockedTag: '已解锁',
  empty: '暂无成就',
  points: '{points} 点',
};

export interface AchievementGalleryPanelProps {
  readonly view: AchievementGalleryView;
  /** 名称物化（成就 nameKey → 展示文本；缺省显示 key） */
  readonly resolveName?: (key: string) => string;
  readonly labels?: AchievementGalleryLabels;
}

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  overflowY: 'auto',
};

const GROUP_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px' };

const ENTRY_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  padding: '6px 8px',
  borderRadius: '4px',
  background: 'rgba(128, 128, 128, 0.08)',
};

const BAR_OUTER_STYLE: CSSProperties = {
  height: '6px',
  borderRadius: '3px',
  background: 'rgba(128, 128, 128, 0.25)',
  overflow: 'hidden',
};

/** 单条成就（已解锁 / 隐藏占位 / 普通未解锁三种呈现） */
function AchievementRow(props: {
  readonly entry: AchievementGalleryEntry;
  readonly labels: Required<Omit<AchievementGalleryLabels, 'groupNames'>>;
  readonly resolveName?: (key: string) => string;
}): ReactNode {
  const { entry, labels, resolveName } = props;
  // 隐藏且未解锁：仅占位（数据面无 nameKey，展示面零额外信息）
  if (entry.hidden) {
    return (
      <div style={{ ...ENTRY_STYLE, opacity: 0.6 }}>
        <span>{labels.hiddenEntry}</span>
      </div>
    );
  }
  const name =
    entry.nameKey !== undefined ? (resolveName?.(entry.nameKey) ?? entry.nameKey) : entry.id;
  const percent = progressPercent(entry.progress);
  return (
    <div style={{ ...ENTRY_STYLE, opacity: entry.unlocked ? 1 : 0.75 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
        <span>
          {name}
          {entry.unlocked ? ` · ${labels.unlockedTag}` : ''}
        </span>
        <span style={{ opacity: 0.75 }}>
          {labels.points.replace('{points}', String(entry.points))}
        </span>
      </div>
      {percent !== null ? (
        <>
          <div
            style={BAR_OUTER_STYLE}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div style={{ width: `${percent}%`, height: '100%', background: 'currentColor' }} />
          </div>
          <span style={{ fontSize: '0.8em', opacity: 0.75 }}>
            {entry.progress?.cur ?? 0} / {entry.progress?.goal ?? 0}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** 图鉴面板 */
export function AchievementGalleryPanel(props: AchievementGalleryPanelProps): ReactNode {
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const { view } = props;
  if (view.groups.length === 0) {
    return (
      <section style={PANEL_STYLE} aria-label={labels.title}>
        <h3 style={{ margin: 0, fontSize: '1em' }}>{labels.title}</h3>
        <p style={{ margin: 0, opacity: 0.7 }}>{labels.empty}</p>
      </section>
    );
  }
  const percent = Math.round(view.rate.rate * 100);
  return (
    <section style={PANEL_STYLE} aria-label={labels.title}>
      <h3 style={{ margin: 0, fontSize: '1em' }}>{labels.title}</h3>
      <p style={{ margin: 0, opacity: 0.8 }}>
        {labels.rate
          .replace('{unlocked}', String(view.rate.unlocked))
          .replace('{total}', String(view.rate.total))
          .replace('{percent}', String(percent))}
      </p>
      {view.groups.map((group) => (
        <div key={group.group} style={GROUP_STYLE}>
          <h4 style={{ margin: 0, fontSize: '0.9em', opacity: 0.85 }}>
            {(props.labels?.groupNames?.[group.group] ?? group.group) +
              ` (${group.unlocked}/${group.total})`}
          </h4>
          {group.entries.map((entry) => (
            <AchievementRow
              key={entry.id}
              entry={entry}
              labels={labels}
              {...(props.resolveName !== undefined ? { resolveName: props.resolveName } : {})}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

export type { AchievementGalleryGroup };
