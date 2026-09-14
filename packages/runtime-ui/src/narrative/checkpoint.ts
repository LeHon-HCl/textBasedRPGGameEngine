/**
 * 选择前 checkpoint（设计 §6.3 回滚行 / FR-READ-03）。
 *
 * 语义：玩家**每次选择前**打一个快照，使「回退」能回到上一次选择点。
 * 顺序不可交换：必须先 checkpoint 再执行选择——先执行后打卡会丢掉执行前状态。
 *
 * 与引擎的分工（DD-06）：快照本体与回滚实现归 `GameRuntime.checkpoint/rollback`
 * （§3.1 回滚栈，含 RNG 状态复原，DD-09）；本模块只承担「何时打点」的编排，
 * 并以结构化最小接口注入，便于无运行时单测（§1.3 原则 2）。
 */

/** checkpoint 所需的最小运行时视图（GameRuntime 结构化满足） */
export interface CheckpointRuntime {
  /** 打快照（标签仅用于诊断与 UI 呈现，§3.1） */
  checkpoint(label: string): void;
  /** 回滚 N 步（steps 内是引擎语义；返回是否成功与恢复点标签） */
  rollback(steps?: number): { ok: boolean; restoredLabel?: string };
}

/** 选择定位（快照标签的数据源） */
export interface ChoiceTarget {
  readonly sceneId: string;
  readonly choiceId: string;
}

/**
 * 构造选择快照标签：`choice:<scene>:<choiceId>`。
 *
 * 为什么带场景：回滚栈是跨场景的（会话可经 goto 跳转），标签里保留场景
 * 才能让调试面板与玩家提示指出「回到哪个场景的哪次选择」。
 */
export function choiceCheckpointLabel(target: ChoiceTarget): string {
  return `choice:${target.sceneId}:${target.choiceId}`;
}

/** 选择执行结果（成功返回值 / 失败详情） */
export type ChoiceExecutionResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      /** 原始异常（非 Error 抛出物已包装，诊断面统一形态） */
      readonly error: Error;
      /** 失败后回滚到的快照标签（回滚不可用时为 undefined） */
      readonly restoredLabel?: string;
    };

/**
 * 创建「先打点再执行」的选择执行器（见模块 TSDoc）。
 *
 * @param runtime checkpoint / rollback 的最小运行时视图
 * @returns 执行器：接受选择定位与执行体，返回执行结果
 */
export function createChoiceCheckpoint(runtime: CheckpointRuntime) {
  return function runChoice<T>(target: ChoiceTarget, execute: () => T): T {
    runtime.checkpoint(choiceCheckpointLabel(target));
    return execute();
  };
}

/**
 * 「打点 → 执行 → 失败自动回滚」的一体化执行器（FR-READ-03 推荐用法）。
 *
 * 为什么失败要自动回滚：`SceneRunner.choose` 失败时会话可能停留在 `resolving`
 * 相位（§4.2 错误挂起态），宿主经 rollback 恢复是设计约定的配套动作；
 * 回滚一步即回到本次选择前的快照。
 *
 * @param runtime checkpoint / rollback 的最小运行时视图
 * @param target 选择定位（场景 + 选项 id）
 * @param execute 选择执行体（通常为 `session.choose(id)` 与随后的会话投影）
 */
export function withChoiceCheckpoint<T>(
  runtime: CheckpointRuntime,
  target: ChoiceTarget,
  execute: () => T,
): ChoiceExecutionResult<T> {
  runtime.checkpoint(choiceCheckpointLabel(target));
  try {
    return { ok: true, value: execute() };
  } catch (error) {
    const restored = runtime.rollback(1);
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
      ...(restored.restoredLabel !== undefined ? { restoredLabel: restored.restoredLabel } : {}),
    };
  }
}
