import type { CSSProperties, ReactNode } from 'react';

/**
 * 调试面板（设计 §6.5 / FR-DEBG-01～07，25 号 Q3）。
 *
 * 启用条件：`manifest.debug === true`（作者在开发期包内声明；正式发行包缺省关闭）。
 * 宿主据此决定是否渲染本面板，并只在开启时把调试动作接到运行时。
 *
 * 五项能力（FR-DEBG 需求面）：
 * 1. **变量监视**（FR-DEBG-02）：关键状态域的只读快照（attrs/flags/wallet/quests/time）；
 * 2. **跳转**（FR-DEBG-03）：跳到指定场景（宿主注入 jumpTo 回调）；
 * 3. **时间快进**（FR-DEBG-04）：推进 N 个时段（经时间管线，非裸改时钟）；
 * 4. **表达式控制台**（FR-DEBG-05）：输入表达式 → 求值并显示结果（宿主注入 evaluate）；
 * 5. **评估日志**（FR-DEBG-07）：最近的引擎事件流（宿主注入 events）。
 *
 * 受控契约：全部数据经 props 注入，面板不直接持有运行时（与既有面板同规）。
 * 危险操作（跳转/快进）在 UI 上标注「不可回滚」提示（口径：调试操作与周目切换
 * 一样会改变基线，玩家不应误以为可撤销）。
 */

/** 变量监视条目（宿主投影；值已序列化为展示串） */
export interface DebugWatchEntry {
  readonly label: string;
  readonly value: string;
}

/** 引擎事件日志条目（FR-DEBG-07 评估日志；宿主从运行时事件订阅累积） */
export interface DebugEventEntry {
  readonly type: string;
  readonly detail: string;
  /** 序号（宿主累积序；UI 用 key） */
  readonly seq: number;
}

/** 文案注入 */
export interface DebugPanelLabels {
  readonly title?: string;
  readonly watch?: string;
  readonly jump?: string;
  readonly jumpPlaceholder?: string;
  readonly jumpButton?: string;
  readonly timeWarp?: string;
  readonly timeWarpButton?: string;
  readonly console?: string;
  readonly consolePlaceholder?: string;
  readonly evaluateButton?: string;
  readonly events?: string;
  readonly noResult?: string;
  readonly irreversible?: string;
  readonly empty?: string;
}

const DEFAULT_LABELS: Required<DebugPanelLabels> = {
  title: '调试面板',
  watch: '变量监视',
  jump: '跳转场景',
  jumpPlaceholder: '场景 id',
  jumpButton: '跳转',
  timeWarp: '时间快进（时段数）',
  timeWarpButton: '快进',
  console: '表达式控制台',
  consolePlaceholder: '如 attr.insight + 1',
  evaluateButton: '求值',
  events: '评估日志',
  noResult: '（无结果）',
  irreversible: '此操作不可回滚',
  empty: '（暂无）',
};

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  padding: '10px',
  border: '1px solid rgba(180, 80, 80, 0.4)',
  borderRadius: '6px',
  fontSize: '0.9em',
};

const SECTION_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px' };

const ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: '6px',
  alignItems: 'center',
  flexWrap: 'wrap',
};

export interface DebugPanelProps {
  /** 变量监视（宿主投影；FR-DEBG-02） */
  readonly watch: readonly DebugWatchEntry[];
  /** 评估日志（宿主事件订阅累积；FR-DEBG-07） */
  readonly events: readonly DebugEventEntry[];
  /** 跳转请求（FR-DEBG-03） */
  readonly onJump?: (sceneId: string) => void;
  /** 时间快进请求（FR-DEBG-04；时段数） */
  readonly onTimeWarp?: (slots: number) => void;
  /** 表达式求值请求（FR-DEBG-05；宿主可同步返回展示串） */
  readonly onEvaluate?: (source: string) => string;
  /**
   * 最近一次表达式求值结果（受控：宿主求值后经此回传；null = 未求值，
   * undefined = 求值失败显性化由宿主转成文本）
   */
  readonly lastEval?: { readonly source: string; readonly result: string } | null;
  readonly labels?: DebugPanelLabels;
}

/**
 * 调试面板。
 *
 * 输入框使用非受控 + ref（避免为两个输入框引入组件状态；提交时读取当前值），
 * 但**求值结果**是受控的（宿主回传）——保证「结果来自真实运行时」而非组件猜测。
 */
export function DebugPanel(props: DebugPanelProps): ReactNode {
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  return (
    <section style={PANEL_STYLE} aria-label={labels.title}>
      <h3 style={{ margin: 0, fontSize: '1em' }}>
        {labels.title}{' '}
        <span style={{ fontSize: '0.8em', opacity: 0.7 }}>· {labels.irreversible}</span>
      </h3>

      {/* 变量监视 */}
      <div style={SECTION_STYLE}>
        <h4 style={{ margin: 0, fontSize: '0.9em', opacity: 0.85 }}>{labels.watch}</h4>
        {props.watch.length === 0 ? (
          <span style={{ opacity: 0.7 }}>{labels.empty}</span>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {props.watch.map((entry) => (
                <tr key={entry.label}>
                  <td style={{ padding: '1px 6px 1px 0', opacity: 0.8 }}>{entry.label}</td>
                  <td style={{ padding: '1px 0', fontVariantNumeric: 'tabular-nums' }}>
                    {entry.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 跳转 */}
      <div style={SECTION_STYLE}>
        <h4 style={{ margin: 0, fontSize: '0.9em', opacity: 0.85 }}>{labels.jump}</h4>
        <form
          style={ROW_STYLE}
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem(
              'scene',
            ) as HTMLInputElement | null;
            const value = input?.value.trim();
            if (value !== undefined && value !== '') props.onJump?.(value);
          }}
        >
          <input name="scene" placeholder={labels.jumpPlaceholder} style={{ minHeight: '28px' }} />
          <button type="submit" style={{ minHeight: '28px', cursor: 'pointer' }}>
            {labels.jumpButton}
          </button>
        </form>
      </div>

      {/* 时间快进 */}
      <div style={SECTION_STYLE}>
        <h4 style={{ margin: 0, fontSize: '0.9em', opacity: 0.85 }}>{labels.timeWarp}</h4>
        <form
          style={ROW_STYLE}
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem(
              'slots',
            ) as HTMLInputElement | null;
            const slots = Number(input?.value ?? '0');
            if (Number.isInteger(slots) && slots > 0) props.onTimeWarp?.(slots);
          }}
        >
          <input
            name="slots"
            type="number"
            min={1}
            defaultValue={1}
            style={{ minHeight: '28px', width: '80px' }}
          />
          <button type="submit" style={{ minHeight: '28px', cursor: 'pointer' }}>
            {labels.timeWarpButton}
          </button>
        </form>
      </div>

      {/* 表达式控制台 */}
      <div style={SECTION_STYLE}>
        <h4 style={{ margin: 0, fontSize: '0.9em', opacity: 0.85 }}>{labels.console}</h4>
        <form
          style={ROW_STYLE}
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem('expr') as HTMLInputElement | null;
            const source = input?.value.trim();
            if (source !== undefined && source !== '') props.onEvaluate?.(source);
          }}
        >
          <input
            name="expr"
            placeholder={labels.consolePlaceholder}
            style={{ minHeight: '28px', flex: 1 }}
          />
          <button type="submit" style={{ minHeight: '28px', cursor: 'pointer' }}>
            {labels.evaluateButton}
          </button>
        </form>
        <output style={{ fontFamily: 'monospace', opacity: 0.9 }}>
          {props.lastEval === null || props.lastEval === undefined
            ? labels.noResult
            : `> ${props.lastEval.source} ⇒ ${props.lastEval.result}`}
        </output>
      </div>

      {/* 评估日志 */}
      <div style={SECTION_STYLE}>
        <h4 style={{ margin: 0, fontSize: '0.9em', opacity: 0.85 }}>{labels.events}</h4>
        <ol
          style={{
            margin: 0,
            paddingLeft: '18px',
            maxHeight: '160px',
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: '0.85em',
          }}
        >
          {props.events.length === 0 ? (
            <li style={{ opacity: 0.7 }}>{labels.empty}</li>
          ) : (
            props.events.map((entry) => (
              <li key={entry.seq}>
                [{entry.type}] {entry.detail}
              </li>
            ))
          )}
        </ol>
      </div>
    </section>
  );
}
