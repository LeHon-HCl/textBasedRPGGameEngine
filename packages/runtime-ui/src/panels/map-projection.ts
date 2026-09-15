import type { AreaDef, GameId, LocationDef, TextKey } from '@game/shared';

/**
 * 地图导航投影（设计 §6.2 MapPanelProps / FR-UI-02）。
 *
 * 数据面：区域图 + 地点列表（解锁状态 + 移动消耗）+ 当前位置高亮提示。
 * 判定口径：
 * - 区域解锁由 `world.unlockedAreas` 承载（§3.1 状态域；`unlock` 指令写入）；
 * - 地点解锁由地点自身的 `unlockIf` 表达式判定（§2.4 LocationDef）；
 * - 引擎不解释解锁语义（中立性）：锁定地点只透出**条件原文**作为提示词料，
 *   文案由游戏配置（FR-UI-02「文案由游戏配置」）。
 */

/** 地图地点视图（FR-UI-02 地点列表项） */
export interface MapLocationView {
  readonly id: GameId;
  readonly nameKey: TextKey;
  /** 移动消耗时段数（FR-XPLR-02 move_cost_slots；0 = 无需耗时） */
  readonly moveCost: number;
  /** 地图坐标 [x, y]（区域图渲染用） */
  readonly mapPos: readonly [number, number];
  readonly unlocked: boolean;
  /** 解锁条件原文（仅未解锁时给出；文案由游戏配置，引擎不解释语义） */
  readonly unlockHint?: string;
  /**
   * 是否为可导航地点（FR-XPLR-02 地图导航；2026-09-15 新增）。
   * 有已解析的入口场景（`GameDefinition.locationEntries`）时为 true——点击即
   * 切换叙事场景。缺省（未提供 `locationEntries`）= 全部可导航（向后兼容旧宿主）。
   */
  readonly navigable?: boolean;
}

/** 地图区域视图（区域图节点） */
export interface MapAreaView {
  readonly id: GameId;
  readonly nameKey: TextKey;
  /** 区域是否已解锁（`world.unlockedAreas` 判定） */
  readonly unlocked: boolean;
  /** 地点列表（未解锁区域的地点逐项标记为未解锁） */
  readonly locations: readonly MapLocationView[];
}

/** 地图投影选项 */
export interface MapProjectionOptions {
  /** 已解锁区域 id 集（`state.world.unlockedAreas`） */
  readonly unlockedAreas: readonly GameId[];
  /**
   * 地点 unlockIf 求值器（原文 → 布尔）。缺省 = 全部视为已解锁
   * （与 §5.8「未标注内容恒放行」同口径：没有判定能力时不虚报锁定）。
   */
  readonly evaluate?: (expr: string) => boolean;
  /** 是否列出未解锁区域（缺省 false = 只列已解锁区域，FR-UI-02「展示已解锁」） */
  readonly includeLockedAreas?: boolean;
  /**
   * 地点→入口场景映射（`GameDefinition.locationEntries`；FR-XPLR-02 导航）。
   * 提供时按「是否有映射」标注 `navigable`；缺省 = 不标注（旧宿主行为不变）。
   */
  readonly locationEntries?: ReadonlyMap<string, GameId>;
}

/**
 * 投影区域图（见模块 TSDoc）。
 *
 * 排序：按 `nameKey` 升序（稳定且与语言无关的键序）——区域图列表不随
 * Map 插入序漂移（同一地图在不同加载序下呈现一致）。
 *
 * @param areas 区域目录（`GameDefinition.areas`）
 * @param options 解锁状态与求值器（见 {@link MapProjectionOptions}）
 */
export function projectAreaViews(
  areas: ReadonlyMap<GameId, AreaDef>,
  options: MapProjectionOptions,
): MapAreaView[] {
  const unlockedSet = new Set(options.unlockedAreas);
  const evaluate = options.evaluate;

  const views: MapAreaView[] = [];
  for (const [id, area] of areas) {
    const areaUnlocked = unlockedSet.has(id);
    if (!areaUnlocked && options.includeLockedAreas !== true) continue;
    views.push({
      id,
      nameKey: area.nameKey,
      unlocked: areaUnlocked,
      locations: projectLocations(area, areaUnlocked, evaluate, options.locationEntries),
    });
  }
  views.sort((a, b) => a.nameKey.localeCompare(b.nameKey) || a.id.localeCompare(b.id));
  return views;
}

/** 地点列表投影（区域未解锁时全部标记未解锁——区域门控优先于地点条件） */
function projectLocations(
  area: AreaDef,
  areaUnlocked: boolean,
  evaluate: ((expr: string) => boolean) | undefined,
  locationEntries: ReadonlyMap<string, GameId> | undefined,
): MapLocationView[] {
  const out: MapLocationView[] = [];
  for (const [id, location] of Object.entries(area.locations) as [GameId, LocationDef][]) {
    const condition = location.unlockIf;
    const unlocked =
      areaUnlocked && (condition === undefined || evaluate === undefined || evaluate(condition));
    out.push({
      id,
      nameKey: location.nameKey,
      moveCost: location.moveCost,
      mapPos: [location.mapPos[0], location.mapPos[1]],
      unlocked,
      // 已解锁地点不带提示（避免陈旧提示误导玩家）
      ...(unlocked || condition === undefined ? {} : { unlockHint: condition }),
      // 导航能力仅在调用方提供映射表时标注（缺省不标注 = 旧宿主行为逐字不变）
      ...(locationEntries !== undefined
        ? { navigable: locationEntries.has(`${area.id}/${id}`) }
        : {}),
    });
  }
  // 按坐标（y 后 x）稳定排序：区域图上的空间次序（同为 0,0 时回落 id 序）
  out.sort(
    (a, b) => a.mapPos[1] - b.mapPos[1] || a.mapPos[0] - b.mapPos[0] || a.id.localeCompare(b.id),
  );
  return out;
}
