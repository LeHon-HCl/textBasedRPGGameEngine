import type { Clock, ExprScope, ExprTimeView, GameId, Profile } from '@game/shared';
import type { GameState } from './game-state.js';

/**
 * 求值作用域投影（设计 §3.1 ↔ §3.2 的接线层，04 任务 A1/A3）。
 *
 * GameState（含事务中的 immer draft）→ `@game/shared` ExprScope 的只读视图：
 * - `attr` 域视图 = `player.attrs` 并入 `player.derived`（FR-STAT-05：派生属性
 *   经 `attr.<id>` 读取；同名冲突在加载期排除，防御性以派生缓存为准）；
 * - `time` 视图由 TimeViewProvider 从 Clock 投影（默认实现见 defaultTimeView，
 *   09 号以 TimeConfig 校准后经构造函数注入覆盖）；
 * - `meta` 视图为 Profile 只读投影（§2.3 白名单 meta 行），引擎不持有 Profile
 *   （DD-04 持久化倒置），由运行时构造函数注入 provider。
 */

/** Profile 只读投影（§2.3 白名单表 meta 行：points / perk） */
export type MetaView = Pick<Profile, 'points' | 'purchasedPerks'>;

/**
 * time 求值视图提供器：Clock → {@link ExprTimeView}。
 * 缺省实现 `defaultTimeView`（weekday=(day-1)%7+1、slot=slotIndex 直传）；
 * 09 号时间系统将以 TimeConfig 校准为真实时段/星期命名并注入覆盖。
 */
export type TimeViewProvider = (clock: Clock) => ExprTimeView;

/** 作用域附加视图（缺省项走缺省投影） */
export interface ExprScopeViews {
  /** time 根视图（缺省 = defaultTimeView(state.world.time)） */
  time?: ExprTimeView;
  /** meta 根视图（缺省 = 空档投影：0 点数、无 Perk） */
  meta?: MetaView;
  /**
   * 物品基准价投影（itemId → ItemDef.price；`item.<id>.price` 的数据源，
   * 17 号缺口③方案 A）。缺省缺席 → 该路径引用 EVAL_ERROR。
   * 经济服务（定价）与需要按基准价计算的宿主填充本视图。
   */
  itemPrices?: Readonly<Record<string, number>>;
}

/**
 * 引擎扩展求值作用域（shared ExprScope 的结构超集，只增不改）：
 * world 额外透出可重建的 NPC 日程缓存，供表达式 `npc.<id>.at` 读取
 * （§4.6；12 任务 5）。shared 侧 ExprScope 保持稳定，缓存域只在本投影补充。
 */
export type EngineExprScope = ExprScope & {
  readonly world: ExprScope['world'] & {
    /** NPC 当前所在地点（仅在场者有条目；不在场/无日程 → 缺 key，读取为 null） */
    readonly npcLocationCache: Readonly<Record<GameId, GameId>>;
  };
};

/**
 * 默认时间视图（04 任务 A1：时间视图接线）。
 *
 * 投影公式：`weekday = (day-1)%7+1`、`slot = slotIndex` 直传。ExprTimeView 契约
 * （shared/expr.ts）将 weekday/slot 声明为 string（TimeConfig 接入后取时段/星期
 * 命名），因此缺省投影以数值的字符串形态给出——TimeConfig 校准前，作者表达式
 * 以 `weekday() == '3'` 比较，或由 09 号注入 TimeViewProvider 覆盖为真实命名。
 * day=0（ Clock 允许）按模 7 归一到 '7'，避免负余数。
 */
export function defaultTimeView(clock: Clock): ExprTimeView {
  return {
    day: clock.day,
    weekday: String(((((clock.day - 1) % 7) + 7) % 7) + 1),
    slot: String(clock.slotIndex),
  };
}

/** meta 根缺省视图：引擎内无 Profile 依赖（DD-04），空档 = 0 点数、无已购 Perk */
export const DEFAULT_META_VIEW: MetaView = Object.freeze({
  points: 0,
  purchasedPerks: [],
} satisfies MetaView);

/**
 * 构造表达式求值作用域（§2.3 白名单 → GameState 切片映射）。
 *
 * `state` 可为已提交的 GameState 或事务中的 immer draft（只读访问，draft 上的
 * 未提交变更对当前指令求值可见）。attr 域逐次合并 attrs 与 derived——派生属性
 * 在 recomputeDerived 的拓扑序中逐条刷新，后续公式立即可读前序结果。
 */
export function buildExprScope(state: GameState, views: ExprScopeViews = {}): EngineExprScope {
  const bagCounts: Record<string, number> = {};
  for (const entry of state.player.bag) {
    bagCounts[entry.itemId] = (bagCounts[entry.itemId] ?? 0) + entry.count;
  }
  return {
    player: {
      attrs: { ...state.player.attrs, ...state.player.derived },
      skills: state.player.skills,
      outfit: state.player.outfit,
      body: state.player.body,
      bodyProgress: state.player.bodyProgress,
      wallet: state.player.wallet,
    },
    world: {
      flags: state.world.flags,
      time: views.time ?? defaultTimeView(state.world.time),
      // 日程缓存随状态树透出（管线步骤 5 / 派生器维护，只读引用即可）
      npcLocationCache: state.world.npcLocationCache,
    },
    bagCounts,
    ...(views.itemPrices !== undefined ? { itemPrices: views.itemPrices } : {}),
    npcs: state.npcs,
    factions: state.factions,
    quests: state.quests,
    loop: state.loop,
    meta: views.meta ?? DEFAULT_META_VIEW,
  };
}
