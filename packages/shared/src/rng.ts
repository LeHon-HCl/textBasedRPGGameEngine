import { EngineError } from './errors.js';

/**
 * 随机数抽象（设计 §2.5，DD-09）。
 *
 * - 所有随机（骰子/事件/掉落/判定/战斗）必须经注入的 `Rng` 接口，默认 mulberry32；
 * - RNG 状态随存档保存（`rngState`），读档恢复 → 同档行为确定可回放；
 * - `fork()` 供战斗表现层抖动等临时使用：分叉不影响主序列（不回写存档）。
 * - 测试：`createRng(42)` 注入 → 全部随机路径可断言（设计 §1.3 原则 2）。
 */

/** mulberry32 内部状态（uint32）。JSON 可序列化，随存档保存（DD-09） */
export type RngState = number;

/** 加权随机条目：weight ≤ 0 的条目永不被选中；全 0 权重视为契约违规 */
export interface WeightedEntry<T> {
  item: T;
  weight: number;
}

/**
 * 可注入的确定性随机源（设计 §2.5）。
 * 所有方法对同一状态序列确定；契约违规（空池、非法区间等）抛 EngineError（INTERNAL）。
 */
export interface Rng {
  /** [0, 1) 内均匀分布的浮点数 */
  next(): number;
  /** [minIncl, maxIncl] 内均匀分布的整数；minIncl = maxIncl 时恒返回该值 */
  int(minIncl: number, maxIncl: number): number;
  /** 等概率抽取一项；空池抛 EngineError（INTERNAL） */
  pick<T>(items: readonly T[]): T;
  /** 按权重抽取一项；权重为负/全 0/空池抛 EngineError（INTERNAL） */
  weighted<T>(entries: readonly WeightedEntry<T>[]): T;
  /** 以概率 p 返回 true；p=0 恒 false，p=1 恒 true；p 越界抛 EngineError（INTERNAL） */
  chance(p: number): boolean;
  /** 读取内部状态（随存档保存，DD-09） */
  getState(): RngState;
  /** 恢复内部状态（读档恢复，DD-09） */
  setState(s: RngState): void;
  /**
   * 从当前状态确定性派生一个独立 Rng（战斗表现层抖动语义，§2.5）：
   * 不消耗、不回写主序列；同一主状态分叉出的子序列相同。
   */
  fork(): Rng;
}

/** mulberry32（DD-09 默认算法）：uint32 状态的快速 PRNG，序列质量满足游戏随机需求 */
class Mulberry32Rng implements Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = seed | 0;
  }

  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(minIncl: number, maxIncl: number): number {
    if (!Number.isInteger(minIncl) || !Number.isInteger(maxIncl) || minIncl > maxIncl) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { min: String(minIncl), max: String(maxIncl) },
        messageKey: 'error.rng.intBounds',
      });
    }
    return minIncl + Math.floor(this.next() * (maxIncl - minIncl + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { length: '0' },
        messageKey: 'error.rng.emptyPool',
      });
    }
    const index = this.int(0, items.length - 1);
    return items[index] as T;
  }

  weighted<T>(entries: readonly WeightedEntry<T>[]): T {
    if (entries.length === 0) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { length: '0' },
        messageKey: 'error.rng.emptyPool',
      });
    }
    let total = 0;
    let index = 0;
    for (const entry of entries) {
      if (!Number.isFinite(entry.weight) || entry.weight < 0) {
        throw new EngineError({
          code: 'INTERNAL',
          where: { index: String(index) },
          messageKey: 'error.rng.negativeWeight',
        });
      }
      total += entry.weight;
      index += 1;
    }
    if (total <= 0) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { total: String(total) },
        messageKey: 'error.rng.zeroWeightTotal',
      });
    }
    let cumulative = 0;
    const roll = this.next() * total;
    for (const entry of entries) {
      cumulative += entry.weight;
      if (roll < cumulative) return entry.item;
    }
    // 不可达：roll < total = 累计和（同序累加），防御浮点舍入兜底
    throw new EngineError({
      code: 'INTERNAL',
      messageKey: 'error.rng.weightedMiss',
    });
  }

  chance(p: number): boolean {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { p: String(p) },
        messageKey: 'error.rng.chanceProbability',
      });
    }
    // next() ∈ [0,1)：p=0 恒 false，p=1 恒 true
    return this.next() < p;
  }

  getState(): RngState {
    return this.#state >>> 0;
  }

  setState(s: RngState): void {
    if (!Number.isFinite(s)) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { state: String(s) },
        messageKey: 'error.rng.invalidState',
      });
    }
    this.#state = s | 0;
  }

  fork(): Rng {
    // 以 fmix32 混淆当前状态得到子种子：确定性派生、不消耗主序列、避免与主序列同流
    return createRng(fmix32(this.getState()));
  }
}

/** 32 位最终化混淆（MurmurHash3 fmix32），用于 fork 的子种子派生 */
function fmix32(h: number): number {
  let x = h | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** 以给定种子创建默认 Rng（mulberry32，DD-09）。种子按 int32 归一化 */
export function createRng(seed: number): Rng {
  return new Mulberry32Rng(seed);
}
