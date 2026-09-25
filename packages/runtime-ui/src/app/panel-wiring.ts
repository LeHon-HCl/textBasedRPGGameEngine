import type { EffectData, EncounterDef, GameId, ItemDef, Rng, ShopDef } from '@game/shared';
import type {
  BattleController,
  BattleLogEntry,
  BattlePhase,
  BattleUnit,
  PlayerAction,
} from '@game/engine';
import { createBattleController, createShopService } from '@game/engine';
import type { GameRuntime } from '@game/engine';
import type { GameDefinition } from '@game/engine';

/**
 * 面板接线（商店 / 战斗，2026-09-25）。
 *
 * **为什么单独一个模块**：引擎能力（`ShopService` / `createBattleController`）
 * 在阶段三/五已就绪，但宿主未消费其入口事件（`shop_open` / `battle_start`）
 * ——导致浏览器里点「逛杂货铺」「打岩鼠」**完全没反应**（L2-A 检查抓出的
 * 真实缺口）。本模块把两个事件的消费与面板数据投影集中在一处，宿主只做转发。
 *
 * 边界（DD-11 + #33 契约）：
 * - 引擎不接触 UI：本模块产出**只读视图**（`ShopSessionView` / `BattleSessionView`），
 *   渲染由 `ShopPanel` / `BattlePanel` 承担；
 * - 战斗的 `pollOutcome().jumps` 必须注回叙事会话（宿主负责，见 game-host 接线）；
 * - 商店交易是原子事务（`ShopService.buy/sell`），失败不改状态。
 */

/** 商店会话视图（面板渲染面） */
export interface ShopSessionView {
  readonly shopId: GameId;
  readonly nameKey: string;
  readonly currency: GameId;
  readonly wallet: number;
  readonly entries: readonly {
    readonly itemId: GameId;
    readonly nameKey: string;
    readonly priceBuy: number;
    readonly priceSell: number;
    readonly stock?: number;
    /** 当前是否买得起 */
    readonly affordable: boolean;
  }[];
}

/** 商店会话的运行期持有者（宿主内部） */
export interface ShopSessionHandle {
  readonly shopId: GameId;
  readonly service: ReturnType<typeof createShopService>;
}

export interface ShopWiringDeps {
  readonly definition: GameDefinition;
  readonly runtime: GameRuntime;
  readonly rng: Rng;
  /** 物品名文本键的来源（ItemDef 目录；缺省用 itemId 显示） */
  readonly items?: ReadonlyMap<GameId, ItemDef>;
}

/**
 * 打开商店（`shop_open` 事件的处理入口）。
 *
 * @returns 会话句柄（null = 商店不存在或定义缺失——事件已由引擎发出，
 *   此处缺失说明数据/装配问题，宿主应记为错误而非静默）
 */
export function openShop(deps: ShopWiringDeps, shopId: GameId): ShopSessionHandle | null {
  const shop: ShopDef | undefined = deps.definition.shops.get(shopId);
  if (shop === undefined) return null;
  const service = createShopService({
    state: () => deps.runtime.state as never,
    shops: deps.definition.shops,
    functionRegistry: deps.definition.functionRegistry,
    rng: deps.rng,
    ...(deps.items !== undefined ? { items: deps.items } : {}),
    runtime: deps.runtime,
    stockOf: (id, itemId) =>
      (deps.runtime.state as never as { world: { shopStock?: Record<string, number> } }).world
        .shopStock?.[`${id}/${itemId}`],
    stockAccounting: true,
  });
  return { shopId, service };
}

/** 投影商店会话为视图（每次读取现算——价格与库存随状态变化） */
export function projectShopSession(
  handle: ShopSessionHandle,
  deps: ShopWiringDeps,
): ShopSessionView {
  const shop = deps.definition.shops.get(handle.shopId) as ShopDef;
  const wallet = (deps.runtime.state as never as { player: { wallet: Record<string, number> } })
    .player.wallet;
  const currency = shop.currency ?? 'town_silver';
  const entries = handle.service.entries(handle.shopId).map((entry) => {
    const item = deps.items?.get(entry.itemId);
    return {
      itemId: entry.itemId,
      nameKey: item?.nameKey ?? entry.itemId,
      priceBuy: entry.priceBuy,
      priceSell: entry.priceSell,
      ...(entry.stock !== undefined ? { stock: entry.stock } : {}),
      affordable: (wallet[currency] ?? 0) >= entry.priceBuy,
    };
  });
  return {
    shopId: handle.shopId,
    nameKey: shop.nameKey,
    currency,
    wallet: wallet[currency] ?? 0,
    entries,
  };
}

/** 战斗会话视图（面板渲染面） */
export interface BattleSessionView {
  readonly encounterId: string;
  readonly phase: BattlePhase;
  readonly units: readonly {
    readonly uid: string;
    readonly side: BattleUnit['side'];
    readonly nameKey: string;
    readonly hp: number;
    readonly maxHp: number;
    readonly defending: boolean;
  }[];
  readonly log: readonly BattleLogEntry[];
  /** 当前是否轮到玩家输入 */
  readonly awaitingPlayer: boolean;
  /** 玩家可用行动（当前单位技能 + 固定三类） */
  readonly actions: readonly {
    readonly id: string;
    readonly label: string;
    readonly kind: PlayerAction['kind'];
    readonly needsTarget: boolean;
  }[];
}

/** 战斗行动请求（面板回调 → 宿主） */
export type BattleActionRequest =
  | { readonly kind: 'skill'; readonly skillId: string; readonly targetUid?: string }
  | { readonly kind: 'defend' }
  | { readonly kind: 'flee' };

export interface BattleWiringDeps {
  readonly definition: GameDefinition;
  readonly runtime: GameRuntime;
  readonly rng: Rng;
  /** 玩家参战技能（缺省从运行时技能表投影；无技能则只有 defend/flee） */
  readonly playerSkills?: readonly { readonly id: string; readonly mult?: number }[];
}

/** 创建战斗会话（`battle_start` 事件的处理入口） */
export function startBattle(
  deps: BattleWiringDeps,
  encounterId: string,
  branches: {
    readonly onVictory?: readonly EffectData[];
    readonly onDefeat?: readonly EffectData[];
    readonly onEscape?: readonly EffectData[];
  },
): BattleController {
  return createBattleController({
    definition: deps.definition,
    runtime: deps.runtime,
    encounterId: encounterId as never,
    branches,
    playerSkills:
      deps.playerSkills?.map((skill) => ({
        id: skill.id,
        params: { mult: skill.mult ?? 1 },
      })) ?? [],
    rng: deps.rng,
  });
}

/** 投影战斗会话为视图 */
export function projectBattleSession(
  controller: BattleController,
  encounterId: string,
): BattleSessionView {
  const session = controller.session;
  const phase = session.phase();
  const units = session.units().map((unit) => ({
    uid: unit.uid,
    side: unit.side,
    nameKey: unit.nameKey,
    hp: unit.hp,
    maxHp: unit.maxHp,
    defending: unit.defending === true,
  }));
  const playerUnit = session.units().find((unit) => unit.side === 'player');
  return {
    encounterId,
    phase,
    units,
    log: [...session.log()],
    awaitingPlayer: phase === 'await_player',
    actions: [
      ...(playerUnit?.skills ?? []).map((skill) => ({
        id: skill.id,
        label: skill.id,
        kind: 'skill' as const,
        needsTarget: true,
      })),
      { id: 'defend', label: '防御', kind: 'defend' as const, needsTarget: false },
      { id: 'flee', label: '逃跑', kind: 'flee' as const, needsTarget: false },
    ],
  };
}

/** 对手的展示名（遭遇定义的开场键等；供面板标题） */
export function encounterOf(
  definition: GameDefinition,
  encounterId: string,
): EncounterDef | undefined {
  return definition.encounters.get(encounterId as never);
}
