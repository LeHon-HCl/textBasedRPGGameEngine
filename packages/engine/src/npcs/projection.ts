import type { GameId, NpcDef, TextKey } from '@game/shared';
import type { GameState } from '../state/index.js';

/**
 * 关系面板数据投影（FR-NPCR-05；§4.6；12 任务 7）。
 *
 * 纯函数层：GameState.npcs + 日程缓存 + NPC 目录 → 框架无关视图（runtime-ui
 * 关系面板的唯一数据源口径）。不读语言包、不改状态——给什么投影什么。
 *
 * 视图口径：
 * - 已结识（`met`）筛选：缺省只列已结识 NPC，`includeUnmet` 纳入全部；
 * - 关系阶段：state.npcs[id].stage 经目录 FavorDef.stages 解析出 nameKey
 *   （引擎不解释阶段语义，只做 id → 文本键映射；未知 id → undefined）；
 * - 好感显隐策略（FR-NPCR-05「隐藏数值只显示阶段是常见做法」）：缺省
 *   `favor` 字段为 undefined（不透出数值），`showFavor=true` 才给出；
 * - 当前地点：读 `world.npcLocationCache`（在场者有条目），不在场 → null；
 * - 排序：缺省保持状态树条目序；'id' 字典序 / 'favor' 降序 / 'stage' 阶段 id。
 */

/** 关系阶段视图（id + 文本键，UI 经语言包解析） */
export interface RelationshipStageView {
  readonly id: string;
  readonly nameKey: TextKey;
}

/** 单个 NPC 的关系面板条目 */
export interface RelationshipEntryView {
  readonly npcId: GameId;
  readonly nameKey: TextKey;
  /** 是否已结识（FR-NPCR-01/05） */
  readonly met: boolean;
  /** 当前关系阶段（未达任何阶段或阶段 id 不在目录 → undefined） */
  readonly stage: RelationshipStageView | undefined;
  /** 好感数值（显隐策略：缺省不透出，undefined） */
  readonly favor: number | undefined;
  /** 当前所在地点（不在场 / 无日程 → null） */
  readonly at: GameId | null;
}

/** 关系面板视图 */
export interface RelationshipPanelView {
  readonly entries: readonly RelationshipEntryView[];
}

/** 投影选项（全部可选） */
export interface RelationshipProjectionOptions {
  /** 透出好感数值（缺省 false：只显示阶段，隐藏进度条数值） */
  readonly showFavor?: boolean;
  /** 纳入未结识 NPC（缺省 false：只列已结识） */
  readonly includeUnmet?: boolean;
  /** 排序键：缺省保持状态树条目序 */
  readonly sort?: 'id' | 'favor' | 'stage';
}

/**
 * 关系面板投影（FR-NPCR-05）。
 *
 * 遍历 state.npcs 建档条目（未建档 NPC 尚未登场，不出现）；目录缺失时回退
 * 约定文本键 `npcs.<id>`（不抛错——投影层不因目录不全中断 UI）。
 */
export function projectRelationships(
  state: GameState,
  npcs: ReadonlyMap<string, NpcDef>,
  options: RelationshipProjectionOptions = {},
): RelationshipPanelView {
  const includeUnmet = options.includeUnmet === true;
  const showFavor = options.showFavor === true;
  const cache = state.world.npcLocationCache;

  const entries: RelationshipEntryView[] = [];
  for (const [npcId, record] of Object.entries(state.npcs)) {
    if (!includeUnmet && !record.met) continue;
    const def = npcs.get(npcId);
    const stageId = record.stage;
    const stageDef =
      stageId !== undefined ? def?.favor?.stages.find((stage) => stage.id === stageId) : undefined;
    entries.push({
      npcId,
      nameKey: def?.nameKey ?? (`npcs.${npcId}` as TextKey),
      met: record.met,
      // 未知/目录缺失的阶段 id 不透出（引擎不臆造阶段语义）
      stage: stageDef !== undefined ? { id: stageDef.id, nameKey: stageDef.nameKey } : undefined,
      favor: showFavor ? record.favor : undefined,
      at: cache[npcId] ?? null,
    });
  }

  switch (options.sort) {
    case 'id':
      entries.sort((a, b) => a.npcId.localeCompare(b.npcId));
      break;
    case 'favor':
      entries.sort((a, b) => (state.npcs[b.npcId]?.favor ?? 0) - (state.npcs[a.npcId]?.favor ?? 0));
      break;
    case 'stage':
      entries.sort((a, b) => {
        const left = a.stage?.id ?? '';
        const right = b.stage?.id ?? '';
        return left === right ? a.npcId.localeCompare(b.npcId) : left.localeCompare(right);
      });
      break;
    default:
      break;
  }
  return { entries };
}
