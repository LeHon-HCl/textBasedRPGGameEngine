import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 阅读 QoL 控制（设计 §6.4 / FR-READ-01/02，25 号 B1）。
 *
 * 三项能力（全部为 **UI 侧状态**，不入存档——与任务追踪同规）：
 * 1. **已读跳过**（FR-READ-01）：`seen.scenes` 中已访问场景的段落直接全显，
 *    不播打字机；
 * 2. **自动播放**（FR-READ-02）：`await_advance` 相位到期自动 `onAdvance()`；
 *    **遇选项/判定/战斗一律暂停**（设计明示的安全边界——不让玩家被自动推进
 *    推进危险决策）；
 * 3. **手动跳过**（阅读中点击 = 立即全显当前段）与 **跳过开关**（持续跳过）。
 *
 * 状态放置：本 hook 供宿主/AppShell 使用，状态经 store 之外的组件状态管理
 * （UI 偏好，不跨存档；若需持久化归设置面板的 localStorage 面）。
 */

/** 阅读控制选项 */
export interface ReadingControlOptions {
  /** 自动播放间隔（ms/段；≤0 = 关闭自动播放） */
  readonly autoDelayMs?: number;
  /** 当前相位（决定自动播放是否可推进；非 await_advance 一律暂停） */
  readonly phase?: 'entering' | 'await_advance' | 'await_choice' | 'resolving' | 'finished';
  /** 推进回调（自动播放触发） */
  readonly onAdvance?: () => void;
  /** 当前段落标识（段落推进时变化；一次性跳过的失效依据与自动播放的重计时依据） */
  readonly segmentKey?: string;
}

/** 阅读控制面（受控状态 + 动作） */
export interface ReadingControl {
  /** 跳过开关状态（true = 后续段落全部直接全显） */
  readonly skipEnabled: boolean;
  /** 自动播放开关状态 */
  readonly autoEnabled: boolean;
  /** 切换跳过；关闭时立即生效（下一段恢复打字机） */
  toggleSkip(): void;
  /** 切换自动播放（遇到不可推进相位时自动挂起，恢复后继续） */
  toggleAuto(): void;
  /** 手动跳过当前段（一次性；不改变 skipEnabled） */
  skipCurrent(): void;
  /** 当前时刻是否应全显（skipEnabled 或本次已手动跳过） */
  readonly revealInstantly: boolean;
  /** 自动播放是否正在计时（UI 可显示状态） */
  readonly autoActive: boolean;
}

/**
 * 阅读控制的实现（纯逻辑 + 定时器）。
 *
 * 自动播放的暂停语义（FR-READ-02「遇选项/判定/战斗暂停」）：
 * 仅当 `phase === 'await_advance'` 时才计时推进；进入其他相位立即清定时器
 * （恢复 await_advance 后重新计时——不做「补播」）。
 */
export function useReadingControl(options: ReadingControlOptions = {}): ReadingControl {
  const [skipEnabled, setSkipEnabled] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(false);
  /**
   * 一次性跳过：记录「已请求跳过的段落标识」。段落推进时由调用方传入新的
   * `segmentKey`，标记自动失效（无需手动重置，避免时序耦合）。
   */
  const [skippedSegment, setSkippedSegment] = useState<string | null>(null);
  const delay = options.autoDelayMs ?? 1500;
  const phase = options.phase;
  const segmentKey = options.segmentKey ?? '';
  const onAdvance = options.onAdvance;

  const onAdvanceRef = useRef(onAdvance);
  onAdvanceRef.current = onAdvance;

  // 自动播放：仅在 await_advance 相位计时（遇选项/判定/战斗自动暂停）
  const autoActive = autoEnabled && phase === 'await_advance' && delay > 0;
  useEffect(() => {
    if (!autoActive) return undefined;
    const timer = setTimeout(() => {
      onAdvanceRef.current?.();
    }, delay);
    return () => {
      clearTimeout(timer);
    };
    // segmentKey 变化（新段落）会重新计时——每段一段延时
  }, [autoActive, phase, delay, segmentKey]);

  const toggleSkip = useCallback(() => {
    setSkipEnabled((current) => !current);
  }, []);
  const toggleAuto = useCallback(() => {
    setAutoEnabled((current) => !current);
  }, []);
  const skipCurrent = useCallback(() => {
    setSkippedSegment(segmentKey);
  }, [segmentKey]);

  return {
    skipEnabled,
    autoEnabled,
    toggleSkip,
    toggleAuto,
    skipCurrent,
    // 手动跳过为一次性：仅对请求时的那个段落生效（段落推进后自动失效）
    revealInstantly: skipEnabled || skippedSegment === segmentKey,
    autoActive,
  };
}

/**
 * 已读判定（FR-READ-01）：场景是否已访问过。
 *
 * 口径：以 `seen.scenes`（引擎状态树）为唯一判据——「已读」= 场景曾渲染过
 * （08 号在正常会话渲染时写入，见 SceneRunner 的 pushHistory 配套面）。
 * 首次访问的场景不跳过（玩家没读过）。
 */
export function isSceneRead(sceneId: string, seenScenes: readonly string[]): boolean {
  return seenScenes.includes(sceneId);
}
