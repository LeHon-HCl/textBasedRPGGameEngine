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

/**
 * 渲染段落（设计 §4.2 RenderSegment）：宏产物最终都映射到键（D4）或字面模板。
 *
 * `media` 的两种承载（24 号）：场景级 image 段（kind='image'，bg/bgm 前置段）
 * 与段落级文本段（kind='text'，随段落揭示的 cg/sprite）。
 */
export interface RenderSegment {
  readonly kind: 'text' | 'spacing' | 'image';
  /** 文本键（kind='text'；宏分支产物亦为键引用） */
  readonly key?: TextKey;
  /** 字面模板（预留给宿主 UI 层的字面产物；运行时宏一律产键，D4） */
  readonly literal?: string;
  /** 延迟插值变量（§4.1 InterpVars；vars 在段落渲染时组装，FR-NARR-04） */
  readonly vars?: InterpVars;
  /** 媒体意图（DD-05：场景级绑定与段落级媒体产出，engine 不接触播放） */
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
 * 场景会话状态机的运行时最小视图（§4.2 桩化缝）。
 * `GameRuntime` 结构化满足；markSceneSeen/markCgSeen 为 §4.2「写 seen.* 的时机 =
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
  /**
   * CG 解锁登记（seen.cg 追加去重；FR-MEDIA-04 图鉴数据源；readonly 会话不调用）。
   * 可选：仅消费叙事媒体意图的宿主需要实现（08 号既有桩不必补齐）。
   */
  markCgSeen?(assetId: string): void;
}

/**
 * 叙事媒体解析器最小视图（24 号，DD-06 同型的最小依赖面）。
 *
 * narrative 只消费「assetId + 媒体类型 → 意图」这一个谓词，不 import media
 * 子系统（横向 import 违例）；`MediaResolver` 结构化满足本接口，宿主注入实例
 * 即可获得存在性核对与缺失占位标记（FR-MEDIA-06）。缺省未注入 = 08 号既有
 * 行为（裸 intent，无 missing 标记）。
 */
export interface NarrativeMediaResolver {
  intentFor(assetId: string, kind: MediaIntent['type']): MediaIntent;
}

/**
 * 场景会话依赖的游戏定义最小视图：{@link GameDefinition} 结构化满足。
 * exprCache 承载场景数据内表达式（showIf/disabledIf/entry.require）的加载期
 * 编译产物（§3.4 步骤 5）；locales[mainLang] 承载叙事宏结构（macros.ts）；
 * functionRegistry 供词典承载的宏条件表达式按需编译（缺省内置 20 函数）；
 * npcs 承载立绘差分声明（FR-MEDIA-03，缺省 = 无立绘）；areaMedia 承载区域级
 * bg/bgm 绑定（FR-MEDIA-02 场景绑定的回落层，缺省 = 无回落）。
 */
export interface SceneRunnerDef {
  readonly manifest: Pick<Manifest, 'mainLang'>;
  readonly scenes: ReadonlyMap<GameId, CompiledScene>;
  readonly events: readonly EventDef[];
  readonly locales: Record<Lang, LocalePack>;
  readonly exprCache: ReadonlyMap<string, CompiledExpr>;
  /** 表达式函数注册表（宏条件编译；缺省 = 内置 20 函数，脚本扩展经 def 注入） */
  readonly functionRegistry?: ExprFunctionRegistry;
  /**
   * NPC 定义投影（立绘差分声明的数据源，§2.4 NpcDef.sprites；缺省 = 无立绘）。
   * 只声明本模块消费的两个字段（DD-06 最小依赖面）。
   */
  readonly npcs?: ReadonlyMap<
    GameId,
    {
      readonly sprites?: readonly (
        | string
        | {
            readonly base?: string;
            readonly variants: readonly { readonly when: string; readonly asset: string }[];
          }
      )[];
    }
  >;
  /**
   * 区域定义投影（区域级 bg/bgm 绑定的数据源，FR-MEDIA-02；缺省 = 无回落）。
   * `GameDefinition.areas` 结构化满足（只声明本模块消费的 media 字段）。
   */
  readonly areas?: ReadonlyMap<
    GameId,
    { readonly media?: { readonly bg?: string; readonly bgm?: string } }
  >;
}

/**
 * 内容过滤注入面（设计 §5.8 ContentFilter 的结构化最小视图，22 号）。
 *
 * narrative 只依赖这一最小接口做过滤判定，不横向 import content 子系统
 * （DD-06）；`ContentFilter` 结构化满足本接口，宿主直接注入实例即可。
 * 只声明应用点 2（占位替换）与应用点 3（选项隐藏）所需的两谓词。
 */
export interface NarrativeContentFilter {
  /** 标签集合是否放行（无标签恒 true） */
  passes(tags?: readonly string[]): boolean;
  /** 被屏蔽内容的占位文本键；null = 保留原文或跳过（调用方先经 passes 判定） */
  placeholderFor(tags?: readonly string[]): TextKey | null;
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
  /**
   * 内容过滤器（§5.8 应用点 2/3；缺省 undefined = 不做段落占位替换，选项沿用
   * 08 号既有的 `settings.disabledTags` 直查——向后兼容，既有行为不变）。
   */
  readonly contentFilter?: NarrativeContentFilter;
  /**
   * 媒体解析器（24 号；缺省 = 裸 intent，无存在性核对与缺失标记）。
   * 宿主注入 `MediaResolver` 实例即获得 FR-MEDIA-06 的告警与占位语义。
   */
  readonly mediaResolver?: NarrativeMediaResolver;
  /**
   * 立绘差分条件求值（FR-MEDIA-03；缺省 = 无求值能力，含条件的差分声明不命中
   * 而回落基图）。条件表达式经 def.exprCache 复用编译产物（§3.4 步骤 5）。
   */
  readonly evalSpriteCondition?: (source: string) => boolean;
}
