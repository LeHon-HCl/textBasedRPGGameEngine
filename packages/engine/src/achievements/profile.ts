import { EngineError } from '@game/shared';
import { profileSchema, type GameId, type Profile, type PerkDef } from '@game/shared';
import type { ProfileStore } from './types.js';

/**
 * ProfileStore 内存实现（detail-design §5.4，18 号 B 线；DD-04）。
 *
 * 定位：引擎侧**测试与无持久化宿主**的实现（Dexie 实现归 25 号 runtime-ui）。
 * 乐观锁口径：`mutate` 串行化（内部 promise 队列）——并发调用按序执行，
 * 每次 mutate 基于**上一次提交后的最新快照**计算，杜绝丢失更新。
 *
 * 数据校验：构造与每次写回都过 `profileSchema`（跨存档数据结构与存档同级别
 * 守护；FR-MIGR-06 的 Profile 迁移粒度依赖该 schema）。
 */

/** 新 Profile 的缺省值（空档：无成就、无点数、无已购 Perk、无结局） */
export function createEmptyProfile(schemaVersion = 1): Profile {
  return {
    schemaVersion,
    achievements: {},
    points: 0,
    purchasedPerks: [],
    endings: [],
  };
}

export interface MemoryProfileStoreOptions {
  /** 初始 Profile（缺省空档） */
  readonly initial?: Profile;
  /** 写回钩子（测试可断言写入次数/内容；返回 Promise 可模拟 IO 失败） */
  readonly onWrite?: (profile: Profile) => void | Promise<void>;
}

/**
 * 内存 ProfileStore（乐观锁 = 串行队列）。
 *
 * `mutate(fn)`：入队 → 取最新快照 → `fn` 变换 → schema 校验 → 持久化。
 * `fn` 抛错时**不写回**（队列继续处理后续调用，错误向调用方冒泡）。
 */
export function createMemoryProfileStore(options: MemoryProfileStoreOptions = {}): ProfileStore {
  let current: Profile = profileSchema.parse(options.initial ?? createEmptyProfile());
  /** 串行队列尾（每次 mutate 挂在前一个之后，保证读-改-写原子） */
  let tail: Promise<void> = Promise.resolve();

  return {
    load(): Promise<Profile> {
      // 深拷贝交付：调用方拿到的是快照，改动不影响 store 内部状态
      return Promise.resolve(structuredClone(current));
    },

    mutate(fn: (profile: Profile) => Profile): Promise<void> {
      const run = tail.then(async () => {
        const next = fn(structuredClone(current));
        const validated = profileSchema.parse(next);
        await options.onWrite?.(validated);
        current = validated;
      });
      // 队列尾吞掉错误（避免一次失败卡死后续调用）；错误仍向本调用方冒泡
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

/**
 * Perk 购买校验（§5.4 FR-ACHV-06；两步协议第一步的前置判定）。
 *
 * 返回拒绝原因；合法返回 null。校验项：
 * - 点数充足（cost ≤ profile.points）；
 * - requires 全部已购；
 * - conflicts 与已购无交集；
 * - 非 repeatable 时未购过。
 */
export function validatePerkPurchase(
  profile: Profile,
  perk: PerkDef,
): 'insufficient_points' | 'requires_missing' | 'conflicts' | 'not_repeatable' | null {
  const purchased = new Set(profile.purchasedPerks.map((entry) => entry.id));
  if (perk.cost > profile.points) return 'insufficient_points';
  for (const required of perk.requires ?? []) {
    if (!purchased.has(required)) return 'requires_missing';
  }
  for (const conflict of perk.conflicts ?? []) {
    if (purchased.has(conflict)) return 'conflicts';
  }
  if (perk.repeatable !== true && purchased.has(perk.id)) return 'not_repeatable';
  return null;
}

/**
 * 两步协议第一步：扣点 + 记录已购（§5.4 FR-ACHV-06）。
 * 返回扣点是否成功；失败时 Profile 不变（校验在前，扣点在后）。
 */
export async function chargePerk(
  store: ProfileStore,
  perk: PerkDef,
  now: number,
): Promise<'ok' | 'insufficient_points' | 'requires_missing' | 'conflicts' | 'not_repeatable'> {
  let rejection:
    'insufficient_points' | 'requires_missing' | 'conflicts' | 'not_repeatable' | null = null;
  await store.mutate((profile) => {
    rejection = validatePerkPurchase(profile, perk);
    if (rejection !== null) return profile; // 不变（不扣点）
    return {
      ...profile,
      points: profile.points - perk.cost,
      purchasedPerks: [...profile.purchasedPerks, { id: perk.id, at: now }],
    };
  });
  return rejection ?? 'ok';
}

/**
 * 两步协议第二步的补偿：建档失败时回滚第一步的扣点与记录（§5.4 / §6.2）。
 * 仅当该 Perk 在已购清单中存在时才回加（幂等：重复补偿不重复加分）。
 */
export async function compensatePerk(store: ProfileStore, perk: PerkDef): Promise<boolean> {
  let compensated = false;
  await store.mutate((profile) => {
    const index = profile.purchasedPerks.findIndex((entry) => entry.id === perk.id);
    if (index < 0) return profile; // 不存在（已补偿过）→ 幂等无操作
    compensated = true;
    const purchasedPerks = profile.purchasedPerks.filter((_, i) => i !== index);
    return { ...profile, points: profile.points + perk.cost, purchasedPerks };
  });
  return compensated;
}

/**
 * `resetPoints` 协议（§5.4 FR-ACHV-07）：回收全部已购 Perk + 点数余额重算。
 *
 * 口径：点数余额重置为**已解锁成就的点数总和**（由调用方按当前成就目录计算
 * 后传入——Profile 只存解锁记录，点数总和依赖 AchievementDef.points，属目录面）。
 */
export async function resetPoints(
  store: ProfileStore,
  recomputePoints: (profile: Profile) => number,
): Promise<void> {
  await store.mutate((profile) => ({
    ...profile,
    points: recomputePoints(profile),
    purchasedPerks: [],
  }));
}

/**
 * 成就入账（解锁链路的宿主侧动作，§5.4）：把评估器产出的解锁载荷写进 Profile。
 * 幂等：已在 achievements 中的成就不再写（重复事件不重复加分）。
 */
export async function recordAchievements(
  store: ProfileStore,
  unlocked: readonly { id: GameId; points: number; progress?: { cur: number; goal: number } }[],
  now: number,
): Promise<number> {
  let recorded = 0;
  await store.mutate((profile) => {
    let points = profile.points;
    const achievements = { ...profile.achievements };
    for (const entry of unlocked) {
      if (achievements[entry.id] !== undefined) continue; // 幂等
      achievements[entry.id] = {
        unlockedAt: now,
        ...(entry.progress !== undefined ? { progress: entry.progress } : {}),
      };
      points += entry.points;
      recorded += 1;
    }
    if (recorded === 0) return profile;
    return { ...profile, achievements, points };
  });
  return recorded;
}

/** 断言 store 内 Profile 合法（调试/测试辅助；非法抛 EngineError） */
export function assertProfileValid(profile: unknown): Profile {
  const result = profileSchema.safeParse(profile);
  if (!result.success) {
    throw new EngineError({
      code: 'SAVE_CORRUPT',
      where: { op: 'profile', detail: result.error.message },
      messageKey: 'error.save.corrupt',
    });
  }
  return result.data as Profile;
}
