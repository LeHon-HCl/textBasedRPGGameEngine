import type {
  CompiledExpr,
  EventDef,
  ExprFunctionRegistry,
  GameId,
  Lang,
  Manifest,
  Rng,
  TextKey,
} from '@game/shared';
import type { EffectData } from '@game/shared';
import type { InterpVars } from '../i18n/index.js';
import type { CompiledScene, LocalePack } from '../loader/index.js';
import type { MediaIntent } from '../runtime/index.js';
import type { ExecContext, ExecOutcome } from '../runtime/index.js';
import type { GameState } from '../state/index.js';

/**
 * 叙事运行时契约类型（设计 §4.2，08 号模块）。
 *
 * - {@link RunnerPhase} / {@link RenderSegment} / {@link ChoiceView} 为 §4.2
 *   接口签名的逐字落地；
 * - {@link SceneRunnerRuntime} 是 SceneRunner 依赖的运行时最小视图（§4.2
 *   「独立测试：以桩 GameRuntime（注入记录型 exec/eval）驱动状态机」的桩化
 *   缝）：`GameRuntime` 结构化满足该接口，测试亦可注入记录型最小桩；
 * - {@link SceneRunnerDef} 是 SceneRunner 依赖的定义最小视图：`GameDefinition`
 *   （06 号加载器产物）结构化满足该接口，测试可注入仅含被测场景的最小夹具；
 * - 叙事宏（FR-NARR-04）的数据形态见 macros.ts TSDoc：02 号 scene schema 承载
 *   「键 + 显示条件」最小面（scene.ts TSDoc），宏结构由语言包记录值透传、
 *   本模块在 renderList 惰性解释（§4.2「schema 层先承载最小面」的对应物）。
 */

/** 会话相位（设计 §4.2 RunnerPhase 五相位状态机） */
export type RunnerPhase = 'entering' | 'await_advance' | 'await_choice' | 'resolving' | 'finished';

/** 会话终态类型（§4.2「finished 并记录终态类型」） */
export type NarrativeEndReason =
  /** 段落尽且无可见选项（end 场景或选项被一次性/show_if 消化） */
  | 'exhausted'
  /** jumps.ending（结局跳转；endingId 同步记录） */
  | 'ending'
  /** jumps.back 且无挂起主会话可返回 */
  | 'back'
  /** jumps.loop_transition（周目切换，19 号消费面） */
  | 'loop';

/** 渲染段落（设计 §4.2 RenderSegment）：宏产物最终都映射到键（D4）或字面模板 */
export interface RenderSegment {
  readonly kind: 'text' | 'spacing' | 'image';
  /** 文本键（kind='text'；宏分支产物亦为键引用） */
  readonly key?: TextKey;
  /** 字面模板（预留给宿主 UI 层的字面产物；运行时宏一律产键，D4） */
  readonly literal?: string;
  /** 延迟插值变量（§4.1 InterpVars；vars 在段落渲染时组装，FR-NARR-04） */
  readonly vars?: InterpVars;
  /** 媒体意图（DD-05：场景级 bg/bgm 绑定产出，engine 不接触播放） */
  readonly media?: readonly MediaIntent[];
}

/** 选项视图（设计 §4.2 ChoiceView）：已过 show_if + 内容过滤 + 一次性隐藏 */
export interface ChoiceView {
  readonly id: string;
  readonly textKey: TextKey;
  /** false = 置灰（disabledIf 满足；disabledReasonKey 携带原因键） */
  readonly enabled: boolean;
  readonly disabledReasonKey?: TextKey;
  /** true = 被过滤隐藏（show_if 不满足 / 一次性已选 / 内容标签被禁用） */
  readonly hiddenByFilter?: boolean;
}

/** 历史缓冲条目（FR-READ-04 数据源：段落 + 场景上下文） */
export interface NarrativeHistoryEntry {
  /** 会话内单调递增序号（0 起） */
  readonly seq: number;
  /** 段落渲染时的场景 id（FR-READ-04 按场景分组） */
  readonly sceneId: GameId;
  /** 渲染时的段落快照（宏展开产物） */
  readonly segment: RenderSegment;
  /** 渲染时的时钟投影（FR-READ-04 按时间分组的数据源） */
  readonly clock: { readonly day: number; readonly slotIndex: number };
}

/** 叙事运行时 warning（diagnostic 风格：severity/code/where，§10.2 汇总面） */
export interface NarrativeWarning {
  readonly severity: 'warning';
  readonly code: 'subsession_depth_exceeded';
  /** 定位信息：当前场景 / 目标事件场景 / 命中时的挂起深度 */
  readonly where: Readonly<Record<string, string>>;
}

/**
 * SceneRunner 依赖的运行时最小视图（§4.2 桩化缝）。
 * `GameRuntime` 结构化满足；markSceneSeen 为 §4.2「写 seen.scenes 的时机 =
 * 正常会话渲染时」的状态写入口（去重语义由实现方保证）。
 */
export interface SceneRunnerRuntime {
  readonly state: Readonly<GameState>;
  readonly rng: Rng;
  exec(effects: readonly EffectData[], ctx: ExecContext): ExecOutcome;
  eval(expr: CompiledExpr): unknown;
  evalCondition(expr: CompiledExpr): boolean;
  /** 场景访问记录（seen.scenes 追加去重；readonly 会话不调用） */
  markSceneSeen(sceneId: string): void;
}

/**
 * SceneRunner 依赖的游戏定义最小视图：{@link GameDefinition} 结构化满足。
 * exprCache 承载场景数据内表达式（showIf/disabledIf/entry.require）的加载期
 * 编译产物（§3.4 步骤 5）；locales[mainLang] 承载叙事宏结构（macros.ts）；
 * functionRegistry 供词典承载的宏条件表达式按需编译（缺省内置 20 函数）。
 */
export interface SceneRunnerDef {
  readonly manifest: Pick<Manifest, 'mainLang'>;
  readonly scenes: ReadonlyMap<GameId, CompiledScene>;
  readonly events: readonly EventDef[];
  readonly locales: Record<Lang, LocalePack>;
  readonly exprCache: ReadonlyMap<string, CompiledExpr>;
  /** 表达式函数注册表（宏条件编译；缺省 = 内置 20 函数，脚本扩展经 def 注入） */
  readonly functionRegistry?: ExprFunctionRegistry;
}

/** SceneRunner 构造选项（设计 §4.2 opts：sceneId/params/readonly + 注入缝） */
export interface SceneRunnerOptions {
  /** 游戏定义最小视图（GameDefinition 直接可用） */
  readonly def: SceneRunnerDef;
  /** 初始场景（主会话入口或事件场景，§4.2 进入事件） */
  readonly sceneId: GameId;
  /**
   * 会话参数（延迟插值 vars 的来源，FR-NARR-04）：对象 = 参数快照（回想重放
   * FR-GAL-01 使用解锁时快照）；函数 = 每次渲染时组装（正常会话的延迟插值，
   * vars 反映渲染时刻状态）。
   */
  readonly params?: InterpVars | (() => InterpVars);
  /** 只读会话（回想重放，FR-GAL-01）：不写 seen、不触发副作用 */
  readonly readonly?: boolean;
  /** warning 出口（§4.2 子会话超限等 diagnostic 风格告警；缺省丢弃） */
  readonly onWarn?: (warning: NarrativeWarning) => void;
}
