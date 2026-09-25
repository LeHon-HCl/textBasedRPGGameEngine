import type { CSSProperties, ReactNode } from 'react';
import type { ShopSessionView } from '../app/panel-wiring.js';

/**
 * 商店面板（设计 §5.3 / FR-ECON-03，17 号；宿主接线 2026-09-25）。
 *
 * 数据面 = 宿主 `shopSession()` 投影（引擎 `ShopService` 的只读视图）；
 * 交互经 `onBuy` / `onSell` / `onClose` 回调——**受控契约**（与既有面板同规）。
 *
 * 价格与库存随状态实时变化（投影每次现算），故面板不需要本地状态：
 * 交易后由宿主重投影，React 重渲染即反映新价。
 */

/** 文案注入（缺省中文可用性回退） */
export interface ShopPanelLabels {
  readonly title?: string;
  readonly wallet?: string;
  readonly buy?: string;
  readonly sell?: string;
  readonly close?: string;
  readonly outOfStock?: string;
  readonly cannotAfford?: string;
  readonly stock?: string;
  readonly empty?: string;
  /** 物品名物化（nameKey → 展示文本；缺省显示键） */
  readonly resolveName?: (key: string) => string;
}

const DEFAULT_LABELS: Required<Omit<ShopPanelLabels, 'resolveName'>> = {
  title: '商店',
  wallet: '钱袋：{amount}',
  buy: '买',
  sell: '卖',
  close: '离开商店',
  outOfStock: '售罄',
  cannotAfford: '钱不够',
  stock: '库存 {count}',
  empty: '（暂无商品）',
};

export interface ShopPanelProps {
  readonly session: ShopSessionView;
  readonly onBuy?: (itemId: string, count?: number) => void;
  readonly onSell?: (itemId: string, count?: number) => void;
  readonly onClose?: () => void;
  readonly labels?: ShopPanelLabels;
}

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '12px',
  border: '1px solid rgba(128, 128, 128, 0.35)',
  borderRadius: '6px',
  background: 'rgba(20, 20, 20, 0.04)',
};

const ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '4px 0',
  borderBottom: '1px solid rgba(128, 128, 128, 0.18)',
};

/** 商店面板（受控） */
export function ShopPanel(props: ShopPanelProps): ReactNode {
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const { session } = props;
  const nameOf = (key: string): string => props.labels?.resolveName?.(key) ?? key;
  return (
    <section style={PANEL_STYLE} aria-label={labels.title} data-shop-id={session.shopId}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0, fontSize: '1em' }}>{nameOf(session.nameKey)}</h3>
        <span style={{ opacity: 0.8 }}>
          {labels.wallet.replace('{amount}', `${session.wallet} ${session.currency}`)}
        </span>
      </header>
      {session.entries.length === 0 ? (
        <p style={{ margin: 0, opacity: 0.7 }}>{labels.empty}</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {session.entries.map((entry) => {
            const soldOut = entry.stock !== undefined && entry.stock <= 0;
            return (
              <li key={entry.itemId} style={ROW_STYLE}>
                <span style={{ flex: 1 }}>{nameOf(entry.nameKey)}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>
                  {entry.priceBuy} / {entry.priceSell}
                </span>
                <span style={{ fontSize: '0.8em', opacity: 0.7, minWidth: '64px' }}>
                  {entry.stock !== undefined
                    ? soldOut
                      ? labels.outOfStock
                      : labels.stock.replace('{count}', String(entry.stock))
                    : ''}
                </span>
                <button
                  type="button"
                  disabled={soldOut || !entry.affordable}
                  title={!entry.affordable && !soldOut ? labels.cannotAfford : undefined}
                  onClick={() => props.onBuy?.(entry.itemId, 1)}
                  style={{ minHeight: '28px', cursor: 'pointer' }}
                >
                  {labels.buy}
                </button>
                <button
                  type="button"
                  onClick={() => props.onSell?.(entry.itemId, 1)}
                  style={{ minHeight: '28px', cursor: 'pointer' }}
                >
                  {labels.sell}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={() => props.onClose?.()}
        style={{ minHeight: '32px', cursor: 'pointer' }}
      >
        {labels.close}
      </button>
    </section>
  );
}
