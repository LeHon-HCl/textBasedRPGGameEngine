import type { EffectData, GameId, QuestState, TextKey } from '@game/shared';
import type { EngineEvent } from '../runtime/index.js';
import type { GameState } from '../state/index.js';

/**
 * 任务子系统公共类型（设计 §4.5；11 号模块）。
 *
 * 状态机与投影的类型基线：状态枚举取自 02 号 `questStateSchema`（唯一数据
 * 来源，packages/shared 只读），任务目录取自 `QuestDef`；本模块不新增存档域。
 */

/** 任务六态（§4.5；与 shared questStateSchema.state 同口径） */
export type QuestStateEnum = QuestState['state'];

/**
 * 任务操作的事务内可写上下文（QuestMachine 的唯一状态交互面）。
 *
 * 引擎子系统禁止横向直接持有状态（设计 §1.2 R5 / DD-06）：QuestMachine 不持有
 * runtime，由调用方（quest 指令 / 事务后置派生器 / 时间管线步骤 7）提供本上下文。
 * `quests` 为当前事务 draft 的可写切片，`state` 为同一 draft 的只读视图（表达式
 * 求值可见本事务前序变更）；`child` 为嵌套原子批（奖励效果），失败沿调用栈上抛
 * 使整批事务回滚（奖励原子性的实现基础，§3.3）。
 */
export interface QuestContext {
  /** 可写 quests 域（immer draft 切片；键为任务 id） */
  readonly quests: Record<GameId, QuestState>;
  /** 只读状态视图（同一事务 draft；acceptIf/completeWhen/failWhen 求值用） */
  readonly state: Readonly<GameState>;
  /** 条件表达式求值（原文 → 真值化）；由调用方按自身编译/求值管线提供 */
  evalCondition(source: string): boolean;
  /** 嵌套原子批：rewards 等子效果（任一失败 → 整批事务回滚） */
  child(effects: readonly EffectData[]): void;
  /** 发射引擎事件（进当前事务 frame，提交后统一送达 on() 总线） */
  emit(event: EngineEvent): void;
}

/** 目标进度投影（FR-QUEST-05 文本插值数据源；1 条 = 1 个阶段目标） */
export interface ObjectiveProgress {
  /** 阶段 id（QuestDef.stages[].id） */
  stageId: string;
  /** 目标文本键（QuestDef.stages[].objectiveKey） */
  objectiveKey: TextKey;
  /** 该阶段目标是否已达成（done/ready_to_submit 或已越过该阶段） */
  complete: boolean;
  /** 进度数值（来自 QuestState.objectives[stageId]，缺省按完成与否取 1/0） */
  value: number;
}

/** 任务日志条目（FR-QUEST-03：按状态分组的展示数据源） */
export interface QuestLogEntry {
  quest: GameId;
  state: QuestStateEnum;
  /** 当前阶段 id（无阶段目录或缺省时省略） */
  stage?: string;
  /** 当前阶段目标文本键 */
  objectiveKey?: TextKey;
  /** 发布者 NPC（QuestDef.giver） */
  giver?: GameId;
  /** 接取日（QuestState.startedDay） */
  startedDay?: number;
}

/** 任务日志分组（同状态条目聚合一档） */
export interface QuestLogGroup {
  state: QuestStateEnum;
  entries: readonly QuestLogEntry[];
}

/** 任务日志投影（FR-QUEST-03：分组 + 追踪置顶；追踪为 UI 状态，引擎只投影） */
export interface QuestLogView {
  groups: readonly QuestLogGroup[];
  /** 追踪置顶条目（按调用方 tracked 顺序；受 trackingLimit 限制） */
  tracked: readonly QuestLogEntry[];
}

/** 任务日志投影选项 */
export interface QuestLogProjectionOptions {
  /** 追踪中的任务 id（按给定顺序置顶；缺省 = 不置顶） */
  tracked?: readonly GameId[];
  /** 同时追踪上限（FR-QUEST-03「可配置」；缺省 3） */
  trackingLimit?: number;
  /** 是否包含 undiscovered 分组（缺省 false：未发现任务不入日志） */
  includeUndiscovered?: boolean;
}
