import type { ZodType } from 'zod';
import type {
  BodyDef,
  ExprFunctionRegistry,
  FactionDef,
  ItemDef,
  NpcDef,
  QuestDef,
  Rng,
  TimeConfig,
} from '@game/shared';
import type { EffectContext, JumpTarget, MediaIntent } from '../runtime/index.js';

/**
 * 效果指令系统类型（设计 §3.3，05 任务 A 组）。
 *
 * - {@link EffectInstructionDef}：单条指令的注册契约——参数 schema（02 号
 *   effectParamSchemas 为数据侧基准，注册表与其兼容）、存档触碰声明
 *   （FR-SCR-05 touchState：迁移登记 / 调试监视 / 订阅触发三方复用）与执行体；
 * - {@link EffectExecuteContext}：注册表交付给指令执行体的能力面。设计 §3.3 的
 *   EffectContext（draft/rng/evalExpr/emit/child/where）为基座——本接口是其
 *   **内部超集**：GameRuntime 只感知 EffectContext 与 EffectExecution.jumps，
 *   emitJump/evalSource 是注册表与内置指令间的私有通道（跳转经 sink 汇入
 *   EffectExecution.jumps，参数表达式经注册表函数注册表编译后走 ctx.evalExpr）；
 * - {@link EffectRegistryOptions}：目录与配置注入面（§1.3 可测试性原则——
 *   物品 / NPC / 阵营 / 身体 / 任务目录、容量与判定解析器全部显式注入）。
 */

/** 存档触碰声明（§3.3 touch 元数据）：状态域路径前缀（如 'player.bag'、'npcs'） */
export interface TouchReport {
  /** 读取的状态域（调试变量监视 / 增量求值索引用） */
  readonly reads: readonly string[];
  /** 写入的状态域（FR-SCR-05 touchState：迁移登记 / 调试监视 / 订阅触发） */
  readonly writes: readonly string[];
}

/**
 * 指令执行体上下文（EffectContext 的注册表内部超集，见模块 TSDoc）。
 */
export interface EffectExecuteContext extends EffectContext {
  /**
   * 动态跳转收集（内部通道）：目标不能在解析期静态可知的跳转类指令
   * （advance_time 的 cost 为表达式）在 execute 期产出，注册表汇入
   * EffectExecution.jumps 后并入 ExecOutcome——绝不直接改状态（§3.3 分界）。
   */
  emitJump(target: JumpTarget): void;
  /**
   * 参数表达式求值：以注册表持有的函数注册表编译（§3.2 compileExpr）后经
   * ctx.evalExpr 按当前 draft 实时视图求值。表达式字段（ExprSource，02 号）
   * 一律为 string，由内置指令经本入口求值；编译失败抛 EXPR_COMPILE（原文在
   * where.expr），运行时统一包装为 EFFECT_FAILED 并提升 sourceExpr 定位。
   */
  evalSource(source: string): unknown;
}

/**
 * 效果指令注册契约（设计 §3.3 EffectInstructionDef）。
 *
 * 内置固定 id（约 25 个，§3.3 表格）或作者扩展 `x.<script>.<name>`（DD-08，
 * 经 EffectRegistry.register 注册）；schema 与 02 号 effectParamSchemas 兼容
 * （同为 ZodType，数据加载期与运行期共用）。
 */
export interface EffectInstructionDef<T = unknown> {
  /** 指令 id：内置固定 id 或 'x.<script>.<name>'（DD-08） */
  readonly id: string;
  /** 参数 schema（数据加载期与运行期共用；02 号 effectParamSchemas 为基准） */
  readonly schema: ZodType<T>;
  /** 存档触碰声明（FR-SCR-05）：迁移与调试依赖此元数据 */
  touch(arg: T): TouchReport;
  /** 执行体：经注册表交付的 EffectExecuteContext 操作 draft / 产出事件与跳转 */
  execute(arg: T, ectx: EffectExecuteContext): void;
  /**
   * 静态跳转声明（可选）：目标由参数静态可知的跳转类指令
   * （goto/back/ending/loop_transition/battle）在解析期声明，注册表汇入
   * EffectExecution.jumps；动态目标（advance_time）改用 ectx.emitJump。
   */
  jumps?(arg: T): readonly JumpTarget[];
  /**
   * 参数**语义**校验（可选；加载期执行，2026-09-15 增补，develop.md 约束 8）。
   *
   * 与 `schema` 的分工：schema 只保证结构（类型/必填），本钩子校验**跨数据语义**——
   * 如 `set` 的 key 形态是否合法、`favor` 的目标 NPC 是否在包内声明、
   * `wear` 的物品是否为 garment。返回诊断列表（空数组 = 通过）。
   *
   * 为什么必须在加载期：这些错误此前只在 `execute`（运行期）暴露，表现为
   * 「包加载零诊断通过、玩家点到该选项才炸」——`set { key: 'npc.x.met' }` 即实例
   * （见 `docs/retros/content-integrity-postmortem.md` 与设计 §7.7
   * `invalid-instruction-arg`）。缺省实现返回空数组（结构校验足够时无需覆写）。
   */
  validateArg?(arg: T, ctx: EffectValidationContext): readonly EffectArgDiagnostic[];
}

/** 参数语义校验可用的包内目录（加载期注入；与 EffectRegistryOptions 目录同源） */
export interface EffectValidationContext {
  readonly npcs?: ReadonlyMap<string, unknown>;
  readonly items?: ReadonlyMap<string, unknown>;
  readonly quests?: ReadonlyMap<string, unknown>;
  readonly factions?: ReadonlyMap<string, unknown>;
  readonly endings?: ReadonlyMap<string, unknown>;
  readonly scenes?: ReadonlyMap<string, unknown>;
}

/** 参数语义校验诊断（加载期 error/warning；code 对应设计 §7.7 规则 id） */
export interface EffectArgDiagnostic {
  /** 与设计 §7.7 规则 id 对齐（如 `invalid-instruction-arg`） */
  readonly code: string;
  readonly severity: 'error' | 'warning';
  /** 可读细节（写入加载诊断的 detail） */
  readonly detail: string;
}

/** 注册表存储视图（@internal）：参数泛型擦除，resolve 经 schema.parse 产出后再交还 def */
export type ErasedEffectDef = EffectInstructionDef<never>;

/** 泛型擦除（@internal）：注册表按 id 分发时不携带参数类型 */
export function eraseDef<T>(def: EffectInstructionDef<T>): ErasedEffectDef {
  return def as unknown as ErasedEffectDef;
}

/** 内置指令构造上下文（@internal）：注册表在建构时交付给内置指令工厂 */
export interface BuiltinDefContext {
  /** 按 id 查找已注册指令（call 转发需要，构造期延迟绑定） */
  lookup(id: string): ErasedEffectDef | undefined;
  /** 注册表选项（目录 / 容量 / 判定解析器等注入面） */
  readonly options: EffectRegistryOptions;
}

/** 声望收敛区间（reputation 指令 clamp；FactionDef 无 min/max 字段，全局注入） */
export interface ReputationBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * 效果注册表选项（目录与配置注入面，§1.3 显式依赖注入）。
 * 全部可选：缺省目录下相关指令按「缺失即 EFFECT_FAILED」或不做对应校验
 * （各指令 TSDoc 注明缺省语义）；宿主（06 号加载器 / 测试夹具）从游戏包
 * bootstrap 投影构造后注入。
 */
export interface EffectRegistryOptions {
  /** 表达式函数注册表（参数表达式编译用；应与 GameRuntime 注入同一实例，§3.2） */
  functionRegistry?: ExprFunctionRegistry;
  /** 物品目录（equip/wear 的类型与槽位/部位校验；缺省 = 相关指令按物品缺失报错） */
  items?: ReadonlyMap<string, ItemDef>;
  /** NPC 目录（favor 的 clamp 区间与阶段阈值表；缺省 = 不收敛、无阶段事件） */
  npcs?: ReadonlyMap<string, NpcDef>;
  /** 阵营目录（reputation 的波段阈值表；缺省 = 无波段事件） */
  factions?: ReadonlyMap<string, FactionDef>;
  /** 声望收敛区间（FactionDef 无 min/max，全局传入；缺省 = 不收敛） */
  reputationBounds?: ReputationBounds;
  /** 身体定义（set_body 值域校验 ∈ BodyDef，§4.8；缺省 = 不校验值域） */
  bodyDefs?: BodyDef;
  /** 任务定义（quest 阶段序校验与缺省阶段推导；缺省 = stage 必须显式给出） */
  quests?: ReadonlyMap<string, QuestDef>;
  /** 商店定义（17 号：`__shop.restock` 的补货依据；缺省 = 无补货面） */
  shops?: ReadonlyMap<string, import('@game/shared').ShopDef>;
  /** 背包容量上限（FR-ITEM-02 可选启用，按物品种类数计；缺省 = 不限容量） */
  bagCapacity?: number;
  /**
   * 判定规则解析器（check 指令的运行期解析面）。loader 管线步骤 6 始终注入
   * 合成解析链（脚本规则 → 宿主解析器 → checks/ 内置 coc/generic，15 号）；
   * 仅当绕过 loader 直接构造注册表且未注入时，check 报 EFFECT_FAILED（显性化）。
   */
  checkResolver?: CheckRuleResolver;
  /**
   * 事件池（`__events.eval` 内部指令的评估面，10 号；缺省 = 该指令未装配）。
   * 结构化最小视图：只要求 evaluate 面，避免 effects 横向依赖 events 子系统类型
   * 细节（DD-06）。宿主装配：new EventPool(...) 后注入。
   */
  eventPool?: {
    evaluate(input: {
      state: unknown;
      evalCondition: (source: string) => boolean;
      rng: { next(): number };
      touched?: readonly string[];
    }): {
      jumps: readonly { type: string; scene?: string; [key: string]: unknown }[];
      cooldownUpdates: readonly {
        eventId: string;
        lastDay: number;
        lastSlotIndex?: number;
        fired: number;
      }[];
    };
  };
  /**
   * 时段制日历（§4.3 TimeConfig；09 号注入）：`__time.advance` 内部指令的
   * 时钟写入依据。缺省 = 内部指令报 EFFECT_FAILED（时间管线未装配）。
   */
  timeConfig?: TimeConfig;
  /**
   * 媒体解析器（§5.10；24 号）：`media` 指令产出 intent 前核对 assetId
   * 存在性（缺失 → missing 占位标记，宿主经解析器告警出口记录，FR-MEDIA-06）。
   * 缺省 = 裸 intent（既有行为，向后兼容）。结构化最小视图（DD-06）：effects
   * 不横向依赖 media 子系统类型细节；`MediaResolver` 直接满足。
   */
  mediaResolver?: {
    /** 核对并入意图：存在 → 原样返回；缺失 → 告警 + 带 missing 标记的副本 */
    decorate(intent: MediaIntent): MediaIntent;
  };
}

// —— 判定规则契约（§5.1 接口；本模块定义，15 号实现 coc/generic 与脚本扩展） ———

/** 判定请求（§5.1 CheckRequest：规则 id + 技能值 + 难度 / 奖惩骰 / 对抗值） */
export interface CheckRequest {
  /** 检定规则 id：'coc' | 'generic' | 'x.<script>.<rule>'（可插拔，缺省 'coc'） */
  rule: string;
  /** 技能值或表达式求值结果 */
  value: number;
  difficulty?: 'normal' | 'hard' | 'extreme';
  /** generic 规则的难度数值（roll + value ≥ difficultyValue；coc 忽略） */
  difficultyValue?: number;
  bonusDice?: number;
  penaltyDice?: number;
  /** 对抗检定（FR-CMBT-03） */
  opposedValue?: number;
}

/** 判定结果（§5.1 CheckResult：骰值明细 + 等级 + 成败 + 日志细节） */
export interface CheckResult {
  /** 含奖惩骰明细（表现层动画数据，FR-CMBT-05） */
  rolls: readonly number[];
  /** 成败等级（critical > extreme > hard > normal > fail > fumble） */
  level: 'critical' | 'extreme' | 'hard' | 'normal' | 'fail' | 'fumble';
  outcome: 'success' | 'fail';
  /** 阈值 / 差值等，日志与调试展示 */
  detail: Readonly<Record<string, unknown>>;
}

/** 判定规则（§5.1 CheckRule：纯函数，仅经注入 Rng 随机，DD-09） */
export interface CheckRule {
  readonly id: string;
  resolve(req: CheckRequest, rng: Rng): CheckResult;
}

/**
 * 判定规则解析器（check 指令的路由缝，§5.1）：按规则 id 取规则实现。
 * 15 号模块提供内置解析器（coc / generic），脚本扩展规则由宿主合并后注入；
 * 未注入解析器或规则缺失时 check 指令报 EFFECT_FAILED（显性化，不静默跳过）。
 */
export interface CheckRuleResolver {
  resolve(ruleId: string): CheckRule | undefined;
}
