import type { CSSProperties, ReactNode } from 'react';
import { TOUCH_TARGET_PX } from './AppShell.js';
import type { SaveSlotSummary } from '../persistence/types.js';

/**
 * 主菜单（设计 §6.1 组件树 TitleScreen；FR-UI-06）。
 *
 * 六项固定：继续（最近存档）/ 新游戏（含 Perk 选择流程）/ 读档 / 成就 / 设置 / 关于。
 *
 * 契约：
 * - **受控**：组件不读存档适配器、不读 store；最近存档与存档数由宿主持有
 *   （`continueSlot` / `saveCount`），点击只回调；
 * - 禁用不隐藏：「继续」「读档」在无存档时保持可见并给出原因文案
 *   （`emptySaveHint`）——隐藏会让玩家误以为功能不存在；
 * - 文案可注入（`labels`）：主菜单是 D4 的边界——组件不内嵌玩家可见文本，
 *   缺省标签仅作为无语言包时的可用性回退（与「未提供仅显示占位」同口径）。
 */

/** 主菜单按钮标签（可注入本地化文案；缺省中文回退） */
export interface TitleScreenLabels {
  readonly continue?: string;
  readonly newGame?: string;
  readonly load?: string;
  readonly achievements?: string;
  readonly settings?: string;
  readonly about?: string;
  /** 无存档时的原因文案（缺省「暂无存档」） */
  readonly emptySave?: string;
}

/** 主菜单属性（全部受控） */
export interface TitleScreenProps {
  /** 游戏标题（通常为 manifest 派生的显示名） */
  readonly gameTitle: ReactNode;
  /** 最近一次存档（null = 无存档，「继续」禁用） */
  readonly continueSlot: SaveSlotSummary | null;
  /** 存档总数（「读档」可用性与计数展示） */
  readonly saveCount: number;
  readonly onNewGame: () => void;
  readonly onContinue: (slot: SaveSlotSummary) => void;
  readonly onOpenLoad: () => void;
  readonly onOpenAchievements: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenAbout: () => void;
  /** 文案注入（可部分覆盖） */
  readonly labels?: TitleScreenLabels;
  /** 副标题/版本行等附加区（可选） */
  readonly footer?: ReactNode;
}

/** 缺省标签（无语言包时的可用性回退；正式文案由宿主经 labels 注入） */
const DEFAULT_LABELS: Required<TitleScreenLabels> = {
  continue: '继续',
  newGame: '新游戏',
  load: '读档',
  achievements: '成就',
  settings: '设置',
  about: '关于',
  emptySave: '暂无存档',
};

/**
 * 存档摘要文本（「第 N 天 · 第 M 周目」）。
 * 抽为纯函数便于复用与断言（读档列表同口径）。
 */
export function formatSaveSummary(slot: SaveSlotSummary): string {
  return `第 ${slot.day} 天 · 第 ${slot.loop} 周目`;
}

/** 存档显示名（缺省回落到槽位 id，避免空标签按钮） */
export function saveDisplayName(slot: SaveSlotSummary): string {
  return slot.name ?? slot.slot;
}

/** 主菜单六项按钮 id（测试与宿主定位用，稳定不随文案变化） */
export const TITLE_ACTIONS = [
  'continue',
  'newGame',
  'load',
  'achievements',
  'settings',
  'about',
] as const;
export type TitleAction = (typeof TITLE_ACTIONS)[number];

/**
 * 主菜单组件（见模块 TSDoc）。所有按钮 `data-action` 标注动作 id，
 * 使测试与自动化脚本无需依赖（可能被本地化的）按钮文案。
 */
export function TitleScreen(props: TitleScreenProps): ReactNode {
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const slot = props.continueSlot;
  const hasSave = slot !== null;
  const saveHint = hasSave ? null : labels.emptySave;

  return (
    <div style={styles.root}>
      <h1 style={styles.title}>{props.gameTitle}</h1>

      <div style={styles.actions}>
        <button
          type="button"
          data-action="continue"
          disabled={!hasSave}
          onClick={() => {
            if (slot !== null) props.onContinue(slot);
          }}
          style={styles.primaryButton}
        >
          <span style={styles.buttonLabel}>{labels.continue}</span>
          <span style={styles.buttonHint}>
            {slot !== null ? `${saveDisplayName(slot)} · ${formatSaveSummary(slot)}` : saveHint}
          </span>
        </button>

        <button type="button" data-action="newGame" onClick={props.onNewGame} style={styles.button}>
          <span style={styles.buttonLabel}>{labels.newGame}</span>
          <span style={styles.buttonHint}>含 Perk 选择流程</span>
        </button>

        <button
          type="button"
          data-action="load"
          disabled={props.saveCount === 0}
          onClick={props.onOpenLoad}
          style={styles.button}
        >
          <span style={styles.buttonLabel}>{labels.load}</span>
          <span style={styles.buttonHint}>
            {props.saveCount > 0 ? `共 ${props.saveCount} 个存档` : saveHint}
          </span>
        </button>

        <button
          type="button"
          data-action="achievements"
          onClick={props.onOpenAchievements}
          style={styles.button}
        >
          <span style={styles.buttonLabel}>{labels.achievements}</span>
        </button>

        <button
          type="button"
          data-action="settings"
          onClick={props.onOpenSettings}
          style={styles.button}
        >
          <span style={styles.buttonLabel}>{labels.settings}</span>
        </button>

        <button type="button" data-action="about" onClick={props.onOpenAbout} style={styles.button}>
          <span style={styles.buttonLabel}>{labels.about}</span>
        </button>
      </div>

      {props.footer !== undefined ? <div style={styles.footer}>{props.footer}</div> : null}
    </div>
  );
}

/**
 * 主菜单样式（内联；只锁定触控尺寸与纵向排布这些契约性属性）。
 * 触控目标 ≥ {@link TOUCH_TARGET_PX}（NFR-26）。
 */
const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '24px',
    padding: '32px 20px',
    minHeight: '100%',
    boxSizing: 'border-box',
  },
  title: { fontSize: '28px', fontWeight: 700, margin: 0, textAlign: 'center' },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
    maxWidth: '360px',
  },
  button: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    minHeight: `${TOUCH_TARGET_PX}px`,
    padding: '8px 16px',
    fontSize: '16px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  primaryButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    minHeight: `${TOUCH_TARGET_PX}px`,
    padding: '8px 16px',
    fontSize: '16px',
    textAlign: 'left',
    fontWeight: 600,
    cursor: 'pointer',
  },
  buttonLabel: { display: 'block' },
  buttonHint: { display: 'block', fontSize: '12px', opacity: 0.72 },
  footer: { fontSize: '12px', opacity: 0.7, textAlign: 'center' },
};
