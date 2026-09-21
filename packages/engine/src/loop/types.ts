import type { GameId } from '@game/shared';
import type { GameState } from '../state/index.js';

/**
 * 周目系统契约（detail-design §5.5，19 号；**P0 冻结面**——变更只增不改）。
 *
 * - {@link applyLoopTransition}（实现归 loop/transition.ts）：纯数据变换——
 *   先整体 reset → 逐类 apply 策略（§5.5 顺序固定）；
 * - {@link LoopSummary}：转场摘要数据（天数/事件数/成就），宿主渲染转场界面
 *   （FR-LOOP-03）；
 * - 次序（DD-10）：读档路径「迁移 → 周目恢复」固定；周目切换后强制
 *   `recomputeDerived` + 事件池/日程缓存按配置重建。
 */

/** 周目转场摘要（FR-LOOP-03；宿主转场界面的数据源） */
export interface LoopSummary {
  /** 新周目序号（切换后；首周目 = 1） */
  readonly loop: number;
  /** 上一周目总游戏天数 */
  readonly days: number;
  /** 上一周目触发事件总数（world.counters 的事件类计数累计） */
  readonly events: number;
  /** 上一周目解锁成就数（本档会话内；Profile 全量为跨档口径） */
  readonly achievements: number;
}

/** 周目切换结果（§5.5 applyLoopTransition 返回面） */
export interface LoopTransitionResult {
  readonly nextState: GameState;
  readonly summary: LoopSummary;
  /** 转场后的开局场景（LoopConfig.openingScene） */
  readonly openingScene: GameId;
}
