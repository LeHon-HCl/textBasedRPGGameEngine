import { EngineError } from '@game/shared';
import type { LoopCategory, LoopConfig, LoopPolicy, Rng } from '@game/shared';
import { compileExpr, evalExpr } from '../expr-eval/index.js';
import { buildExprScope, type GameState } from '../state/index.js';
import type { ExprFunctionRegistry } from '@game/shared';
import type { LoopSummary, LoopTransitionResult } from './types.js';

/**
 * 周目过渡执行器（detail-design §5.5，19 号 C 线；FR-LOOP-04/05）。
 *
 * **纯函数**（不消费随机、不做 IO）：`applyLoopTransition(prev, config, options)`
 * → 新状态的深拷贝变换。执行顺序固定（§5.5）：
 *
 * 1. **先整体 reset**：全部类别回到新档基线（属性/技能/物品/好感/阵营/flag/
 *    任务/seen/时间）；
 * 2. **再逐类 apply 策略**：按 `config.inherit` 声明的类别应用其策略
 *    （`inherit` 全继承 / `{keepRatio}` 表达式例外 / `{whitelist}` / `{blacklist}`）；
 *    `config.reset` 中显式声明的类别按策略重置（与 inherit 互补声明例外）；
 * 3. **loop + 1**（`loop` 表达式根的直接映射，FR-LOOP-05）；
 * 4. **Profile 相关域不受影响**（DD-04：Profile 在宿主，引擎状态树无 Profile 域）。
 *
 * 类别 → 状态域映射（与 §3.1 状态树对齐）：
 *
 * | 类别 | 状态域 |
 * |---|---|
 * | attrs | `player.attrs` / `player.derived` |
 * | skills | `player.skills` |
 * | items | `player.bag` / `player.equip` / `player.outfit` / `player.outfitPresets` / `player.wornMeta` |
 * | outfit | 同 items 的穿戴面（与 items 分开声明以便细粒度策略） |
 * | body | `player.body` / `player.bodyTemp` / `player.bodyProgress` |
 * | favor | `npcs` |
 * | factions | `factions` |
 * | flags | `world.flags` / `world.counters` |
 * | quests | `quests` |
 * | seen | `seen` / `readStats` |
 * | time | `world.time` |
 *
 * 「基线」取自 `options.baseline`（宿主传入新档的 `newGameState` 产物——
 * 属性初值/时间起点等由 bootstrap 决定，引擎不硬编码）。
 */

export interface LoopTransitionOptions {
  /** 新档基线状态（`newGameState` 产物；各类别 reset 的归位目标） */
  readonly baseline: GameState;
  /** 表达式函数注册表（keepRatio 表达式求值） */
  readonly functionRegistry: ExprFunctionRegistry;
  /** 求值随机源（keepRatio 表达式若含随机函数；DD-09） */
  readonly rng: Rng;
}

/** 类别 → 状态域的读写（唯一映射点，避免各处散落） */
interface CategoryAccessor {
  /** 从状态树取值（用于继承） */
  read(state: GameState): unknown;
  /** 写入状态树（深拷贝后调用） */
  write(state: GameState, value: unknown): void;
  /** 归位到基线 */
  reset(state: GameState, baseline: GameState): void;
}

/** 结构化克隆（状态树为纯数据；不依赖 structuredClone 的宿主差异） */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 深拷贝为可写的工作副本。
 * 状态树在运行期经 `runtime.state` 以 `Readonly<GameState>` 视图交付；本函数
 * 只做**数据**层面的克隆（JSON 往返），类型上走 unknown 中转解除只读标注——
 * 过渡是纯函数，写操作只发生在私有副本上。
 */
function cloneGameState(value: GameState): GameState {
  return JSON.parse(JSON.stringify(value)) as unknown as GameState;
}

const CATEGORY_ACCESSORS: Record<LoopCategory, CategoryAccessor> = {
  attrs: {
    read: (state) => ({ attrs: state.player.attrs, derived: state.player.derived }),
    write: (state, value) => {
      const v = value as {
        attrs: GameState['player']['attrs'];
        derived: GameState['player']['derived'];
      };
      state.player.attrs = v.attrs;
      state.player.derived = v.derived;
    },
    reset: (state, baseline) => {
      state.player.attrs = clone(baseline.player.attrs);
      state.player.derived = clone(baseline.player.derived);
    },
  },
  skills: {
    read: (state) => state.player.skills,
    write: (state, value) => {
      state.player.skills = value as GameState['player']['skills'];
    },
    reset: (state, baseline) => {
      state.player.skills = clone(baseline.player.skills);
    },
  },
  items: {
    // items 类别含背包与**多货币钱包**（钱包无独立类别，FR-ECON-01 属财产面）；
    // keepRatio 对 wallet 子面（数值映射）有效——「保留金币 10%」由此表达
    read: (state) => ({ bag: state.player.bag, wallet: state.player.wallet }),
    write: (state, value) => {
      const v = value as {
        bag: GameState['player']['bag'];
        wallet?: GameState['player']['wallet'];
      };
      state.player.bag = v.bag;
      if (v.wallet !== undefined) state.player.wallet = v.wallet;
    },
    reset: (state, baseline) => {
      state.player.bag = clone(baseline.player.bag);
      state.player.wallet = clone(baseline.player.wallet);
    },
  },
  outfit: {
    read: (state) => ({
      equip: state.player.equip,
      outfit: state.player.outfit,
      outfitPresets: state.player.outfitPresets,
      wornMeta: state.player.wornMeta,
    }),
    write: (state, value) => {
      const v = value as {
        equip: GameState['player']['equip'];
        outfit: GameState['player']['outfit'];
        outfitPresets: GameState['player']['outfitPresets'];
        wornMeta: GameState['player']['wornMeta'];
      };
      state.player.equip = v.equip;
      state.player.outfit = v.outfit;
      state.player.outfitPresets = v.outfitPresets;
      state.player.wornMeta = v.wornMeta;
    },
    reset: (state, baseline) => {
      state.player.equip = clone(baseline.player.equip);
      state.player.outfit = clone(baseline.player.outfit);
      state.player.outfitPresets = clone(baseline.player.outfitPresets);
      state.player.wornMeta = clone(baseline.player.wornMeta);
    },
  },
  body: {
    read: (state) => ({
      body: state.player.body,
      bodyTemp: state.player.bodyTemp,
      bodyProgress: state.player.bodyProgress,
    }),
    write: (state, value) => {
      const v = value as {
        body: GameState['player']['body'];
        bodyTemp: GameState['player']['bodyTemp'];
        bodyProgress: GameState['player']['bodyProgress'];
      };
      state.player.body = v.body;
      state.player.bodyTemp = v.bodyTemp;
      state.player.bodyProgress = v.bodyProgress;
    },
    reset: (state, baseline) => {
      state.player.body = clone(baseline.player.body);
      state.player.bodyTemp = clone(baseline.player.bodyTemp);
      state.player.bodyProgress = clone(baseline.player.bodyProgress);
    },
  },
  favor: {
    read: (state) => state.npcs,
    write: (state, value) => {
      state.npcs = value as GameState['npcs'];
    },
    reset: (state, baseline) => {
      state.npcs = clone(baseline.npcs);
    },
  },
  factions: {
    read: (state) => state.factions,
    write: (state, value) => {
      state.factions = value as GameState['factions'];
    },
    reset: (state, baseline) => {
      state.factions = clone(baseline.factions);
    },
  },
  flags: {
    read: (state) => ({
      flags: state.world.flags,
      counters: state.world.counters,
      unlockedAreas: state.world.unlockedAreas,
    }),
    write: (state, value) => {
      const v = value as {
        flags: GameState['world']['flags'];
        counters: GameState['world']['counters'];
        unlockedAreas: GameState['world']['unlockedAreas'];
      };
      state.world.flags = v.flags;
      state.world.counters = v.counters;
      state.world.unlockedAreas = v.unlockedAreas;
    },
    reset: (state, baseline) => {
      state.world.flags = clone(baseline.world.flags);
      state.world.counters = clone(baseline.world.counters);
      state.world.unlockedAreas = clone(baseline.world.unlockedAreas);
    },
  },
  quests: {
    read: (state) => state.quests,
    write: (state, value) => {
      state.quests = value as GameState['quests'];
    },
    reset: (state, baseline) => {
      state.quests = clone(baseline.quests);
    },
  },
  seen: {
    read: (state) => ({ seen: state.seen, readStats: state.readStats }),
    write: (state, value) => {
      const v = value as { seen: GameState['seen']; readStats: GameState['readStats'] };
      state.seen = v.seen;
      state.readStats = v.readStats;
    },
    reset: (state, baseline) => {
      state.seen = clone(baseline.seen);
      state.readStats = clone(baseline.readStats);
    },
  },
  time: {
    read: (state) => state.world.time,
    write: (state, value) => {
      state.world.time = value as GameState['world']['time'];
    },
    reset: (state, baseline) => {
      state.world.time = clone(baseline.world.time);
    },
  },
};

/**
 * 应用周目过渡（§5.5；纯函数）。
 *
 * @param prev 切换前的状态（不被改写——内部深拷贝后变换）
 * @param config LoopConfig（继承/重置策略表 + openingScene）
 * @param options 基线与求值依赖
 */
export function applyLoopTransition(
  prev: GameState,
  config: LoopConfig,
  options: LoopTransitionOptions,
): LoopTransitionResult {
  const baseSummary = summarize(prev);
  // 深拷贝为可写工作副本（纯函数内部变换；返回面为 GameState 视图）
  const next: GameState = cloneGameState(prev);
  const baseline = options.baseline;

  // —— 1. 先整体 reset（全部类别归位到基线） ——
  for (const category of Object.keys(CATEGORY_ACCESSORS) as LoopCategory[]) {
    CATEGORY_ACCESSORS[category].reset(next, baseline);
  }

  // —— 2. 逐类 apply inherit 策略（config.inherit 为继承声明；config.reset 显式重置） ——
  for (const [category, policy] of Object.entries(config.inherit ?? {}) as [
    LoopCategory,
    LoopPolicy,
  ][]) {
    const accessor = CATEGORY_ACCESSORS[category];
    const value = accessor.read(prev);
    applyPolicy(next, prev, category, policy, value, accessor, options);
  }
  // config.reset 的显式声明：apply 其策略（'reset' 已由步骤 1 完成；
  // whitelist/blacklist 在此语义为「仅重置清单内/排除清单外」）
  for (const [category, policy] of Object.entries(config.reset ?? {}) as [
    LoopCategory,
    LoopPolicy,
  ][]) {
    if (policy === 'reset') continue; // 步骤 1 已完成
    const accessor = CATEGORY_ACCESSORS[category];
    const value = accessor.read(prev);
    // 反转语义：reset 表里的 inherit 表示「不重置」（保持基线）
    if (policy === 'inherit') {
      accessor.write(next, clone(value));
      continue;
    }
    if (typeof policy === 'object' && 'whitelist' in policy) {
      // 仅重置清单内：清单内保持基线（不动），清单外继承原值
      mergeByKeys(next, value, policy.whitelist, accessor);
      continue;
    }
    if (typeof policy === 'object' && 'blacklist' in policy) {
      // 排除清单外重置：清单外的条目继承
      mergeExcludingKeys(next, value, policy.blacklist, accessor);
      continue;
    }
    if (typeof policy === 'object' && 'keepRatio' in policy) {
      // reset 表内的 keepRatio 语义不明确（保留比例 = 继承的变体）→ 显性拒绝
      throw new EngineError({
        code: 'EFFECT_FAILED',
        where: {
          op: 'loop',
          category,
          detail: 'reset 表中的 keepRatio 无定义语义（请在 inherit 表中声明）',
        },
        messageKey: 'error.effects.instructionFailed',
      });
    }
  }

  // —— 3. loop + 1（FR-LOOP-05 的变量根直接映射） ——
  next.loop = prev.loop + 1;
  // 摘要为只读契约（types.ts 冻结面）：切换后重建而非就地改写
  const summary: LoopSummary = { ...baseSummary, loop: next.loop };

  return { nextState: next, summary, openingScene: config.openingScene };
}

/** 应用单类别的 inherit 策略 */
function applyPolicy(
  next: GameState,
  prev: GameState,
  category: LoopCategory,
  policy: LoopPolicy,
  value: unknown,
  accessor: CategoryAccessor,
  options: LoopTransitionOptions,
): void {
  if (policy === 'reset') return; // 已在整体 reset 中归位
  if (policy === 'inherit') {
    accessor.write(next, clone(value));
    return;
  }
  if (typeof policy === 'object' && 'keepRatio' in policy) {
    accessor.write(next, scaleByRatio(value, prev, policy.keepRatio, category, options));
    return;
  }
  if (typeof policy === 'object' && 'whitelist' in policy) {
    mergeByKeys(next, value, policy.whitelist, accessor);
    return;
  }
  if (typeof policy === 'object' && 'blacklist' in policy) {
    mergeExcludingKeys(next, value, policy.blacklist, accessor);
    return;
  }
}

/**
 * keepRatio 表达式求值：比例为 [0,1] 的数值，作用在**数值类**类别上。
 * 目前支持 attrs / factions（数值映射）与 wallet 类（属 items 的货币面不在
 * 类别清单内——货币保留比例经 flags/attrs 表达，见落地记录）。
 */
function scaleByRatio(
  value: unknown,
  prev: GameState,
  expression: string,
  category: LoopCategory,
  options: LoopTransitionOptions,
): unknown {
  const ratio = evalRatio(prev, expression, category, options);
  if (typeof value !== 'object' || value === null) {
    throw new EngineError({
      code: 'EFFECT_FAILED',
      where: { op: 'loop', category, detail: 'keepRatio 仅适用于数值映射类类别' },
      messageKey: 'error.effects.instructionFailed',
    });
  }
  const scaled: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'number') {
      scaled[key] = Math.floor(entry * ratio);
    } else if (typeof entry === 'object' && entry !== null) {
      // 嵌套数值映射（如 attrs 的派生层）：逐层缩放
      const inner: Record<string, unknown> = {};
      for (const [innerKey, innerValue] of Object.entries(entry as Record<string, unknown>)) {
        inner[innerKey] =
          typeof innerValue === 'number' ? Math.floor(innerValue * ratio) : innerValue;
      }
      scaled[key] = inner;
    } else {
      scaled[key] = entry;
    }
  }
  return scaled;
}

function evalRatio(
  prev: GameState,
  expression: string,
  category: LoopCategory,
  options: LoopTransitionOptions,
): number {
  const compiled = compileExpr(expression, options.functionRegistry);
  const value = evalExpr(compiled, {
    state: buildExprScope(prev),
    rng: options.rng,
    registry: options.functionRegistry,
  });
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new EngineError({
      code: 'EFFECT_FAILED',
      where: {
        op: 'loop',
        category,
        expr: expression,
        detail: `keepRatio 求值须为 [0,1] 数值，实际 ${String(value)}`,
      },
      messageKey: 'error.effects.instructionFailed',
    });
  }
  return value;
}

/**
 * 白名单合并：仅保留清单内的条目（其余保持基线）。
 *
 * 形态自适应（类别值可能是复合对象）：
 * - **扁平映射**（attrs/factions/quests/npcs/seen 等）：键空间即清单空间；
 * - **复合对象**（flags = `{flags, counters, unlockedAreas}`；items/outfit/body
 *   同理）：清单作用于其中的**主映射**（flags 类别的 `flags` 子面）——
 *   主映射取白名单过滤结果，其余子面带基线值。
 */
function mergeByKeys(
  next: GameState,
  value: unknown,
  keys: readonly string[],
  accessor: CategoryAccessor,
): void {
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  const primaryKeys = PRIMARY_MAP_KEYS[accessorKey(accessor)] ?? [];
  if (primaryKeys.length > 0) {
    // 复合形态：仅主映射按白名单过滤，其余子面保持基线（不合并）
    const merged: Record<string, unknown> = {};
    for (const key of primaryKeys) {
      const source = record[key];
      if (source === undefined) continue;
      if (typeof source === 'object' && source !== null) {
        const filtered: Record<string, unknown> = {};
        for (const name of keys) {
          const entry = (source as Record<string, unknown>)[name];
          if (entry !== undefined) filtered[name] = entry;
        }
        merged[key] = filtered;
      } else {
        merged[key] = source;
      }
    }
    const currentValue = accessor.read(next) as Record<string, unknown>;
    accessor.write(next, { ...currentValue, ...merged });
    return;
  }
  const filtered: Record<string, unknown> = {};
  for (const key of keys) {
    const entry = record[key];
    if (entry !== undefined) filtered[key] = entry;
  }
  accessor.write(next, filtered);
}

/** 复合形态类别的主映射子键（白名单/黑名单的作用面） */
const PRIMARY_MAP_KEYS: Partial<Record<LoopCategory, readonly string[]>> = {
  flags: ['flags'],
  items: ['bag', 'wallet'],
  outfit: ['equip', 'outfit'],
  body: ['body'],
  seen: ['scenes'],
};

/** 反查 accessor 所属类别（用于主映射表查询） */
const ACCESSOR_CATEGORY = new WeakMap<CategoryAccessor, LoopCategory>();
for (const [category, accessor] of Object.entries(CATEGORY_ACCESSORS) as [
  LoopCategory,
  CategoryAccessor,
][]) {
  ACCESSOR_CATEGORY.set(accessor, category);
}
function accessorKey(accessor: CategoryAccessor): LoopCategory {
  return ACCESSOR_CATEGORY.get(accessor) as LoopCategory;
}

/** 黑名单合并：排除清单外全部继承 */
function mergeExcludingKeys(
  next: GameState,
  value: unknown,
  keys: readonly string[],
  accessor: CategoryAccessor,
): void {
  if (typeof value !== 'object' || value === null) return;
  const excluded = new Set(keys);
  const filtered: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!excluded.has(key)) filtered[key] = entry;
  }
  accessor.write(next, filtered);
}

/** 转场摘要（FR-LOOP-03）：上一周目的天数/事件数/成就数 */
function summarize(prev: GameState): LoopSummary {
  const eventCount = Object.values(prev.world.counters).reduce(
    (sum, entry) => sum + (typeof entry === 'number' ? entry : 0),
    0,
  );
  return {
    loop: prev.loop,
    days: prev.world.time.day,
    events: eventCount,
    achievements: 0, // 成就数由宿主按 Profile 填充（引擎不持 Profile，DD-04）
  };
}
