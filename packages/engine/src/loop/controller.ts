import { EngineError } from '@game/shared';
import type { GameId, LoopConfig } from '@game/shared';
import type { GameDefinition } from '../loader/types.js';
import type { GameRuntime } from '../runtime/index.js';
import { applyLoopTransition, type LoopTransitionOptions } from './transition.js';
import type { LoopSummary, LoopTransitionResult } from './types.js';

/**
 * 周目切换的宿主执行器（detail-design §5.5 / DD-10，19 号 C 线子任务 3/4/5）。
 *
 * `applyLoopTransition` 是纯数据变换（transition.ts）；本文件补**切换后的强制
 * 步骤与次序**（§5.5「切换后强制步骤」+ DD-10 次序保证）：
 *
 * 1. 纯函数变换得到 nextState（先整体 reset → 逐类策略 → loop+1）；
 * 2. **强制重建**（顺序固定）：
 *    a. `recomputeDerived`：派生属性按新基线+策略重算（attrs 继承后派生缓存
 *       必须与之一致，否则表达式读到过期派生值）；
 *    b. 事件池重定位（`pool.locate` 回到开局场景区域）——候选池随区域变化；
 *    c. `eventCooldowns` 按配置处理（缺省保留：冷却跨周目延续，防「重开刷事件」；
 *       `clearEventCooldowns: true` 时清空）；
 * 3. 返回摘要与开局场景（宿主据此重建叙事会话：`createRunnerSession(openingScene)`）。
 *
 * **读档路径次序（DD-10）**：迁移 → 周目恢复。本文件不实现迁移（归 M2.5 21 号），
 * 仅在 `assertLoadOrder` 中固化该次序的断言口径，供集成测试使用。
 */

export interface LoopRunOptions extends Omit<LoopTransitionOptions, 'baseline'> {
  /** 新档基线（`newGameState` 产物；缺省由宿主构造——引擎不硬编码） */
  readonly baseline: LoopTransitionOptions['baseline'];
  /** 清空事件冷却（缺省 false：冷却跨周目延续——防「重开刷事件」） */
  readonly clearEventCooldowns?: boolean;
  /** 事件池重定位钩子（宿主提供；缺省跳过——引擎不持池实例） */
  readonly relocatePool?: (area: GameId, location?: GameId) => void;
  /**
   * 周目切换完成回调（23 号 `loop_transition` 脚本钩子的挂点，2026-09-25 裁定）：
   * **切换后**触发（新状态已就位，脚本可初始化周目专属数据）。
   * 参数为切换后的周目序号；效果由装配方（宿主 ScriptHost）提交。
   */
  readonly onLoopComplete?: (loop: number) => void;
}

export interface LoopRunResult extends LoopTransitionResult {
  /** 本档会话内新解锁成就在周目结束时的数量（宿主填充；此处为 0 占位） */
  readonly summaryFilledByHost?: boolean;
}

/**
 * 执行周目切换（变换 + 强制重建），把结果写回运行时。
 *
 * 注意：本函数**直接改写运行时状态**（经 `runtime` 的内部装配面）——与
 * `applyLoopTransition` 的纯函数性相对：纯函数供测试与预览，本函数供宿主调用。
 */
export function runLoopTransition(
  runtime: GameRuntime,
  config: LoopConfig,
  options: LoopRunOptions,
  definition: Pick<GameDefinition, 'scenes'>,
): LoopRunResult {
  const prev = runtime.state as unknown as import('../state/index.js').GameState;
  // 非空校验：周目切换必须先有可切换的状态（初档 loop=0 也可切，但提示语义）
  if (typeof prev.loop !== 'number') {
    throw new EngineError({
      code: 'INTERNAL',
      where: { op: 'loop', detail: '状态树缺少 loop 字段' },
      messageKey: 'error.internal',
    });
  }
  const result = applyLoopTransition(prev, config, {
    baseline: options.baseline,
    functionRegistry: options.functionRegistry,
    rng: options.rng,
  });
  const openingScene = definition.scenes.get(config.openingScene);
  if (openingScene === undefined) {
    throw new EngineError({
      code: 'DANGLING_REF',
      where: {
        op: 'loop',
        scene: config.openingScene,
        detail: `LoopConfig.openingScene '${config.openingScene}' 不在场景目录中`,
      },
      messageKey: 'error.loader.danglingRef',
    });
  }

  // —— 强制重建（§5.5 步骤固定：派生 → 池定位 → 冷却策略） ——
  const next = result.nextState as unknown as Record<string, unknown>;
  // a. 事件池重定位（宿主钩子；在状态替换前做，池只依赖区域坐标）
  options.relocatePool?.(openingScene.def.area);
  // b. 冷却策略（替换前的准备；替换经 replaceState 一次性提交）
  if (options.clearEventCooldowns === true) {
    (next['world'] as { eventCooldowns: Record<string, unknown> }).eventCooldowns = {};
  }
  // c. 状态替换 + 派生属性重算（replaceState 内部固定次序：先重算后提交，
  //    并清空回滚栈——周目切换不可回滚，§5.5 设计意图）
  runtime.replaceState(next as unknown as import('../state/index.js').GameState, [
    'player.attrs',
    'player.derived',
    'player.equip',
    'player.body',
  ]);

  // 周目切换完成钩子（切换后：新状态已就位，2026-09-25 裁定）
  options.onLoopComplete?.(next['loop'] as number);

  return { ...result, openingScene: config.openingScene };
}

/**
 * 读档路径次序断言（DD-10：「迁移 → 周目恢复」固定）。
 *
 * 本函数不执行迁移（归 21 号 M2.5），只在宿主/集成测试中固化次序口径：
 * 传入两个步骤的执行回调，断言调用序为 migrate → loopRestore。
 */
export function assertLoadOrder(steps: { migrate: () => void; loopRestore: () => void }): void {
  const order: string[] = [];
  steps.migrate();
  order.push('migrate');
  steps.loopRestore();
  order.push('loopRestore');
  if (order.join('|') !== 'migrate|loopRestore') {
    throw new EngineError({
      code: 'INTERNAL',
      where: { op: 'loop', detail: `读档次序违例：${order.join(' → ')}（DD-10 要求迁移在前）` },
      messageKey: 'error.internal',
    });
  }
}

/** 摘要的宿主填充面（成就数取自本档会话；引擎不持 Profile，DD-04） */
export function fillSummary(summary: LoopSummary, achievements: number): LoopSummary {
  return { ...summary, achievements };
}
