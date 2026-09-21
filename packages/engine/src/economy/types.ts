import type { ExecOutcome } from '../runtime/index.js';
import type { GameId, TextKey } from '@game/shared';

/**
 * 经济与商店契约（设计 §5.3，17 号；**S0 冻结面**——变更只增不改）。
 *
 * - {@link ShopEntryView}：商店界面的条目投影（FR-ECON-02：showIf 过滤 +
 *   库存投影；无 stock 字段 = 无限库存）；
 * - {@link ShopService}：条目/定价/交易三面。交易走原子事务（钱物同批，
 *   失败整体回滚，FR-ECON-04）；回购价 = 当次会话内卖价（FR-ECON-03）；
 * - 定价表达式在加载期编译（ShopDef.priceBuy/priceSell，02 号 schema 已建），
 *   每次求值注入当前状态（声望/时段/周目/好感即普通变量，§5.3）。
 *
 * 与 UI 的边界：本文件不接触 React/DOM（DD-05 同款哲学）——宿主（runtime-ui
 * 商店面板）消费 `shop_open` 事件后调用本服务，渲染由 UI 侧负责。
 */

/** 商店条目视图（界面渲染面；价格已求值，购买可行性由 UI 按余额判断） */
export interface ShopEntryView {
  readonly itemId: GameId;
  /** 当前买价（priceBuy 表达式求值结果） */
  readonly priceBuy: number;
  /** 当前卖价（priceSell 表达式求值结果；回购按当次价，FR-ECON-03） */
  readonly priceSell: number;
  /** 剩余库存；undefined = 无限（ShopEntry.stock 省略） */
  readonly stock?: number;
  /** 折扣/加价理由文本键（可选展示，FR-ECON-03） */
  readonly modifierKeys?: readonly TextKey[];
}

/** 单次定价结果 */
export interface ShopPrice {
  readonly amount: number;
  readonly currency: GameId;
  readonly modifierKeys?: readonly TextKey[];
}

/**
 * 商店服务（§5.3；实现见 shop-service.ts）。
 * 所有方法读当前 GameState（宿主注入运行时），交易方法产出 ExecOutcome
 * （原子事务：扣钱 + 给物 + trade 事件同批）。
 */
export interface ShopService {
  /** 条目投影：showIf 过滤 + 库存投影（FR-ECON-02） */
  entries(shopId: GameId): ShopEntryView[];
  /** 单条定价：mode 决定 priceBuy/priceSell */
  priceOf(shopId: GameId, itemId: GameId, mode: 'buy' | 'sell'): ShopPrice;
  /** 购买（原子）：扣钱 + 给物 + trade 事件；钱不够/超库存 → 整体回滚 */
  buy(shopId: GameId, itemId: GameId, count: number): ExecOutcome;
  /** 出售（原子）：给钱 + 扣物 + trade 事件；回购价 = 当次卖价（会话内） */
  sell(shopId: GameId, itemId: GameId, count: number): ExecOutcome;
}
