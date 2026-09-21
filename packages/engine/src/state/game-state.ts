import type {
  Clock,
  FlagValue,
  GameId,
  NpcState,
  QuestState,
  SerializedState,
  StatusInstance,
} from '@game/shared';

/**
 * GameState 状态树（设计 §3.1 字段清单，proposal §4.4 的落地类型，04 任务 A1）。
 *
 * - 手写 TS 类型（§2.4：结构稳定、函数性内容少，不入 Zod 体系）；
 * - 可序列化投影由 `@game/shared` 的 `serializedStateSchema` 终验（save.ts，
 *   02 号模块契约）：`checkpoints`（回滚栈元数据）与 `world.npcLocationCache`
 *   （日程解析缓存，可重建）不入档，序列化时剔除（04 任务 A2）；
 * - 状态只经事务修改（DD-06）：GameRuntime 以 immer produce 包裹全部写路径，
 *   快照（structuredClone）与补丁（immer Patch）是回滚与调试的统一底座。
 */

/** 技能值记录（§3.1 player.skills 切片；与 shared ExprSkillValue 结构兼容） */
export interface SkillValue {
  value: number;
  exp: number;
}

/**
 * 多层服装（FR-ITEM-04，§4.7 Outfit）：part → layer → itemId。
 * layer 键为层数字符串（'1' 内 / '2' 中 / '3' 外，§2.3 outfit 白名单行同口径）；
 * 与 serializedStateSchema 的 `z.record(z.string(), z.record(z.string(), refId('item')))` 对齐。
 */
export type Outfit = Record<string, Record<string, GameId>>;

/** 背包条目（FR-ITEM-02）：关键道具分区标记由 ItemDef.key 承载，状态只存计数 */
export interface BagEntry {
  itemId: GameId;
  count: number;
}

/** 临时变身登记项（FR-BODY-02；结构即 serializedStateSchema.bodyTemp 值的推断类型） */
export interface BodyTempEntry {
  /** 首次登记前的原值（还原目标） */
  original: string;
  /** 剩余时段数（管线步骤 3 递减，归零还原） */
  remainingSlots: number;
}

/** 穿着元数据（FR-ITEM-06；结构即 serializedStateSchema.wornMeta 值的推断类型） */
export interface WornMeta {
  /** 穿着期间累计时段数（时效判据） */
  wornSlots: number;
  /** 剩余耐久（缺省 = 无耐久概念） */
  durability?: number;
}

/** 游玩统计（FR-STAP-03；结构即 serializedStateSchema.readStats 的推断类型） */
export type ReadStats = SerializedState['readStats'];

/** 玩家设置（FR-UI-05；结构即 serializedStateSchema.settings 的推断类型） */
export type PlayerSettings = SerializedState['settings'];

/** 回滚栈元数据（§3.1 checkpoints：负载存内存、不入档，仅保留标签供 UI 呈现） */
export interface CheckpointMeta {
  label: string;
}

/**
 * 游戏状态树（§3.1 全量字段清单）。
 *
 * 不变式：
 * - `versions`：三层版本 + 引擎实际版本（FR-MIGR-01）；序列化后由 SaveBlob
 *   顶层字段承载（serializedStateSchema 不含 versions）；
 * - `player.derived`：派生属性缓存（FR-STAT-05），只在 `recomputeDerived`
 *   命中触碰域时重算，表达式经 `attr.<id>` 读取（求值视图并入）；
 * - `world.npcLocationCache`：日程解析缓存（§4.6 管线步骤 5 维护），可随时重建；
 * - `checkpoints`：与运行时回滚栈平行增长，rollback 消费栈顶后同步收缩。
 */
export interface GameState {
  versions: { engineVersion: string; gameVersion: string; schemaVersion: number };
  /** 周目数（FR-LOOP-01；新档归零，周目切换由 19 号推进） */
  loop: number;
  player: {
    /** 数值型 + 等级型统一存值（FR-STAT-01；等级型存档位下标） */
    attrs: Record<string, number>;
    skills: Record<string, SkillValue>;
    /** 状态效果实例（FR-STAT-03） */
    statuses: StatusInstance[];
    /** 身体部位 → 当前值（FR-BODY-01） */
    body: Record<string, string>;
    /** 临时变身登记（FR-BODY-02；结构即 serializedStateSchema.bodyTemp 的推断类型） */
    bodyTemp: Record<string, BodyTempEntry>;
    /** 渐进变身进度（FR-BODY-05 P2 预留；part → 0..100，表达式可读） */
    bodyProgress: Record<string, number>;
    /** 装备栏 slot → itemId（FR-ITEM-03） */
    equip: Record<string, GameId>;
    outfit: Outfit;
    bag: BagEntry[];
    /** 多货币钱包（FR-ECON-01） */
    wallet: Record<string, number>;
    /** 派生属性缓存（FR-STAT-05） */
    derived: Record<string, number>;
    /**
     * 换装预设快照（FR-ITEM-05，13 任务 4）：预设名 → outfit 全量。
     * 设计 §4.7 原定存 world.flags，但 flagValueSchema 仅允许标量——偏差为
     * 独立状态域（serializedStateSchema 同步扩列，只增不改）。
     */
    outfitPresets: Record<string, Outfit>;
    /**
     * 穿着元数据（FR-ITEM-06，13 任务 5）：itemId → {wornSlots, durability?}。
     * 与 player.outfit 平行维护：穿着即有、脱下即清（__items.tick 累计/消耗）。
     */
    wornMeta: Record<GameId, WornMeta>;
    /** 新档 Perk 结算产物 + 玩家命名（FR-ACHV-06） */
    bootstrap: { perks: string[]; name: string };
  };
  world: {
    time: Clock;
    unlockedAreas: GameId[];
    flags: Record<string, FlagValue>;
    /** 事件计数 / 收集率数据源（FR-GAL-04） */
    counters: Record<string, number>;
    /** 日程解析缓存（§4.6，可重建，不入档） */
    npcLocationCache: Record<GameId, GameId>;
    /** 事件冷却（§4.4 prune，随档持久） */
    eventCooldowns: Record<GameId, { lastDay: number; fired: number }>;
    /**
     * 商店库存（17 号 S4；§5.3「stock 计数 + restock 周期性补货」的持久面）。
     * 键 = `<shopId>/<itemId>`；仅登记**有限库存**条目——未登记 = 无限库存
     * （与 ShopEntry.stock 省略同语义）。补货经管线 day_rollover 钩子重置为
     * ShopDef 声明的初始 stock。
     */
    shopStock: Record<string, number>;
  };
  npcs: Record<GameId, NpcState>;
  factions: Record<GameId, number>;
  quests: Record<GameId, QuestState>;
  seen: { scenes: string[]; gallery: string[]; cg: string[]; endings: string[]; codex: string[] };
  readStats: ReadStats;
  settings: PlayerSettings;
  checkpoints: CheckpointMeta[];
}
