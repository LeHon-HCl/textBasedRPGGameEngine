import type { CSSProperties, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import type { ContentTagDef, TextKey } from '@game/shared';
import { TOUCH_TARGET_PX } from '../app/AppShell.js';

/**
 * 首启内容向导（设计 §6.5 末段 / FR-CGRD-04）。
 *
 * 流程：内容警告页（`manifest.contentWarning` 文案键物化）→ 标签开关
 * （初始态由 `ContentFilter.initialDisabledTags()` 投影）→ 确认 / 跳过。
 *
 * 语义要点（FR-CGRD-04「可跳过、可在设置中修改」）：
 * - **跳过 ≠ 丢弃选择**：跳过同样提交当前开关态。否则「默认关闭」的标签会被
 *   静默打开——那是隐私语义的反转（玩家没关过却被放行），比缺一个开关更糟；
 * - 向导只报告 `disabledTags`，写 `settings.wizardDone` 与重建 ContentFilter
 *   归宿主（§6.5「标签开关变更 → 重建 ContentFilter」）；
 * - 数据投影（needed / warningKey）由引擎 `resolveContentWizard` 提供，本组件
 *   不重复判断「是否需要展示」——宿主按 `needed` 决定是否挂载。
 */

/** 向导文案（可注入本地化） */
export interface ContentWizardLabels {
  readonly title?: string;
  readonly tagsTitle?: string;
  readonly confirm?: string;
  readonly skip?: string;
  readonly tagsHint?: string;
}

/** 缺省文案（D4 边界：正式文案由宿主注入） */
const DEFAULT_LABELS: Required<ContentWizardLabels> = {
  title: '内容提示',
  tagsTitle: '内容标签',
  confirm: '我已知悉，开始游戏',
  skip: '跳过',
  tagsHint: '可随时在设置中修改。',
};

/** ContentWizard 属性（受控） */
export interface ContentWizardProps {
  /**
   * 内容警告页文案键（`manifest.contentWarning`，引擎 resolveContentWizard 产物）。
   * 游戏未声明时为 null——不展示警告页，但开关流程照常（不因缺文案中断）。
   */
  readonly warningKey: TextKey | null;
  /** 内容标签目录（`ContentTagsDef.tags`，FR-CGRD-01） */
  readonly tags: readonly ContentTagDef[];
  /** 初始禁用集（`ContentFilter.initialDisabledTags()` 的投影，FR-CGRD-04 数据支撑） */
  readonly initialDisabledTags: readonly string[];
  /** 文本键物化（警告文案与标签名） */
  readonly nameOf: (key: string) => string;
  /** 确认（宿主写 wizardDone + 应用 disabledTags + 重建 ContentFilter） */
  readonly onConfirm: (result: { disabledTags: string[] }) => void;
  /** 跳过（仍提交当前开关态——见模块 TSDoc） */
  readonly onSkip: (result: { disabledTags: string[] }) => void;
  /** 文案注入 */
  readonly labels?: ContentWizardLabels;
}

/**
 * 首启内容向导（见模块 TSDoc）。
 *
 * 开关状态是**组件内**的临时编辑态（尚未落到 settings），确认/跳过时一次性
 * 提交；这与其他面板的「即时受控」不同——向导是提交式表单流程。
 */
export function ContentWizard(props: ContentWizardProps): ReactNode {
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const [disabled, setDisabled] = useState<readonly string[]>(props.initialDisabledTags);
  const disabledSet = useMemo(() => new Set(disabled), [disabled]);

  /** 翻转单个标签：产出新的禁用集（不原地改） */
  const toggle = (tagId: string): void => {
    setDisabled((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  };

  return (
    <div style={styles.root}>
      <h1 style={styles.title}>{labels.title}</h1>

      {props.warningKey !== null ? (
        <p style={styles.warning}>{props.nameOf(props.warningKey)}</p>
      ) : null}

      {props.tags.length > 0 ? (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>{labels.tagsTitle}</h2>
          <p style={styles.hint}>{labels.tagsHint}</p>
          {props.tags.map((tag) => {
            const label = props.nameOf(tag.nameKey);
            return (
              <label key={tag.id} style={styles.tagRow}>
                <input
                  aria-label={label}
                  type="checkbox"
                  checked={!disabledSet.has(tag.id)}
                  onChange={() => toggle(tag.id)}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </section>
      ) : null}

      <div style={styles.actions}>
        <button
          type="button"
          data-action="confirm"
          onClick={() => props.onConfirm({ disabledTags: [...disabled] })}
          style={styles.primaryButton}
        >
          {labels.confirm}
        </button>
        <button
          type="button"
          data-action="skip"
          onClick={() => props.onSkip({ disabledTags: [...disabled] })}
          style={styles.button}
        >
          {labels.skip}
        </button>
      </div>
    </div>
  );
}

/** 样式（内联；只锁定触控尺寸与纵向流程结构这类契约性属性） */
const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '24px 20px',
    maxWidth: '560px',
    margin: '0 auto',
    boxSizing: 'border-box',
  },
  title: { margin: 0, fontSize: '22px', fontWeight: 700 },
  warning: { margin: 0, fontSize: '15px', lineHeight: 1.8 },
  section: { display: 'flex', flexDirection: 'column', gap: '8px' },
  sectionTitle: { margin: 0, fontSize: '15px', fontWeight: 600, opacity: 0.85 },
  hint: { margin: 0, fontSize: '12px', opacity: 0.7 },
  tagRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: `${TOUCH_TARGET_PX}px`,
    fontSize: '14px',
  },
  actions: { display: 'flex', flexDirection: 'column', gap: '8px' },
  button: {
    minHeight: `${TOUCH_TARGET_PX}px`,
    padding: '10px 16px',
    fontSize: '15px',
    cursor: 'pointer',
  },
  primaryButton: {
    minHeight: `${TOUCH_TARGET_PX}px`,
    padding: '10px 16px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
