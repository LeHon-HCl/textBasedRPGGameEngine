import { createRng } from '@game/shared';
import type { EffectData, FlagValue, GameId, QuestDef, QuestState } from '@game/shared';
import { newGameState } from '../../src/state/new-game.js';
import type { GameState } from '../../src/state/index.js';
import type { EngineEvent } from '../../src/runtime/index.js';
import type { QuestContext } from '../../src/quests/types.js';

/**
 * quests 测试夹具（11 号任务共用）：
 * - `makeState`：最小新档状态（可注入起始日 / flags / 预置任务状态）；
 * - `makeDefs`：QuestDef 数组 → 目录 Map；
 * - `makeHarness`：QuestContext 记录桩（表达式求值脚本化、child/emit 记录），
 *   供状态机单测在不接 runtime 的前提下断言事件、子事务与「不轮询」调用次数。
 */

/** 新档版本三元组（测试基线，与其他子系统夹具一致） */
export const BASE_VERSIONS = { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' };

/** 最小新档状态（attrs 必填；quests 预置由调用方覆盖） */
export function makeState(
  init: {
    day?: number;
    flags?: Record<string, FlagValue>;
    quests?: Record<GameId, QuestState>;
  } = {},
): GameState {
  const state = newGameState(
    {
      versions: BASE_VERSIONS,
      attrs: { hp: 10 },
      ...(init.day !== undefined ? { time: { day: init.day, slotIndex: 0 } } : {}),
      ...(init.flags !== undefined ? { flags: init.flags } : {}),
    },
    createRng(1),
  );
  if (init.quests !== undefined) state.quests = init.quests;
  return state;
}

/** QuestDef 数组 → 目录 Map（键为 id，保留声明顺序） */
export function makeDefs(defs: readonly QuestDef[]): Map<GameId, QuestDef> {
  return new Map(defs.map((def) => [def.id, def]));
}

/** 脚本化条件求值的记录桩；未登记的表达式一律 false */
export interface ConditionScript {
  readonly calls: string[];
  set(source: string, value: boolean): void;
  eval(source: string): boolean;
}

export function makeConditions(init: Record<string, boolean> = {}): ConditionScript {
  const table = new Map(Object.entries(init));
  const calls: string[] = [];
  return {
    calls,
    set(source, value) {
      table.set(source, value);
    },
    eval(source) {
      calls.push(source);
      return table.get(source) ?? false;
    },
  };
}

/** QuestContext + 记录面 */
export interface QuestHarness {
  readonly state: GameState;
  readonly ctx: QuestContext;
  readonly events: EngineEvent[];
  readonly children: readonly EffectData[][];
  readonly conditions: ConditionScript;
  /** 覆盖 child 行为（如注入奖励失败以验证回滚由 runtime 承担） */
  onChild?: (effects: readonly EffectData[]) => void;
}

export function makeHarness(
  init: {
    day?: number;
    quests?: Record<GameId, QuestState>;
    conditions?: Record<string, boolean>;
    onChild?: (effects: readonly EffectData[]) => void;
  } = {},
): QuestHarness {
  const state = makeState({
    ...(init.day !== undefined ? { day: init.day } : {}),
    ...(init.quests !== undefined ? { quests: init.quests } : {}),
  });
  const conditions = makeConditions(init.conditions ?? {});
  const events: EngineEvent[] = [];
  const children: EffectData[][] = [];
  const harness: QuestHarness = {
    state,
    conditions,
    events,
    children,
    ctx: {
      quests: state.quests,
      state,
      evalCondition: (source) => conditions.eval(source),
      child: (effects) => {
        harness.onChild?.(effects);
        children.push([...effects]);
      },
      emit: (event) => {
        events.push(event);
      },
    },
  };
  return harness;
}

/** 单阶段任务目录（给定 completeWhen，复用于阶段推进用例） */
export function stageQuest(
  id: string,
  stages: readonly { id: string; objectiveKey: string; completeWhen: string }[],
  extra: Partial<QuestDef> = {},
): QuestDef {
  return { id, stages: [...stages], ...extra } as QuestDef;
}
