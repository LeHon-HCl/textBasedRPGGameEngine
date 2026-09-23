import type { ExprSource } from './ids.js';
import type { Rng } from './rng.js';
import type { FlagValue, NpcState, Profile, QuestState } from './schema/index.js';

/**
 * 表达式语言规格（设计 §2.3，DD-01，OQ-01 关闭）。
 *
 * 本模块只承载**纯类型**（文法 AST、编译产物、求值上下文与函数契约），
 * 解析 / 编译 / 求值实现位于 `@game/engine` 的 `expr-eval` 子系统（设计 §3.2、§10.4）：
 * - 解析：jsep 定制（关闭原生成员/标识符插件，自定义 path/call），产出本模块的 AST；
 * - 编译：`compileExpr(source, registry)` 完成 refs 抽取与静态校验（未知 root /
 *   未知函数 / 参数个数 / pure=false 误用 → `EXPR_COMPILE`）；
 * - 求值：AST walk 解释执行，禁 eval / new Function（NFR-19）。
 *
 * 语法（EBNF，设计 §2.3）：
 * ```
 * expr        = ternary ;
 * ternary     = logicOr [ '?' expr ':' expr ] ;
 * logicOr     = logicAnd { '||' logicAnd } ;
 * logicAnd    = equality { '&&' equality } ;
 * equality    = comparison { ('==' | '!=') comparison } ;
 * comparison  = additive { ('<' | '<=' | '>' | '>=') additive } ;
 * additive    = multiplicative { ('+' | '-') multiplicative } ;
 * multiplicative = unary { ('*' | '/' | '%') unary } ;
 * unary       = ( '!' | '-' | '+' ) unary | primary ;
 * primary     = NUMBER | STRING | 'true' | 'false' | 'null'
 *             | path | call | '(' expr ')' ;
 * path        = IDENT { '.' IDENT } ;
 * call        = IDENT '(' [ expr { ',' expr } ] ')' ;
 * ```
 */

/** 二元运算符全集（§2.3 binary 节点：算术 / 比较 / 逻辑，优先级见 EBNF 分层） */
export type ExprBinaryOp =
  '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';

/** 一元运算符全集（§2.3 unary 产生式：非 / 负 / 数值断言） */
export type ExprUnaryOp = '!' | '-' | '+';

/**
 * 表达式 AST 判别联合（§2.3，解析与编译的唯一中间表示）。
 * 节点不可变，可安全缓存（CompiledExpr.ast，设计 §3.2「AST 不可变可缓存」）。
 */
export type ExprNode =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'path'; segments: string[] }
  | { kind: 'call'; name: string; args: ExprNode[] }
  | { kind: 'unary'; op: ExprUnaryOp; operand: ExprNode }
  | { kind: 'binary'; op: ExprBinaryOp; left: ExprNode; right: ExprNode }
  | { kind: 'cond'; test: ExprNode; then: ExprNode; else: ExprNode };

/**
 * 变量引用（依赖索引键，设计 §2.3 / §4.4 脏标记用）。
 * - `root`：路径首段（变量域白名单 root，精确匹配）；
 * - `path`：完整点路径（含 root，如 `'attr.strength'`、`'npc.raven.favor'`），
 *   即表达式原文中的路径字面形态，可直接作为增量求值的索引键去重。
 */
export interface VarRef {
  root: string;
  path: string;
}

/**
 * 编译产物（§2.3）：原文 + AST + 编译期抽取的引用列表。
 * `refs` 供事件池 / 成就做增量求值（DD-06），编译期静态校验失败时根本不会产出本对象。
 */
export interface CompiledExpr {
  source: ExprSource;
  ast: ExprNode;
  refs: VarRef[];
}

/** 技能值记录（§3.1 `state.player.skills` 的切片结构） */
export interface ExprSkillValue {
  value: number;
  exp: number;
}

/** 时间视图（§2.3 白名单表 `time` 行：`.day` / `.weekday` / `.slot`）。
 *  GameState.world.time 为 §4.3 Clock（day/slotIndex/week/month），
 *  求值视图按本结构投影（weekday/slot 取时间配置中的名称），由 04 号模块接线时完成映射。 */
export interface ExprTimeView {
  day: number;
  weekday: string;
  slot: string;
}

/**
 * 求值作用域（设计 §3.2「state 只读视图」；由调用方注入的普通对象）。
 *
 * 字段与 §3.1 GameState 的相应切片**结构兼容**：04 号模块从 GameState 投影构造，
 * 本模块不 import engine/state（测试用最小作用域夹具）。键的缺席语义分两类
 * （严格错误语义见 DD-01 / §2.3）：
 * - **封闭域**（键集由内容定义、状态初始化时全量建立）：`attrs` / `skills` /
 *   `body` / `factions` / `wallet` / `npcs` 实体本身 / `quests` 实体本身 /
 *   `meta.points` / `time` / `loop` —— 已知 root 但缺 key 为状态完整性问题，
 *   求值器运行期抛 `EVAL_ERROR`（可捕获拼写错误）；
 * - **渐进域**（「尚不存在」是合法游玩状态）：`flags` / 物品计数 / NPC 自定义
 *   flag / `outfit` 穿戴位 / NPC `.stage` / perk 购买位 —— 缺席返回各域定义的
 *   缺席值（flag → undefined、计数 → 0、flag → undefined、穿戴位 → null、
 *   stage → undefined、perk → false），供顶层条件真值化（DD-01）。
 */
/**
 * 战斗表达式域（battle.*，16 号偏差③立项落地，2026-09-19 人类确认清单）：
 * AI `when` 条件引用**会话内状态**（§5.2「决策只用会话内状态」，DD-11）。
 * v1 明确不做：target.*（when 判定在目标选择之前）、随机量（DD-09：AI 决策
 * 不消耗骰序列）、叙事域快照。
 */
export interface BattleExprScope {
  /** 行动者当前/最大 HP 与面板属性（battle.self.*） */
  readonly self: {
    readonly hp: number;
    readonly maxHp: number;
    readonly attrs: Readonly<Record<string, number>>;
  };
  /** 行动者对立面存活数（battle.enemies.alive；不含行动者自身） */
  readonly enemiesAlive: number;
  /** 行动者同侧存活数（battle.allies.alive；**含行动者自身**） */
  readonly alliesAlive: number;
  /** 当前回合序号（从 1 起；battle.round） */
  readonly round: number;
}

export interface ExprScope {
  readonly player: {
    readonly attrs: Readonly<Record<string, number>>;
    readonly skills: Readonly<Record<string, ExprSkillValue>>;
    /** 多层服装 part → layer → itemId（§3.1 Outfit；layer 键为层数字符串，如 '1'） */
    readonly outfit: Readonly<Record<string, Readonly<Record<string, string>>>>;
    readonly body: Readonly<Record<string, string>>;
    /**
     * 渐进变身进度（FR-BODY-05 P2 预留，14 号）：part → 0..100。
     * 引擎只存取不解释语义（中立性）；P2 功能写入此域。
     */
    readonly bodyProgress?: Readonly<Record<string, number>>;
    readonly wallet: Readonly<Record<string, number>>;
  };
  readonly world: {
    readonly flags: Readonly<Record<string, FlagValue>>;
    readonly time: ExprTimeView;
  };
  /** 物品计数投影（player.bag 的 itemId → count；item root 语法糖与 has/count 的数据源） */
  readonly bagCounts: Readonly<Record<string, number>>;
  /**
   * 物品基准价投影（itemId → ItemDef.price；`item.<id>.price` 的数据源，17 号
   * 缺口③方案 A）。**缺省缺席**时 `item.<id>.price` 引用 → EVAL_ERROR；
   * 宿主/经济服务提供目录时填充（定价表达式「按基准价打折」的表达面）。
   */
  readonly itemPrices?: Readonly<Record<string, number>>;
  readonly npcs: Readonly<Record<string, NpcState>>;
  readonly factions: Readonly<Record<string, number>>;
  readonly quests: Readonly<Record<string, QuestState>>;
  readonly loop: number;
  /** 战斗表达式域（16 号；仅战斗 AI 求值上下文提供，其余上下文缺席 = battle.* 引用 EVAL_ERROR） */
  readonly battle?: BattleExprScope;
  /** Profile 只读投影（§2.3 白名单表 meta 行：points / perk） */
  readonly meta: Readonly<Pick<Profile, 'points' | 'purchasedPerks'>>;
}

/**
 * 求值上下文（设计 §3.2）：状态只读视图 + 注入 Rng + 函数注册表。
 * 由调用方构造并传入求值入口；内置函数经 `ctx.rng` 消耗随机序列（可回放，DD-09）。
 */
export interface EvalContext {
  /** 求值作用域（见 {@link ExprScope} 的缺席语义说明） */
  readonly state: ExprScope;
  readonly rng: Rng;
  readonly registry: ExprFunctionRegistry;
}

/** 函数注册表（设计 §3.2）：按函数名索引的不可变 Map（内置 20 个 + 脚本扩展 x.*）。 */
export type ExprFunctionRegistry = ReadonlyMap<string, ExprFunctionDef>;

/**
 * 表达式函数契约（§2.3）。
 * - `arity`：[min, max] 闭区间，编译期按注册表校验参数个数；
 * - `pure`：true 表示无副作用且不消耗随机序列（查询/数值类）；false（随机类）
 *   不可出现在缓存敏感位置（事件 require 等，编译期 requirePure 选项拦截）；
 * - `fn`：实参已求值后调用；参数类型不符等运行期问题由函数自身抛
 *   `EVAL_ERROR`（EngineError，where 至少含 `fn`，求值器负责补注表达式原文）。
 */
export interface ExprFunctionDef {
  name: string;
  arity: [number, number];
  pure: boolean;
  fn: (args: unknown[], ctx: EvalContext) => unknown;
}
