import type { CSSProperties, ReactNode } from 'react';
import type { QuestLogEntry, QuestLogView } from '@game/engine';
import { TOUCH_TARGET_PX } from '../app/AppShell.js';

/**
 * 任务日志面板（设计 §6.4 / FR-QUEST-03 UI 侧）。
 *
 * 数据面由引擎 `projectQuestLog` 提供（11 号产物：按状态分组 + 追踪置顶 +
 * 上限策略）；本面板只承担 UI：组标题、目标文本、giver/接取日/地点指引，
 * 以及追踪开关的受控呈现。
 *
 * 为什么追踪状态不在面板内部：追踪是 **UI 状态**（§4.5「追踪为 UI 状态，
 * 引擎只投影」，不入存档）——由宿主持有并持久化到设置/本地存储，面板仅
 * 经 `tracked` 读取、经 `onToggleTrack` 回调请求变更（受控组件契约）。
 */

/** 任务状态分组标题（可注入本地化；缺省中文可用性回退） */
export interface QuestLogLabels {
  /** 面板标题（缺省「任务」；与 StatusPanel/MapPanel 的面板级标题同规） */
  readonly title?: string;
  readonly tracked?: string;
  readonly active?: string;
  readonly ready_to_submit?: string;
  readonly available?: string;
  readonly done?: string;
  readonly failed?: string;
  readonly undiscovered?: string;
  /** 追踪开关：加入 / 取消 */
  readonly track?: string;
  readonly untrack?: string;
  /** 接取日模板（`{day}` 占位） */
  readonly startedAt?: string;
  /** 发布者模板（`{npc}` 占位） */
  readonly giver?: string;
  /** 空态提示（无任何任务时显示，缺省「暂无任务」） */
  readonly empty?: string;
}

/** 缺省文案（D4 边界：正式文案由宿主注入） */
const DEFAULT_LABELS: Required<QuestLogLabels> = {
  title: '任务',
  tracked: '追踪中',
  active: '进行中',
  ready_to_submit: '待提交',
  available: '可接取',
  done: '已完成',
  failed: '已失败',
  undiscovered: '未发现',
  track: '追踪',
  untrack: '取消追踪',
  startedAt: '第 {day} 天接取',
  giver: '委托人：{npc}',
  empty: '暂无任务',
};

/** 状态 → 缺省标题键（覆盖 labels 未提供的状态） */
const STATE_LABEL_KEYS: Record<QuestLogEntry['state'], keyof Required<QuestLogLabels>> = {
  active: 'active',
  ready_to_submit: 'ready_to_submit',
  available: 'available',
  done: 'done',
  failed: 'failed',
  undiscovered: 'undiscovered',
};

/** QuestLogPanel 属性（受控） */
export interface QuestLogPanelProps {
  /** 任务日志投影（引擎 projectQuestLog 产物） */
  readonly view: QuestLogView;
  /** 文本键物化（通常为 `(key) => resolver.resolve(key, lang).text`） */
  readonly nameOf: (key: string) => string;
  /** 追踪中的任务 id（顺序即置顶顺序；上限策略由宿主消费 projectQuestLog 参数决定） */
  readonly tracked: readonly string[];
  /** 追踪开关回调（缺省不渲染开关 —— 纯浏览态） */
  readonly onToggleTrack?: (questId: string) => void;
  /** 任务 id → 地点指引文本（缺省不渲染；数据源为宿主的任务/地点关联） */
  readonly locationHintOf?: (questId: string) => string | undefined;
  /** 文案注入 */
  readonly labels?: QuestLogLabels;
}

/**
 * 任务日志面板（见模块 TSDoc）。
 *
 * 呈现细节：
 * - **面板级标题（`labels.title`）恒渲染**——与 StatusPanel/MapPanel 同规：
 *   三面板在宽屏侧栏并排，缺标题会让空任务日志整块「无字可认」
 *   （2026-09-15 用户实测：宽屏看不到「任务」，窄屏 Tab 有标签）；
 * - 追踪条目只在置顶区渲染（不在分组内重复，避免同一任务出现两次）；
 * - 空分组/空追踪区不渲染分组标题（无噪声）；
 * - 无任何任务时给一行空态提示（否则面板只剩标题）；
 * - `objectiveKey` 经 `nameOf` 物化（D4：数据与文本分离）。
 */
export function QuestLogPanel(props: QuestLogPanelProps): ReactNode {
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const trackedIds = new Set(props.tracked);
  /** 追踪区条目按 tracked 顺序（视图已按调用方顺序置顶，此处原样消费） */
  const trackedEntries = props.view.tracked;
  const hasAnyEntry =
    trackedEntries.length > 0 || props.view.groups.some((group) => group.entries.length > 0);

  return (
    <section style={styles.root}>
      <h3 style={styles.title}>{labels.title}</h3>
      {hasAnyEntry ? null : <p style={styles.empty}>{labels.empty}</p>}

      {trackedEntries.length > 0 ? (
        <div style={styles.group}>
          <h3 style={styles.groupTitle}>{labels.tracked}</h3>
          {trackedEntries.map((entry) => renderEntry(entry, props, labels, true))}
        </div>
      ) : null}

      {props.view.groups.map((group) => {
        // 已在追踪区渲染的条目不重复列出（同一任务只出现一次）
        const entries = group.entries.filter((entry) => !trackedIds.has(entry.quest));
        if (entries.length === 0) return null;
        return (
          <div key={group.state} style={styles.group}>
            <h3 style={styles.groupTitle}>{labels[STATE_LABEL_KEYS[group.state]]}</h3>
            {entries.map((entry) => renderEntry(entry, props, labels, false))}
          </div>
        );
      })}
    </section>
  );
}

/** 单条任务条目（目标文本 + giver/接取日/地点指引 + 追踪开关） */
function renderEntry(
  entry: QuestLogEntry,
  props: QuestLogPanelProps,
  labels: Required<QuestLogLabels>,
  tracked: boolean,
): ReactNode {
  const locationHint = props.locationHintOf?.(entry.quest);
  return (
    <div key={entry.quest} style={styles.entry} data-quest={entry.quest} data-state={entry.state}>
      <div style={styles.entryMain}>
        <span style={styles.questName}>{props.nameOf(`quests.${entry.quest}.name`)}</span>
        {entry.objectiveKey !== undefined ? (
          <span style={styles.objective}>{props.nameOf(entry.objectiveKey)}</span>
        ) : null}
        <span style={styles.meta}>
          {entry.giver !== undefined
            ? labels.giver.replace('{npc}', props.nameOf(`npcs.${entry.giver}.name`))
            : ''}
          {entry.giver !== undefined && entry.startedDay !== undefined ? ' · ' : ''}
          {entry.startedDay !== undefined
            ? labels.startedAt.replace('{day}', String(entry.startedDay))
            : ''}
        </span>
        {locationHint !== undefined ? <span style={styles.meta}>{locationHint}</span> : null}
      </div>
      {props.onToggleTrack !== undefined ? (
        <button
          type="button"
          data-track={entry.quest}
          onClick={() => props.onToggleTrack?.(entry.quest)}
          style={styles.trackButton}
        >
          {tracked ? labels.untrack : labels.track}
        </button>
      ) : null}
    </div>
  );
}

/** 样式（内联；只锁定触控尺寸与列表结构这类契约性属性） */
const styles: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: '12px' },
  title: { margin: 0, fontSize: '14px', fontWeight: 600, opacity: 0.8 },
  empty: { margin: 0, fontSize: '13px', opacity: 0.6 },
  group: { display: 'flex', flexDirection: 'column', gap: '6px' },
  groupTitle: { margin: 0, fontSize: '14px', fontWeight: 600, opacity: 0.8 },
  entry: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '6px 0',
  },
  entryMain: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  questName: { fontSize: '14px', fontWeight: 600 },
  objective: { fontSize: '13px', opacity: 0.85 },
  meta: { fontSize: '12px', opacity: 0.65 },
  trackButton: {
    minHeight: `${TOUCH_TARGET_PX}px`,
    padding: '6px 10px',
    fontSize: '13px',
    cursor: 'pointer',
  },
};
