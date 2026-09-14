import type { GameId, QuestDef, QuestState } from '@game/shared';
import type {
  QuestLogEntry,
  QuestLogProjectionOptions,
  QuestLogView,
  QuestStateEnum,
} from './types.js';

/**
 * 任务日志数据源投影（FR-QUEST-03，§4.5；11 任务 7）。
 *
 * 纯函数：`quests` 状态 + 任务目录 → 按状态分组的展示条目 + 追踪置顶。
 * 追踪是 UI 状态（不入存档），引擎只按调用方给出的 tracked 顺序置顶并应用
 * 上限；分组展示序固定为 {@link QUEST_LOG_STATE_ORDER}。
 */

/** 任务日志分组展示序（缺省隐藏 undiscovered；已接取/待提交优先） */
export const QUEST_LOG_STATE_ORDER: readonly QuestStateEnum[] = [
  'active',
  'ready_to_submit',
  'available',
  'failed',
  'done',
  'undiscovered',
];

/** 缺省同时追踪上限（FR-QUEST-03「可配置」，宿主可覆盖） */
export const DEFAULT_TRACKING_LIMIT = 3;

/**
 * 投影任务日志（见模块 TSDoc）。
 *
 * 条目排序：按任务目录声明序（不在目录中的状态条目追加在后），不随执行期
 * 状态对象的插入序漂移；空分组不输出。
 */
export function projectQuestLog(
  state: { readonly quests: Readonly<Record<GameId, QuestState>> },
  defs: ReadonlyMap<GameId, QuestDef>,
  options: QuestLogProjectionOptions = {},
): QuestLogView {
  const includeUndiscovered = options.includeUndiscovered ?? false;
  const trackingLimit = options.trackingLimit ?? DEFAULT_TRACKING_LIMIT;

  const entries = new Map<GameId, QuestLogEntry>();
  const orderedIds: GameId[] = [];
  for (const id of defs.keys()) {
    if (state.quests[id] !== undefined) orderedIds.push(id);
  }
  for (const id of Object.keys(state.quests)) {
    if (!orderedIds.includes(id)) orderedIds.push(id);
  }
  for (const id of orderedIds) {
    const quest = state.quests[id] as QuestState;
    entries.set(id, buildEntry(id, quest, defs.get(id)));
  }

  const groups = QUEST_LOG_STATE_ORDER.filter(
    (stateName) => includeUndiscovered || stateName !== 'undiscovered',
  )
    .map((stateName) => ({
      state: stateName,
      entries: orderedIds
        .map((id) => entries.get(id))
        .filter((entry): entry is QuestLogEntry => entry?.state === stateName),
    }))
    .filter((group) => group.entries.length > 0);

  const tracked = (options.tracked ?? [])
    .map((id) => entries.get(id))
    .filter((entry): entry is QuestLogEntry => entry !== undefined)
    .slice(0, Math.max(0, trackingLimit));

  return { groups, tracked };
}

/** 单条日志条目（可选字段缺省不写入，保持投影紧凑） */
function buildEntry(id: GameId, quest: QuestState, def: QuestDef | undefined): QuestLogEntry {
  const stage = quest.stage;
  const objectiveKey =
    stage !== undefined ? def?.stages.find((entry) => entry.id === stage)?.objectiveKey : undefined;
  return {
    quest: id,
    state: quest.state,
    ...(stage !== undefined ? { stage } : {}),
    ...(objectiveKey !== undefined ? { objectiveKey } : {}),
    ...(def?.giver !== undefined ? { giver: def.giver } : {}),
    ...(quest.startedDay !== undefined ? { startedDay: quest.startedDay } : {}),
  };
}
