import type { Clock, EventDef, GameState, Rng, TimeConfig } from '@game/shared';

/**
 * 事件池评估流程（设计 §4.4 collect → prune → select，10 号模块）。
 *
 * 三个步骤均为**纯函数**（不写状态、不接触 runtime）：
 * - collect：byScope 作用域候选 + 静态窗口过滤（when.slots / when.weekdays）；
 * - prune：冷却 / once / 内容过滤裁剪；
 * - select：condition 型按 priority 降序全出（可配仅首个）、random 型
 *   Rng.weighted 抽取 + mutexGroup 约束（同组至多一个）。
 *
 * 脏标记增量（require 只重算 refs 命中的事件）由 evaluator 的宿主接线面承担
 * （events/system.ts 的 EventPool + PoolIndex.dirtyMap）；本文件是纯判定核心。
 *
 * 错过窗口（FR-XPLR-06）为设计裁决：when 不匹配的事件**不做排队**，直接丢弃
 * （作者用 condition 型 + 自定义 flag 实现预约式剧情）。
 */

/** 事件候选（入选原因，§4.4 EventCandidate） */
export interface EventCandidate {
  readonly event: EventDef;
  readonly reason: 'condition' | 'random' | 'explore';
}

/** collect 选项（TimeConfig 与时钟用于窗口比对；缺省 = 不做窗口过滤） */
export interface CollectOptions {
  readonly config?: TimeConfig;
  readonly clock?: Clock;
}

/** prune 选项 */
export interface PruneOptions {
  /**
   * 内容过滤器（§5.8 应用点 1；结构化最小视图，避免 events 横向依赖 content 子系统）。
   * `ContentFilter` 实例结构化满足本接口，宿主直接注入。
   */
  readonly contentFilter?: { eventAdmissible(event: Pick<EventDef, 'tags'>): boolean };
  /** TimeConfig（slots 冷却换算用；缺省用 slotsPerDay=1 口径） */
  readonly config?: TimeConfig;
  /** 上次触发时的 slotIndex（eventsCooldowns 只存 lastDay：slots 冷却的补充面） */
  readonly lastSlotIndex?: Readonly<Record<string, number>>;
}

/** select 选项 */
export interface SelectOptions {
  /** 只取 priority 最高的一个 condition 事件（游戏可配置，§4.4 select） */
  readonly onlyFirst?: boolean;
}

/**
 * collect（§4.4 步骤 1）：取作用域候选并做静态窗口过滤。
 *
 * 作用域 key 口径（PoolIndex.byScope）：地点事件 `${area}/${location}` 与
 * 区域通配事件 `${area}/*` 均属当前候选；其他区域不取。
 * 窗口口径：when.slots 与当前时段**名**（TimeConfig.slots[slotIndex].id）比对；
 * when.weekdays 与当前星期**名**（TimeConfig.weekdays[weekdayIndex-1] 的位置序，
 * 以 config 的 startWeekday 校准）比对——两者皆缺省 = 无窗口限制。
 */
export function collectCandidates(
  events: readonly EventDef[],
  area: string,
  location: string | undefined,
  options: CollectOptions = {},
): EventDef[] {
  const { config, clock } = options;
  const slotName = currentSlotName(config, clock);
  const weekdayName = currentWeekdayName(config, clock);
  return events.filter((event) => {
    if (event.where.area !== area) return false;
    if (event.where.location !== undefined && event.where.location !== location) return false;
    const slots = event.when.slots;
    if (slots !== undefined && slots.length > 0) {
      if (slotName === undefined || !slots.includes(slotName)) return false;
    }
    const weekdays = event.when.weekdays;
    if (weekdays !== undefined && weekdays.length > 0) {
      if (weekdayName === undefined || !weekdays.includes(weekdayName)) return false;
    }
    return true;
  });
}

/** 当前时段名（TimeConfig 定义；未注入或越界 → undefined = 窗口不可判，裁剪） */
function currentSlotName(config: TimeConfig | undefined, clock: Clock | undefined): string | undefined {
  if (config === undefined || clock === undefined) return undefined;
  return config.slots[clock.slotIndex]?.id;
}

/**
 * 当前星期名（§4.3 口径：day 1 对应 startWeekday，按 weekdays.length 循环）。
 * 返回位置序的字符串（'1'..'7'），与 event.when.weekdays 的作者书写口径一致
 * （TimeConfig 的 weekdays 只有 nameKey，位置序即其标识）。
 */
function currentWeekdayName(
  config: TimeConfig | undefined,
  clock: Clock | undefined,
): string | undefined {
  if (config === undefined || clock === undefined) return undefined;
  const count = config.weekdays.length;
  const offset = (((config.startWeekday - 1 + clock.day - 1) % count) + count) % count;
  return String(offset + 1);
}

/**
 * prune（§4.4 步骤 2）：冷却 / once / 内容过滤裁剪。
 *
 * - 冷却 `days`：`当前 day - lastDay >= days` 才可再触发（无记录 = 可触发）；
 * - 冷却 `slots`：绝对时段计数差（`day × slotsPerDay + slotIndex`）判定；
 *   上次 slotIndex 由宿主经 {@link PruneOptions.lastSlotIndex} 补充；
 * - once 'save'：`fired >= 1` 即裁剪；once 'loop' 在 19 号周目系统接入前
 *   按 save 口径处理（周目重置时由宿主清空 eventCooldowns）并在此注明；
 * - 内容过滤：`contentFilter.eventAdmissible` 为 false 即裁剪（FR-CGRD-03）。
 */
export function pruneCandidates(
  events: readonly EventDef[],
  state: GameState,
  options: PruneOptions = {},
): EventDef[] {
  const clock = state.world.time;
  const slotsPerDay = options.config?.slots.length ?? 1;
  const cooldowns = state.world.eventCooldowns;
  return events.filter((event) => {
    if (options.contentFilter !== undefined && !options.contentFilter.eventAdmissible(event)) {
      return false;
    }
    const record = cooldowns[event.id];
    const trigger = event.trigger;
    const once = 'once' in trigger ? trigger.once : undefined;
    if (once !== undefined && record !== undefined && record.fired >= 1) {
      return false;
    }
    const cooldown = 'cooldown' in trigger ? trigger.cooldown : undefined;
    if (cooldown === undefined || record === undefined) return true;
    if (cooldown.days !== undefined && typeof cooldown.days === 'number') {
      if (clock.day - record.lastDay < cooldown.days) return false;
    }
    if (cooldown.slots !== undefined && typeof cooldown.slots === 'number') {
      const lastSlotIndex = options.lastSlotIndex?.[event.id] ?? 0;
      const elapsed = (clock.day - record.lastDay) * slotsPerDay + (clock.slotIndex - lastSlotIndex);
      if (elapsed < cooldown.slots) return false;
    }
    return true;
  });
}

/**
 * select（§4.4 步骤 3）：条件型按优先级全出 + 概率型加权抽取（互斥约束）。
 *
 * 顺序与约束：
 * 1. require 真值化（explore 型不参与自动 select——由 exploreCandidates 呈现）；
 * 2. condition 型按 priority 降序（缺省 0）入选，`onlyFirst` 时只取首个；
 * 3. random 型在**未被互斥占用**的组内按权重抽取；同组多个 random 至多一个
 *    （权重最大者优先；权重相同时按声明序）；
 * 4. mutexGroup 已被 condition 型占用 → 同组 random 全部跳过（FR-XPLR-05）。
 */
export function selectCandidates(
  events: readonly EventDef[],
  state: GameState,
  evalCondition: (source: string) => boolean,
  rng: Rng,
  options: SelectOptions = {},
): EventCandidate[] {
  void state;
  const selected: EventCandidate[] = [];
  /** 已被占用的互斥组（condition 入选 / random 抽中） */
  const usedGroups = new Set<string>();

  const conditions = events
    .filter((event) => event.trigger.type === 'condition')
    .filter((event) => evalCondition((event.trigger as { require: string }).require))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const event of conditions) {
    if (options.onlyFirst === true && selected.length > 0) break;
    selected.push({ event, reason: 'condition' });
    if (event.mutexGroup !== undefined) usedGroups.add(event.mutexGroup);
  }

  // random：按互斥组分组；无组者各自独立抽取
  const randoms = events.filter(
    (event) =>
      event.trigger.type === 'random' &&
      (event.mutexGroup === undefined || !usedGroups.has(event.mutexGroup)) &&
      evalRandomRequire(event, evalCondition),
  );
  const groups = new Map<string, EventDef[]>();
  for (const event of randoms) {
    // 无互斥组的 random 共用「默认池」：每时段至多抽取一个（§4.4「概率型抽取」
    // 的节流口径——否则每个事件都独立抽取会一次推进刷出多个随机事件）
    const key = event.mutexGroup ?? '__default';
    const bucket = groups.get(key) ?? [];
    bucket.push(event);
    groups.set(key, bucket);
  }
  for (const bucket of groups.values()) {
    const picked = weightedPick(bucket, rng);
    if (picked !== undefined) selected.push({ event: picked, reason: 'random' });
  }
  return selected;
}

/** random 型 require 求值（缺省 = 恒真） */
function evalRandomRequire(
  event: EventDef,
  evalCondition: (source: string) => boolean,
): boolean {
  const trigger = event.trigger;
  if (trigger.type !== 'random') return false;
  if (trigger.require === undefined) return true;
  return evalCondition(trigger.require);
}

/** 加权抽取（DD-09：经注入 Rng，同种子可回放）；权重最大者优先的策略见比较口径 */
function weightedPick(bucket: readonly EventDef[], rng: Rng): EventDef | undefined {
  if (bucket.length === 0) return undefined;
  if (bucket.length === 1) return bucket[0];
  const weights = bucket.map((event) => {
    const trigger = event.trigger;
    return trigger.type === 'random' || trigger.type === 'explore' ? trigger.weight : 1;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < bucket.length; i++) {
    roll -= weights[i] as number;
    if (roll < 0) return bucket[i];
  }
  return bucket[bucket.length - 1];
}

/**
 * 探索发现型子池（FR-XPLR-04③ / FR-XPLR-08）：地点行动时呈现的交互点列表。
 * 与 selectCandidates 的差异：不自动进入场景，只按条件过滤 + 权重序返回候选
 * （UI 呈现清单由宿主/25 号决定；此处不消耗随机）。
 */
export function exploreCandidates(
  events: readonly EventDef[],
  evalCondition: (source: string) => boolean,
): EventCandidate[] {
  return events
    .filter((event) => event.trigger.type === 'explore')
    .filter((event) => {
      const trigger = event.trigger;
      if (trigger.type !== 'explore' || trigger.require === undefined) return true;
      return evalCondition(trigger.require);
    })
    .sort((a, b) => {
      const wa = a.trigger.type === 'explore' ? a.trigger.weight : 0;
      const wb = b.trigger.type === 'explore' ? b.trigger.weight : 0;
      return wb - wa;
    })
    .map((event) => ({ event, reason: 'explore' as const }));
}
