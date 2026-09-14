import { EngineError } from '@game/shared';
import type { QuestStateEnum } from './types.js';

/**
 * 任务六态迁移规则表（设计 §4.5 状态迁移规则表；11 任务 1）。
 *
 * 状态机以**纯函数表驱动**：全部合法迁移集中在 {@link QUEST_TRANSITIONS}，
 * QuestMachine 的每个操作在写入前经 {@link assertTransition} 校验——非法迁移
 * 统一抛 `EFFECT_FAILED{op:'quest', detail}`（拒绝原因可读，FR-QUEST-04）。
 *
 * 六态语义：
 * - `undiscovered` 未发现：不在任务日志；可经 `reveal`（发现）或直接 `accept` 激活；
 * - `available` 可接取：acceptIf 已满足但尚未接取；
 * - `active` 进行中：有当前阶段；同态自迁移表示阶段内推进（stage）；
 * - `ready_to_submit` 待提交：末阶段 completeWhen 已达成，等待 submit；
 * - `done` / `failed` 终态：无出边。
 */

/** 六态全集（声明顺序即状态机枚举；与 shared questStateSchema 一致） */
export const QUEST_STATES = [
  'undiscovered',
  'available',
  'active',
  'ready_to_submit',
  'done',
  'failed',
] as const satisfies readonly QuestStateEnum[];

/** 迁移触发入口（拒绝定位与测试矩阵的维度） */
export type QuestTransitionVia = 'reveal' | 'accept' | 'stage' | 'submit' | 'complete' | 'fail';

/** 迁移规则（from → to，由 via 触发） */
export interface QuestTransitionRule {
  readonly from: QuestStateEnum;
  readonly to: QuestStateEnum;
  readonly via: QuestTransitionVia;
}

/**
 * 合法迁移规则表（§4.5）。
 *
 * 说明：
 * - `undiscovered → active`：无发现门的直接接取（05 号既有语义，保留）；
 * - `active → active`：阶段推进（stage）不改变六态，故以自迁移表达；
 * - `active → done`：作者显式 complete 的强制完成（05 号语义，保留）；
 *   `ready_to_submit → done` 才是奖励结算的 submit 正路；
 * - 终态 `done` / `failed` 无出边（不可复活）。
 */
export const QUEST_TRANSITIONS: readonly QuestTransitionRule[] = [
  { from: 'undiscovered', to: 'available', via: 'reveal' },
  { from: 'undiscovered', to: 'active', via: 'accept' },
  { from: 'available', to: 'active', via: 'accept' },
  { from: 'active', to: 'active', via: 'stage' },
  { from: 'active', to: 'ready_to_submit', via: 'stage' },
  { from: 'active', to: 'done', via: 'complete' },
  { from: 'ready_to_submit', to: 'done', via: 'complete' },
  { from: 'ready_to_submit', to: 'done', via: 'submit' },
  { from: 'active', to: 'failed', via: 'fail' },
  { from: 'ready_to_submit', to: 'failed', via: 'fail' },
] as const;

/** 判断 from → to 是否为合法迁移（表驱动；不校验 via） */
export function canTransition(from: QuestStateEnum, to: QuestStateEnum): boolean {
  return QUEST_TRANSITIONS.some((rule) => rule.from === from && rule.to === to);
}

/** 取 from → to 的合法触发方式集合（诊断/测试用） */
export function transitionVias(
  from: QuestStateEnum,
  to: QuestStateEnum,
): readonly QuestTransitionVia[] {
  return QUEST_TRANSITIONS.filter((rule) => rule.from === from && rule.to === to).map(
    (rule) => rule.via,
  );
}

/**
 * 迁移断言（表驱动）：非法迁移抛 EFFECT_FAILED（op='quest'，detail 描述
 * `无法从 <from> 迁移到 <to>（<via>）`）。调用方在执行任何状态写入前调用，
 * 保证状态树只落入规则表覆盖的形态。
 */
export function assertTransition(
  from: QuestStateEnum,
  to: QuestStateEnum,
  via: QuestTransitionVia,
): void {
  if (canTransition(from, to)) return;
  throw new EngineError({
    code: 'EFFECT_FAILED',
    where: {
      op: 'quest',
      detail: `非法状态迁移：${from} → ${to}（${via}）`,
    },
    messageKey: 'error.effects.instructionFailed',
  });
}
