import type { GameId, TextKey } from '@game/shared';
import type { GameRuntime, Unsubscribe } from '@game/engine';

/**
 * UiStore 状态切片类型（设计 §6.2）。
 *
 * 与游戏的 GameState 分离：UiStore 只承载**界面状态**（当前屏幕、面板开合、
 * Toast 队列、数值高亮），游戏状态一律经 `runtime.state` 读取——避免双份真相。
 */

/** 顶层屏幕（§6.2 screen 判别联合的落地） */
export type Screen = 'title' | 'creation' | 'perks' | 'game' | 'panels';

/** 侧栏面板 id（Drawer 挂载面，§6.2 组件树） */
export type PanelId =
  'status' | 'map' | 'quest' | 'settings' | 'gallery' | 'achievements' | 'debug';

/** 移动端 Tab（§6.2 panels.mobileTab，FR-UI-09 侧栏折叠形态） */
export type MobileTab = 'status' | 'map' | 'quest';

/**
 * 会话投影（§6.2 SessionView）：SceneRunner 的只读快照。
 *
 * 不直接持有 SceneRunner 实例——会话推进由宿主（App/集成层）驱动后
 * 经 setSession 投影进来，组件只消费纯数据（props 受控、可 Testing Library 测）。
 */
export interface SessionView {
  /** 会话相位（§4.2 RunnerPhase；此处保留同一字面量口径） */
  readonly phase: 'entering' | 'await_advance' | 'await_choice' | 'resolving' | 'finished';
  /** 当前场景 id */
  readonly sceneId: GameId;
  /** 已揭示的段落流（renderList 快照） */
  readonly segments: readonly SessionSegmentView[];
  /** 当前可用选项（choices 快照；含 hiddenByFilter 条目，由渲染层决定跳过） */
  readonly choices: readonly SessionChoiceView[];
  /** 终局类型（phase='finished' 时有值，§4.2 NarrativeEndReason） */
  readonly endReason?: 'exhausted' | 'ending' | 'back' | 'loop';
  /** 结局 id（endReason='ending' 时有值） */
  readonly endingId?: string;
}

/** 段落视图（RenderSegment 的可渲染投影；文本键 + 延迟插值变量，D4） */
export interface SessionSegmentView {
  readonly kind: 'text' | 'spacing' | 'image';
  readonly key?: TextKey;
  readonly literal?: string;
  readonly vars?: Readonly<Record<string, unknown>>;
  /** 媒体意图（DD-05：播放器消费；此处为只读透传） */
  readonly media?: readonly SessionMediaView[];
}

/** 媒体意图视图（与引擎 MediaIntent 结构等价的最小面，避免 UI 侧深绑） */
export interface SessionMediaView {
  readonly type: 'bg' | 'cg' | 'sprite' | 'bgm' | 'sfx';
  readonly assetId: string;
  readonly transition?: 'fade' | 'cut';
  readonly loop?: true;
  /** 资源缺失占位标记（FR-MEDIA-06） */
  readonly missing?: true;
}

/** 选项视图（ChoiceView 的 UI 侧同形投影） */
export interface SessionChoiceView {
  readonly id: string;
  readonly textKey: TextKey;
  readonly enabled: boolean;
  readonly disabledReasonKey?: TextKey;
  readonly hiddenByFilter?: boolean;
}

/** 通知类别（FR-UI-07：成就/物品/属性/系统统一 Toast 出口） */
export type ToastKind = 'notify' | 'achievement' | 'item' | 'stat' | 'system' | 'quest';

/**
 * Toast 条目（§6.2 notifications；合并策略见 toast.ts）。
 * `count` > 1 表示同类通知在合并窗口内被折叠，UI 呈「×N」。
 */
export interface ToastItem {
  readonly id: number;
  readonly kind: ToastKind;
  readonly textKey: TextKey;
  readonly vars?: Readonly<Record<string, unknown>>;
  /** 合并计数（同类窗口内重复推送时递增） */
  readonly count: number;
  /** 入队时刻（epoch 毫秒；合并窗口与自动消失的判据） */
  readonly at: number;
}

/** 数值变化高亮（FR-STAT-04 / FR-UI-03；StatusPanel 内部动画数据，不占 Toast） */
export interface StatHighlight {
  readonly from: number;
  readonly to: number;
  readonly delta: number;
  /** 记录时刻（epoch 毫秒；高亮动画的起始基准） */
  readonly at: number;
}

/** 面板开合切片（§6.2 panels） */
export interface PanelsSlice {
  readonly open: PanelId | null;
  readonly mobileTab: MobileTab;
}

/**
 * UiStore 完整状态（设计 §6.2 的落地：runtime/session/notifications/panels
 * 四切片 + 屏幕与高亮）。
 */
export interface UiState {
  readonly screen: Screen;
  /** 当前运行时（null = 未开局；测试可注入桩） */
  readonly runtime: GameRuntime | null;
  readonly session: SessionView;
  readonly notifications: readonly ToastItem[];
  readonly panels: PanelsSlice;
  /** attr id → 最近一次数值变化（FR-STAT-04 增量高亮） */
  readonly statHighlights: Readonly<Record<string, StatHighlight>>;
  /**
   * 任务面板重算信号（单调递增）：任务状态变更没有可比较的对象引用，
   * 以版本号驱动 selector 失效，避免面板对全量 quests 深比较。
   */
  readonly questRevision: number;
}

/** UiStore 动作面（与状态同文件，保证「状态 + 变更入口」单一来源） */
export interface UiActions {
  setScreen(screen: Screen): void;
  setRuntime(runtime: GameRuntime | null): void;
  setSession(session: SessionView): void;
  openPanel(panel: PanelId | null): void;
  setMobileTab(tab: MobileTab): void;
  pushNotification(item: {
    kind: ToastKind;
    textKey: TextKey;
    vars?: Record<string, unknown>;
    at?: number;
  }): void;
  dismissNotification(id: number): void;
  clearNotifications(): void;
  noteStatChange(change: {
    attr: string;
    from: number;
    to: number;
    delta: number;
    at?: number;
  }): void;
  /** 清除高亮：给 attrs 时只清给定属性，缺省清空全部 */
  clearStatHighlights(attrs?: readonly string[]): void;
  bumpQuestRevision(): void;
  reset(): void;
}

/** UiStore API（Zustand vanilla store 的最小面：getState/subscribe/setState） */
export interface UiStoreApi {
  getState(): UiState & UiActions;
  subscribe(listener: (state: UiState & UiActions) => void): Unsubscribe;
  setState(partial: Partial<UiState>): void;
}

/** 空会话缺省值（title 屏的占位；避免组件对 undefined 分支） */
export const EMPTY_SESSION: SessionView = Object.freeze({
  phase: 'entering' as const,
  sceneId: '',
  segments: [],
  choices: [],
});

/** UiStore 初始状态（工厂函数每次产出独立快照，实例互不串扰） */
export function initialUiState(): UiState {
  return {
    screen: 'title',
    runtime: null,
    session: EMPTY_SESSION,
    notifications: [],
    panels: { open: null, mobileTab: 'status' },
    statHighlights: {},
    questRevision: 0,
  };
}

/**
 * 事件订阅桥（§6.2「GameRuntime.on(EngineEvent) → store 更新」，任务 1）。
 *
 * 订阅引擎事件总线并把**状态派生型**事件翻译为 UiStore 动作：
 * - stat_changed → noteStatChange（FR-STAT-04 数值增量高亮）；
 * - notify → pushNotification（FR-UI-07 统一 Toast 出口）；
 * - quest_state_changed / quest_stage → bumpQuestRevision（任务面板重算信号）；
 * - unlock / check_result / media / favor_stage_changed / reputation_band_changed /
 *   item_expired / snapshot_warn 由宿主按需订阅（不在此翻译，避免 UI 语义前置）。
 *
 * 返回退订句柄（组件卸载 / 换档时调用）；同一 runtime 重复挂桥的治理归调用方
 * （宿主在 setRuntime 时先退订旧桥）。
 *
 * @param runtime 已装配的引擎运行时（其 on() 为事件唯一入口）
 * @param store UiStore 实例（vanilla API；React 侧经 useStore 包装）
 * @param now 时钟注入（测试可复现合并窗口；缺省 Date.now）
 */
export function bridgeRuntimeEvents(
  runtime: GameRuntime,
  store: UiStoreApi,
  now: () => number = Date.now,
): Unsubscribe {
  const unsubscribers: Unsubscribe[] = [
    runtime.on('stat_changed', (event) => {
      store.getState().noteStatChange({
        attr: event.attr,
        from: event.from,
        to: event.to,
        delta: event.delta,
        at: now(),
      });
    }),
    runtime.on('notify', (event) => {
      store.getState().pushNotification({
        kind: 'notify',
        textKey: event.textKey,
        ...(event.vars !== undefined ? { vars: { ...event.vars } } : {}),
        at: now(),
      });
    }),
    runtime.on('quest_state_changed', () => {
      store.getState().bumpQuestRevision();
    }),
    runtime.on('quest_stage', () => {
      store.getState().bumpQuestRevision();
    }),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
