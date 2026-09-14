import type { CSSProperties, ReactNode } from 'react';

/**
 * 隐私模式降级横幅（设计 §6.7 / NFR-10）。
 *
 * 语义：IndexedDB 不可用（隐私模式等）时**常驻**提示——数据仅存于本次会话，
 * 请及时导出存档。刻意不提供关闭按钮：关闭横幅等价于默许丢档，与 NFR-10
 * 「不静默丢档」相悖。
 *
 * 契约：`degraded=false` 时不渲染任何节点（零占位）；文案可注入（D4 边界），
 * 缺省中文为可用性回退。
 */

/** 横幅文案（可注入本地化） */
export interface PrivacyBannerLabels {
  /** 主文案模板（`{reason}` 占位替换为探测原因） */
  readonly message?: string;
  /** 行动指引（缺省「请及时导出存档」） */
  readonly action?: string;
  /** 导出按钮文案（提供 onExport 时使用） */
  readonly exportLabel?: string;
}

/** 缺省文案（D4 边界：正式文案由宿主注入） */
const DEFAULT_LABELS: Required<PrivacyBannerLabels> = {
  message: '浏览器存储不可用（{reason}），本次进度不会保留。',
  action: '请及时导出存档。',
  exportLabel: '导出存档',
};

/** PrivacyBanner 属性（受控） */
export interface PrivacyBannerProps {
  /** 是否处于降级态（false 时不渲染） */
  readonly degraded: boolean;
  /** 降级原因（探测结果；缺省给通用文案） */
  readonly reason?: string;
  /** 导出入口（可选；提供时渲染为按钮） */
  readonly onExport?: () => void;
  /** 文案注入 */
  readonly labels?: PrivacyBannerLabels;
}

/**
 * 隐私模式降级横幅（见模块 TSDoc）。
 *
 * 无障碍：以 `role="status"` 暴露（读屏播报一次，非打断式 alert）。
 */
export function PrivacyBanner(props: PrivacyBannerProps): ReactNode {
  if (!props.degraded) return null;
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const message = labels.message.replace('{reason}', props.reason ?? '浏览器存储不可用');
  return (
    <div role="status" style={styles.root}>
      <span style={styles.message}>{message}</span>
      <span style={styles.action}>{labels.action}</span>
      {props.onExport !== undefined ? (
        <button type="button" onClick={props.onExport} style={styles.button}>
          {labels.exportLabel}
        </button>
      ) : null}
    </div>
  );
}

/** 样式（内联；仅锁定结构，配色交主题） */
const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    fontSize: '13px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'currentColor',
    borderRadius: '6px',
  },
  message: { fontWeight: 600 },
  action: { opacity: 0.85 },
  button: { minHeight: '32px', padding: '4px 10px', fontSize: '13px', cursor: 'pointer' },
};
