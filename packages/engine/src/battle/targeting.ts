import type { BattleUnit } from './types.js';

/**
 * 目标选择（detail-design §5.2，16 号 W6 子任务 10 前片；FR-CMBT-12 多敌人）。
 *
 * **动机与落点**：AI 行动缺 `targetUid` 时 W2 执行器视为「无目标增益」
 * （#28 已向 A 方反馈）——本模块为执行器回退与 AI 数据面缺省提供统一的目标
 * 选择口径：
 * - **simple 缺省**：行动者阵营的对立面中首个存活者（声明序，确定性；单敌方
 *   场景显然正确，多敌方时作者用数据面 `targetUid` 或 AI 策略显式指定——
 *   「随机目标」类策略留作者扩展，不在内置面）；
 * - **self 显式**：heal 类技能打自己；
 * - **explicit 优先**：数据面声明的 targetUid 优先于缺省，但引用已倒下/不
 *   存在者时忽略回退（不硬选尸体）。
 *
 * 纯函数、确定性（无随机——目标选择不消耗 DD-09 序列）；对立面定义：
 * player/ally ↔ enemy（ally 为 P2 预留，语义就位）。
 */

/** 目标选择上下文（执行器/会话传入的存活单位表） */
export interface TargetingContext {
  /** 全部参战单位（含已倒下；存活过滤在本函数内做） */
  readonly units: readonly BattleUnit[];
}

/** 数据面候选（AI 策略/技能声明的显式目标；缺省策略不传） */
export interface TargetCandidate {
  /** 显式目标 uid（如 AI 策略声明的 'player' 约定） */
  readonly explicit: string;
}

/** 目标选择选项（全部可选；缺省 = simple 对立面首个存活者） */
export interface TargetingOptions {
  /** 显式候选（数据面声明；优先于缺省，倒下/不存在则忽略回退） */
  readonly candidates?: readonly TargetCandidate[];
  /** 策略：缺省 'simple'（对立面首个存活者）；'self' = 行动者自身（heal 类） */
  readonly strategy?: 'simple' | 'self';
}

const alive = (unit: BattleUnit): boolean => unit.hp > 0;

/** 行动者的对立面阵营（player/ally ↔ enemy；ally 为 P2 预留） */
function opposingSides(side: BattleUnit['side']): readonly BattleUnit['side'][] {
  return side === 'enemy' ? ['player', 'ally'] : ['enemy'];
}

export function selectTarget(
  actorUid: string,
  context: TargetingContext,
  options: TargetingOptions = {},
): BattleUnit | null {
  const { units } = context;
  const actor = units.find((unit) => unit.uid === actorUid);
  if (actor === undefined || !alive(actor)) return null;

  // 1) self 策略：heal 类打自己（存活时；已倒下者无可治疗目标）
  if (options.strategy === 'self') return alive(actor) ? actor : null;

  // 2) explicit 优先：数据面声明的目标存活才采纳（倒下/不存在 → 回退缺省）
  const explicit = options.candidates?.[0]?.explicit;
  if (explicit !== undefined) {
    const found = units.find((unit) => unit.uid === explicit);
    if (found !== undefined && alive(found)) return found;
  }

  // 3) simple 缺省：对立面首个存活者（声明序，确定性）
  const sides = opposingSides(actor.side);
  return units.find((unit) => alive(unit) && sides.includes(unit.side)) ?? null;
}
