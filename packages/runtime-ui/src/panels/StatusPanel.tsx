import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { EquipModDetail } from '@game/engine';
import type { StatHighlight } from '../app/types.js';
import { describeEquipMods } from './types.js';
import type {
  StatusAttrView,
  StatusEffectView,
  StatusEquipView,
  StatusOutfitView,
  StatusPanelView,
  StatusSkillView,
  StatusWalletView,
} from './types.js';

/**
 * 状态面板（设计 §6.4 / FR-UI-03）。
 *
 * 五块内容：属性（数值条 + 等级名）/ 技能 / 状态效果 / 钱包 / 着装概要；
 * 数值变化高亮走**面板内部**（§6.4 末段明确「属性变化高亮走 StatusPanel 内部
 * 动画，不占 Toast」），故本组件接收 `highlights` 而非经通知系统。
 *
 * 契约：props 受控——视图（{@link StatusPanelView}）由宿主经 projectStatusPanel
 * 投影后传入；`nameOf` 为文本键物化回调（通常包一层 TextResolver），组件不持
 * resolver（便于纯渲染测试）。
 */

/** 状态面板区块标题（可注入本地化） */
export interface StatusPanelLabels {
  readonly attrs?: string;
  readonly skills?: string;
  readonly statuses?: string;
  readonly wallet?: string;
  readonly outfit?: string;
  readonly mods?: string;
}

/** 缺省区块标题（无语言包时的可用性回退） */
const DEFAULT_LABELS: Required<StatusPanelLabels> = {
  attrs: '属性',
  skills: '技能',
  statuses: '状态',
  wallet: '钱包',
  outfit: '着装',
  mods: '装备修正',
};

/** 高亮缺省存活时长（ms；超期不再渲染，避免陈旧动画残留） */
export const DEFAULT_HIGHLIGHT_TTL_MS = 1200;

/** StatusPanel 属性（受控） */
export interface StatusPanelProps {
  /** 面板视图（projectStatusPanel 产物） */
  readonly view: StatusPanelView;
  /** 文本键物化（通常为 `(key) => resolver.resolve(key, lang).text`） */
  readonly nameOf: (key: string) => string;
  /** 数值高亮表（attr id → 最近一次变化；FR-STAT-04） */
  readonly highlights?: Readonly<Record<string, StatHighlight>>;
  /** 高亮存活时长（ms；缺省 {@link DEFAULT_HIGHLIGHT_TTL_MS}） */
  readonly highlightTtlMs?: number;
  /** 当前时刻注入（测试可复现超期判定；缺省 Date.now） */
  readonly now?: () => number;
  /** 高亮被消费的回调（宿主据此清理条目，动画不重复播） */
  readonly onHighlightSeen?: (seen: { attr: string; delta: number }) => void;
  /** 装备修正明细（可选；给出且非空时渲染修正区块，FR-STAT-03） */
  readonly modDetails?: readonly EquipModDetail[];
  /** 区块标题注入 */
  readonly labels?: StatusPanelLabels;
}

/**
 * 状态面板（见模块 TSDoc）。
 *
 * 高亮呈现：在属性值右侧显示 `+N` / `-N`，并以 `data-trend="up|down"` 标注
 * 方向（样式钩子；避免把颜色硬编码进组件）。超期条目（`now - at > ttl`）不渲染。
 */
export function StatusPanel(props: StatusPanelProps): ReactNode {
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const ttl = props.highlightTtlMs ?? DEFAULT_HIGHLIGHT_TTL_MS;
  const now = props.now ?? Date.now;

  /** 该属性当前是否有存活高亮（超期返回 undefined） */
  const liveHighlight = (attrId: string): StatHighlight | undefined => {
    const highlight = props.highlights?.[attrId];
    if (highlight === undefined) return undefined;
    if (now() - highlight.at > ttl) return undefined;
    return highlight;
  };

  return (
    <div style={styles.root}>
      {props.view.attrs.length > 0 ? (
        <Section title={labels.attrs}>
          {props.view.attrs.map((attr) => (
            <AttrRow
              key={attr.id}
              attr={attr}
              name={props.nameOf(attr.nameKey)}
              highlight={liveHighlight(attr.id)}
              onSeen={props.onHighlightSeen}
            />
          ))}
        </Section>
      ) : null}

      {props.view.skills.length > 0 ? (
        <Section title={labels.skills}>
          {props.view.skills.map((skill) => (
            <SkillRow key={skill.id} skill={skill} name={props.nameOf(skill.nameKey)} />
          ))}
        </Section>
      ) : null}

      {props.view.statuses.length > 0 ? (
        <Section title={labels.statuses}>
          {props.view.statuses.map((effect) => (
            <StatusRow key={effect.id} effect={effect} name={props.nameOf(effect.nameKey)} />
          ))}
        </Section>
      ) : null}

      {props.view.wallet.length > 0 ? (
        <Section title={labels.wallet}>
          {props.view.wallet.map((entry) => (
            <WalletRow key={entry.id} entry={entry} name={props.nameOf(entry.nameKey)} />
          ))}
        </Section>
      ) : null}

      {props.view.equip.length > 0 || props.view.outfit.length > 0 ? (
        <Section title={labels.outfit}>
          {props.view.equip.map((entry) => (
            <EquipRow
              key={`equip.${entry.slot}`}
              entry={entry}
              name={props.nameOf(entry.nameKey)}
            />
          ))}
          {props.view.outfit.map((entry) => (
            <OutfitRow
              key={`outfit.${entry.part}.${entry.layer}`}
              entry={entry}
              name={props.nameOf(entry.nameKey)}
            />
          ))}
        </Section>
      ) : null}

      {props.modDetails !== undefined && props.modDetails.length > 0 ? (
        <Section title={labels.mods}>
          {props.modDetails.map((detail) => (
            <div key={detail.slot} style={styles.row}>
              <span style={styles.rowLabel}>{detail.slot}</span>
              <span style={styles.rowValue}>{describeEquipMods(detail)}</span>
            </div>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

/** 区块容器（标题 + 行列表；无内容时调用方不渲染） */
function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      <div style={styles.rows}>{children}</div>
    </section>
  );
}

/** 属性行：名称 + 数值（等级型显示等级名）+ 进度条 + 增量高亮 */
function AttrRow({
  attr,
  name,
  highlight,
  onSeen,
}: {
  attr: StatusAttrView;
  name: string;
  highlight: StatHighlight | undefined;
  onSeen: StatusPanelProps['onHighlightSeen'];
}): ReactNode {
  // 高亮「已呈现」的回调副作用在提交后触发（不在渲染期），宿主据此清理条目
  useEffect(() => {
    if (highlight !== undefined) onSeen?.({ attr: attr.id, delta: highlight.delta });
  }, [highlight, onSeen, attr.id]);

  const percent =
    attr.kind === 'numeric' &&
    attr.min !== undefined &&
    attr.max !== undefined &&
    attr.max > attr.min
      ? Math.max(0, Math.min(100, ((attr.value - attr.min) / (attr.max - attr.min)) * 100))
      : undefined;
  return (
    <div style={styles.row} data-attr={attr.id}>
      <span style={styles.rowLabel}>{name}</span>
      <span style={styles.rowValue}>
        {attr.display ?? attr.value}
        {percent !== undefined ? (
          <span style={styles.bar} aria-hidden="true">
            <span style={{ ...styles.barFill, width: `${percent}%` }} />
          </span>
        ) : null}
        {highlight !== undefined ? (
          <span style={styles.delta} data-trend={highlight.delta >= 0 ? 'up' : 'down'}>
            {highlight.delta >= 0 ? `+${highlight.delta}` : String(highlight.delta)}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function SkillRow({ skill, name }: { skill: StatusSkillView; name: string }): ReactNode {
  return (
    <div style={styles.row} data-skill={skill.id}>
      <span style={styles.rowLabel}>{name}</span>
      <span style={styles.rowValue}>
        {skill.value} <span style={styles.sub}>({skill.exp} exp)</span>
      </span>
    </div>
  );
}

function StatusRow({ effect, name }: { effect: StatusEffectView; name: string }): ReactNode {
  const suffix = [
    effect.remaining !== undefined ? `剩余 ${effect.remaining}` : undefined,
    effect.stacks !== undefined && effect.stacks > 1 ? `×${effect.stacks}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
  return (
    <div style={styles.row} data-status={effect.id}>
      <span style={styles.rowLabel}>{name}</span>
      {suffix !== '' ? <span style={styles.rowValue}>{suffix}</span> : null}
    </div>
  );
}

function WalletRow({ entry, name }: { entry: StatusWalletView; name: string }): ReactNode {
  return (
    <div style={styles.row} data-wallet={entry.id}>
      <span style={styles.rowLabel}>{name}</span>
      <span style={styles.rowValue}>{entry.amount}</span>
    </div>
  );
}

function EquipRow({ entry, name }: { entry: StatusEquipView; name: string }): ReactNode {
  return (
    <div style={styles.row} data-equip={entry.slot}>
      <span style={styles.rowLabel}>{entry.slot}</span>
      <span style={styles.rowValue}>{name}</span>
    </div>
  );
}

function OutfitRow({ entry, name }: { entry: StatusOutfitView; name: string }): ReactNode {
  return (
    <div style={styles.row} data-outfit={`${entry.part}.${entry.layer}`}>
      <span style={styles.rowLabel}>
        {entry.part}
        <span style={styles.sub}> L{entry.layer}</span>
      </span>
      <span style={styles.rowValue}>{name}</span>
    </div>
  );
}

/** 样式（内联；只锁定结构与高亮钩子这类契约性属性） */
const styles: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: '16px' },
  section: { display: 'flex', flexDirection: 'column', gap: '6px' },
  sectionTitle: { margin: 0, fontSize: '14px', fontWeight: 600, opacity: 0.8 },
  rows: { display: 'flex', flexDirection: 'column', gap: '4px' },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '8px',
    fontSize: '14px',
  },
  rowLabel: { opacity: 0.8 },
  rowValue: { display: 'inline-flex', alignItems: 'center', gap: '6px' },
  sub: { fontSize: '12px', opacity: 0.65 },
  bar: {
    display: 'inline-block',
    width: '64px',
    height: '6px',
    borderRadius: '3px',
    background: 'rgba(127,127,127,0.25)',
    overflow: 'hidden',
  },
  barFill: { display: 'block', height: '100%', background: 'currentColor', opacity: 0.6 },
  delta: { fontSize: '12px', fontWeight: 600 },
};
