import type { CSSProperties, ReactNode } from 'react';
import type { BattleLogEntry, BattlePhase } from '@game/engine';

/**
 * 战斗面板（设计 §5.2 / FR-CMBT-10，25 号 C2；OQ-04 裁定：嵌入叙事区形态）。
 *
 * 与引擎的分工（DD-11 + #33 契约）：
 * - 引擎侧：`battle_start` 事件（含 encounter + 三分支）→ `createBattleController`
 *   → 会话驱动 → `pollOutcome()`（返回 jumps 需注回叙事）；
 * - **本组件是纯呈现层**：单位状态栏、行动菜单、战斗日志、胜负面。
 *   会话驱动与事件消费归宿主（`apps/player-demo` / game-host），组件只经
 *   props 接收投影 + 经 `onAction` 请求行动（受控契约，与既有面板同规）。
 *
 * 布局（OQ-04 嵌入形态）：纵向三段——敌方区 / 日志区 / 我方区 + 行动菜单，
 * 单列窄屏可用（不依赖横向空间）。
 */

/** 单位展示投影（宿主从 BattleUnit 投影；只带 UI 需要的字段） */
export interface BattleUnitView {
  readonly uid: string;
  readonly side: 'player' | 'enemy' | 'ally';
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  /** 当前是否处于防御态（defend 行动） */
  readonly defending?: boolean;
}

/** 行动菜单项（宿主按当前单位的技能/道具投影） */
export interface BattleActionOption {
  readonly id: string;
  readonly label: string;
  /** 行动类别（决定回调参数形态） */
  readonly kind: 'skill' | 'item' | 'defend' | 'flee';
  /** 需要的目标（缺省 = 无目标行动，如 defend/flee） */
  readonly needsTarget?: boolean;
}

/** 文案注入 */
export interface BattlePanelLabels {
  readonly title?: string;
  readonly enemies?: string;
  readonly party?: string;
  readonly log?: string;
  readonly victory?: string;
  readonly defeat?: string;
  readonly escaped?: string;
  readonly awaiting?: string;
  readonly defendingTag?: string;
  /** 日志文本（缺省显示 i18n 键；宿主可注入 resolver 物化） */
  readonly resolveLog?: (entry: BattleLogEntry) => string;
  readonly empty?: string;
}

const DEFAULT_LABELS: Required<Omit<BattlePanelLabels, 'resolveLog'>> = {
  title: '战斗',
  enemies: '敌方',
  party: '我方',
  log: '战斗日志',
  victory: '胜利',
  defeat: '战败',
  escaped: '逃脱成功',
  awaiting: '等待你的行动…',
  defendingTag: '防御中',
  empty: '（暂无记录）',
};

export interface BattlePanelProps {
  /** 会话相位（引擎 BattlePhase；决定行动菜单可用性与终局面） */
  readonly phase: BattlePhase;
  readonly units: readonly BattleUnitView[];
  readonly log: readonly BattleLogEntry[];
  /** 当前可行动单位（phase = await_player 时非空） */
  readonly activeUid?: string;
  /** 可选行动（宿主按当前单位投影） */
  readonly actions?: readonly BattleActionOption[];
  /** 行动请求（宿主转成 PlayerAction 后调 session.playerAction） */
  readonly onAction?: (action: BattleActionOption, targetUid?: string) => void;
  /** 目标选择：需要目标的行动被点击后，等待玩家点选敌方单位 */
  readonly labels?: BattlePanelLabels;
}

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '10px',
  border: '1px solid rgba(128, 128, 128, 0.35)',
  borderRadius: '6px',
  background: 'rgba(20, 20, 20, 0.04)',
};

const ROW_STYLE: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '6px' };

const UNIT_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: '110px',
  padding: '4px 6px',
  borderRadius: '4px',
  border: '1px solid rgba(128, 128, 128, 0.3)',
};

const BAR_OUTER: CSSProperties = {
  height: '5px',
  borderRadius: '3px',
  background: 'rgba(128, 128, 128, 0.25)',
  overflow: 'hidden',
};

export interface BattlePanelState {
  /** 待选目标的行动（点击需要目标的行动后置位；点敌方单位后回调） */
  readonly pendingAction?: BattleActionOption | undefined;
}

/**
 * 战斗面板（受控）。
 *
 * 目标选择流程（两步点选，无内部状态依赖宿主）：
 * 1. 点「需要目标」的行动 → `onAction(action)` **不传 target**（宿主置待选态）；
 * 2. 点敌方单位 → `onAction(pendingAction, uid)`（宿主执行）。
 * 为免引入组件内部状态，第二步由宿主维护 `pendingAction` 并经 props 回传；
 * 本组件在 `pendingAction` 存在时把敌方单位渲染为可点按钮。
 */
export function BattlePanel(
  props: BattlePanelProps & { readonly pendingAction?: BattleActionOption },
): ReactNode {
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const enemies = props.units.filter((unit) => unit.side === 'enemy');
  const party = props.units.filter((unit) => unit.side !== 'enemy');
  const terminal =
    props.phase === 'victory' || props.phase === 'defeat' || props.phase === 'escaped';
  const pending = props.pendingAction;
  const canAct = props.phase === 'await_player' && !terminal;

  const renderUnit = (unit: BattleUnitView): ReactNode => {
    const percent = unit.maxHp > 0 ? Math.max(0, Math.round((unit.hp / unit.maxHp) * 100)) : 0;
    const selectable = pending === undefined ? false : unit.side === 'enemy' && canAct;
    return (
      <div
        key={unit.uid}
        style={{
          ...UNIT_STYLE,
          opacity: unit.hp > 0 ? 1 : 0.45,
          // 目标选择态：可点敌方单位加虚线框与手型（交互可见性）
          ...(selectable ? { cursor: 'pointer', outline: '1px dashed currentColor' } : {}),
        }}
        {...(selectable
          ? {
              role: 'button' as const,
              tabIndex: 0,
              onClick: () => props.onAction?.(pending as BattleActionOption, unit.uid),
            }
          : {})}
        data-unit-uid={unit.uid}
        data-unit-side={unit.side}
      >
        <span>
          {unit.name}
          {unit.defending === true ? ` · ${labels.defendingTag}` : ''}
        </span>
        <div
          style={BAR_OUTER}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div style={{ width: `${percent}%`, height: '100%', background: 'currentColor' }} />
        </div>
        <span style={{ fontSize: '0.78em', opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>
          {unit.hp} / {unit.maxHp}
        </span>
      </div>
    );
  };

  return (
    <section style={PANEL_STYLE} aria-label={labels.title} data-battle-phase={props.phase}>
      <h3 style={{ margin: 0, fontSize: '1em' }}>{labels.title}</h3>

      {/* 敌方区 */}
      <div>
        <h4 style={{ margin: '0 0 4px', fontSize: '0.85em', opacity: 0.8 }}>{labels.enemies}</h4>
        <div style={ROW_STYLE}>{enemies.map(renderUnit)}</div>
      </div>

      {/* 日志区（可滚动；回看数据即 session.log()） */}
      <div>
        <h4 style={{ margin: '0 0 4px', fontSize: '0.85em', opacity: 0.8 }}>{labels.log}</h4>
        <ol
          style={{
            margin: 0,
            paddingLeft: '18px',
            maxHeight: '140px',
            overflowY: 'auto',
            fontSize: '0.85em',
          }}
        >
          {props.log.length === 0 ? (
            <li style={{ opacity: 0.7 }}>{labels.empty}</li>
          ) : (
            props.log.map((entry, index) => (
              <li key={`${entry.phase}-${index}`}>
                {labels.resolveLog !== undefined ? labels.resolveLog(entry) : entry.key}
              </li>
            ))
          )}
        </ol>
      </div>

      {/* 我方区 */}
      <div>
        <h4 style={{ margin: '0 0 4px', fontSize: '0.85em', opacity: 0.8 }}>{labels.party}</h4>
        <div style={ROW_STYLE}>{party.map(renderUnit)}</div>
      </div>

      {/* 行动菜单 / 终局面 */}
      {terminal ? (
        <p style={{ margin: 0, fontWeight: 'bold' }}>
          {props.phase === 'victory'
            ? labels.victory
            : props.phase === 'defeat'
              ? labels.defeat
              : labels.escaped}
        </p>
      ) : (
        <div>
          {canAct ? (
            <>
              {pending !== undefined ? (
                <p style={{ margin: '0 0 4px', fontSize: '0.85em', opacity: 0.85 }}>
                  {labels.awaiting}
                </p>
              ) : null}
              <div style={ROW_STYLE}>
                {(props.actions ?? []).map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    disabled={!canAct}
                    onClick={() => props.onAction?.(action)}
                    style={{ minHeight: '32px', cursor: 'pointer' }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p style={{ margin: 0, opacity: 0.75 }}>{labels.awaiting}</p>
          )}
        </div>
      )}
    </section>
  );
}
