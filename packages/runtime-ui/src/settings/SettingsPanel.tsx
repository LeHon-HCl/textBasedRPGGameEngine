import type { CSSProperties, ReactNode } from 'react';
import type { ContentTagDef } from '@game/shared';
import type { PlayerSettings } from '@game/engine';
import { TOUCH_TARGET_PX } from '../app/AppShell.js';

/**
 * 设置面板（设计 §6.5 设置与内容分级面板 / FR-UI-05）。
 *
 * 设置项即 `PlayerSettings` 的表单化：语言 / 文本速度 / 字号行距 / BGM / 音效 /
 * 图片 / 减弱动画 / 内容标签开关 / 快捷键说明 / 关于（三版本号，FR-UI-08 数据源）。
 *
 * 契约（受控组件）：
 * - `settings` 由宿主持有（通常映射自 `GameState.settings`），任何变更经
 *   `onChange(partial)` 上抛——组件不写状态、不读 store；
 * - 标签开关只报告新的 `disabledTags` 数组；**重建 ContentFilter**（FR-CGRD-03
 *   即时生效）是宿主职责（§6.5「标签开关变更 → 重建 ContentFilter」）；
 * - 版本三元组由宿主注入（引擎版本来自 `ENGINE_VERSION`、游戏/schema 来自
 *   manifest），组件只呈现（FR-UI-08 的数据源）。
 */

/** 快捷键说明条目（FR-READ-06：映射表可查） */
export interface ShortcutHint {
  /** 键位展示文本（如 '空格 / 回车'、'1-9'） */
  readonly keys: string;
  /** 动作说明（本地化文案） */
  readonly action: string;
}

/** 缺省快捷键表（FR-READ-06 的固定映射；可经 props 覆盖为自定义映射） */
export const DEFAULT_SHORTCUT_HINTS: readonly ShortcutHint[] = [
  { keys: '空格 / 回车', action: '推进文本' },
  { keys: '1-9', action: '选择对应选项' },
  { keys: 'S / L', action: '快速存档 / 快速读档' },
  { keys: 'H', action: '查看历史' },
  { keys: 'Esc', action: '关闭面板' },
];

/** 设置面板区块标题（可注入本地化） */
export interface SettingsPanelLabels {
  readonly title?: string;
  readonly lang?: string;
  readonly display?: string;
  readonly textSpeed?: string;
  readonly fontSize?: string;
  readonly lineHeight?: string;
  readonly media?: string;
  readonly bgm?: string;
  readonly sfx?: string;
  readonly images?: string;
  readonly reducedMotion?: string;
  readonly tags?: string;
  readonly shortcuts?: string;
  readonly about?: string;
  readonly engineVersion?: string;
  readonly gameVersion?: string;
  readonly schemaVersion?: string;
}

/** 缺省文案（D4 边界：正式文案由宿主注入） */
const DEFAULT_LABELS: Required<SettingsPanelLabels> = {
  title: '设置',
  lang: '语言',
  display: '文本排版',
  textSpeed: '文本速度',
  fontSize: '字号',
  lineHeight: '行距',
  media: '媒体与动画',
  bgm: '背景音乐',
  sfx: '音效',
  images: '图片',
  reducedMotion: '减弱动画',
  tags: '内容标签',
  shortcuts: '快捷键',
  about: '关于',
  engineVersion: '引擎版本',
  gameVersion: '游戏版本',
  schemaVersion: '数据版本',
};

/** 设置面板属性（受控） */
export interface SettingsPanelProps {
  /** 当前设置（`GameState.settings` 切片） */
  readonly settings: PlayerSettings;
  /** 已注册语言清单（FR-L10N-02；`def.manifest.langs`） */
  readonly langs: readonly string[];
  /** 内容标签目录（FR-CGRD-01；`ContentTagsDef.tags`） */
  readonly tags: readonly ContentTagDef[];
  /** 版本三元组（FR-UI-08 数据源：引擎 / 游戏 / schema） */
  readonly versions: {
    readonly engineVersion: string;
    readonly gameVersion: string;
    readonly schemaVersion: number;
  };
  /** 设置变更回调（部分更新；宿主负责持久化与 ContentFilter 重建） */
  readonly onChange: (partial: Partial<PlayerSettings>) => void;
  /** 文本键物化（标签名等） */
  readonly nameOf: (key: string) => string;
  /** 快捷键表（缺省 {@link DEFAULT_SHORTCUT_HINTS}） */
  readonly shortcuts?: readonly ShortcutHint[];
  /** 文案注入 */
  readonly labels?: SettingsPanelLabels;
  /**
   * 版本不兼容提示入口（FR-UI-08 卡片；缺省不渲染）。
   * 宿主在检测到 VERSION_UNSUPPORTED / MIGRATION_FAILED 时提供该节点。
   */
  readonly versionNotice?: ReactNode;
  /** 标签开关的内联说明（FR-CGRD-04「可在设置中修改」的提示语） */
  readonly tagsHint?: ReactNode;
}

/**
 * 设置面板（见模块 TSDoc）。
 *
 * 标签开关的语义：复选框勾选 = 该类内容**启用**（`disabledTags` 不含该 id）；
 * 取消勾选 = 加入禁用集。切换时提交新数组（不原地改传入数组，保持受控纯净）。
 */
export function SettingsPanel(props: SettingsPanelProps): ReactNode {
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const { settings } = props;
  const disabled = new Set(settings.disabledTags);

  /** 标签开关翻转：产出新的禁用集（保持原顺序 + 追加） */
  const toggleTag = (tagId: string): void => {
    const next = disabled.has(tagId)
      ? settings.disabledTags.filter((id) => id !== tagId)
      : [...settings.disabledTags, tagId];
    props.onChange({ disabledTags: next });
  };

  return (
    <div style={styles.root}>
      <h2 style={styles.title}>{labels.title}</h2>
      {props.versionNotice}

      <Section title={labels.display}>
        <Row label={labels.lang}>
          <select
            aria-label={labels.lang}
            value={settings.lang}
            onChange={(event) => props.onChange({ lang: event.target.value })}
            style={styles.control}
          >
            {props.langs.map((lang: string) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </Row>
        <Row label={labels.textSpeed}>
          <input
            aria-label={labels.textSpeed}
            type="number"
            step="0.5"
            min="0"
            value={settings.textSpeed}
            onChange={(event) => props.onChange({ textSpeed: Number(event.target.value) })}
            style={styles.control}
          />
        </Row>
        <Row label={labels.fontSize}>
          <input
            aria-label={labels.fontSize}
            type="number"
            min="10"
            max="32"
            value={settings.fontSize}
            onChange={(event) => props.onChange({ fontSize: Number(event.target.value) })}
            style={styles.control}
          />
        </Row>
        <Row label={labels.lineHeight}>
          <input
            aria-label={labels.lineHeight}
            type="number"
            step="0.1"
            min="1"
            max="3"
            value={settings.lineHeight}
            onChange={(event) => props.onChange({ lineHeight: Number(event.target.value) })}
            style={styles.control}
          />
        </Row>
      </Section>

      <Section title={labels.media}>
        <Row label={labels.bgm}>
          <input
            aria-label={labels.bgm}
            type="checkbox"
            checked={settings.bgmOn}
            onChange={(event) => props.onChange({ bgmOn: event.target.checked })}
          />
        </Row>
        <Row label={labels.sfx}>
          <input
            aria-label={labels.sfx}
            type="checkbox"
            checked={settings.sfxOn}
            onChange={(event) => props.onChange({ sfxOn: event.target.checked })}
          />
        </Row>
        <Row label={labels.images}>
          <input
            aria-label={labels.images}
            type="checkbox"
            checked={settings.imagesOn}
            onChange={(event) => props.onChange({ imagesOn: event.target.checked })}
          />
        </Row>
        <Row label={labels.reducedMotion}>
          <input
            aria-label={labels.reducedMotion}
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(event) => props.onChange({ reducedMotion: event.target.checked })}
          />
        </Row>
      </Section>

      {props.tags.length > 0 ? (
        <Section title={labels.tags}>
          {props.tagsHint !== undefined ? <p style={styles.hint}>{props.tagsHint}</p> : null}
          {props.tags.map((tag) => (
            <Row key={tag.id} label={props.nameOf(tag.nameKey)}>
              <input
                aria-label={props.nameOf(tag.nameKey)}
                type="checkbox"
                checked={!disabled.has(tag.id)}
                onChange={() => toggleTag(tag.id)}
              />
            </Row>
          ))}
        </Section>
      ) : null}

      <Section title={labels.shortcuts}>
        <table style={styles.table}>
          <tbody>
            {(props.shortcuts ?? DEFAULT_SHORTCUT_HINTS).map((hint) => (
              <tr key={hint.keys}>
                <td style={styles.keyCell}>{hint.keys}</td>
                <td style={styles.actionCell}>{hint.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={labels.about}>
        <Row label={labels.engineVersion}>
          <span>{props.versions.engineVersion}</span>
        </Row>
        <Row label={labels.gameVersion}>
          <span>{props.versions.gameVersion}</span>
        </Row>
        <Row label={labels.schemaVersion}>
          <span>{String(props.versions.schemaVersion)}</span>
        </Row>
      </Section>
    </div>
  );
}

/** 区块（标题 + 行列表） */
function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      <div style={styles.rows}>{children}</div>
    </section>
  );
}

/** 单行（左标签 + 右控件；标签与控件的 aria 关联经 aria-label 建立） */
function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowControl}>{children}</span>
    </div>
  );
}

/** 样式（内联；只锁定触控尺寸与行结构这类契约性属性） */
const styles: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: '16px' },
  title: { margin: 0, fontSize: '18px', fontWeight: 600 },
  section: { display: 'flex', flexDirection: 'column', gap: '6px' },
  sectionTitle: { margin: 0, fontSize: '14px', fontWeight: 600, opacity: 0.8 },
  rows: { display: 'flex', flexDirection: 'column', gap: '6px' },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    minHeight: `${TOUCH_TARGET_PX}px`,
    fontSize: '14px',
  },
  rowLabel: { opacity: 0.85 },
  rowControl: { display: 'inline-flex', alignItems: 'center', gap: '6px' },
  control: { minHeight: '28px', padding: '2px 6px', fontSize: '14px' },
  hint: { margin: 0, fontSize: '12px', opacity: 0.7 },
  table: { borderCollapse: 'collapse', fontSize: '13px', width: '100%' },
  keyCell: { padding: '4px 12px 4px 0', opacity: 0.9, whiteSpace: 'nowrap' },
  actionCell: { padding: '4px 0', opacity: 0.75 },
};
