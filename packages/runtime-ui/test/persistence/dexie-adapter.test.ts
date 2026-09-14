import { afterEach, describe, expect, it } from 'vitest';
import { DexieAdapter } from '../../src/persistence/index.js';
import { makeBlob, runPersistenceAdapterContract } from './contract.js';

/**
 * 25 任务 10：DexieAdapter（IndexedDB 持久化，设计 §6.7 / DD-04）。
 *
 * 契约部分跑与 MemoryAdapter 相同的套件（行为等价是 NFR-10 的核心承诺）；
 * 另有 Dexie 特有面：原子写的覆盖语义、ProfileStore 的读写、kv 标记、
 * 以及「无 IndexedDB 环境」时的显性失败（隐私模式探测路径的数据源）。
 */

/** 每个用例用独立的库名（jsdom 环境无 IndexedDB 时全部走「不可用」断言） */
let seq = 0;
const uniqueDbName = (): string => `tbg-test-${Date.now()}-${seq++}`;

/** 探测当前测试环境是否提供可用的 IndexedDB */
const hasIndexedDb = (): boolean =>
  typeof (globalThis as { indexedDB?: IDBFactory }).indexedDB !== 'undefined';

const created: DexieAdapter[] = [];
function makeAdapter(): DexieAdapter {
  const adapter = new DexieAdapter(uniqueDbName());
  created.push(adapter);
  return adapter;
}

afterEach(() => {
  for (const adapter of created.splice(0)) adapter.close();
});

describe('DexieAdapter：无 IndexedDB 环境（隐私模式探测路径）', () => {
  it('open 抛 PrivacyModeError（不静默降级——降级决策归 selectAdapter）', async () => {
    if (hasIndexedDb()) return; // jsdom 无 IndexedDB；一旦环境提供则跳过该断言
    const adapter = makeAdapter();
    await expect(adapter.open()).rejects.toThrow(/IndexedDB 打开失败/);
  });

  it('构造不抛错（探测失败必须延后到 open，便于宿主捕获并降级）', () => {
    expect(() => makeAdapter()).not.toThrow();
  });

  it('适配器 name 标识为 dexie（诊断与提示文案源）', () => {
    expect(makeAdapter().name).toBe('dexie');
  });
});

describe('DexieAdapter：ProfileStore 与 kv（§5.6 / §6.7）', () => {
  it('load 无记录返回初始 Profile（读操作不写库）', async () => {
    if (!hasIndexedDb()) return;
    const adapter = makeAdapter();
    const profile = await adapter.profile.load();
    expect(profile).toMatchObject({ schemaVersion: 1, points: 0, purchasedPerks: [], endings: [] });
    expect(profile.achievements).toEqual({});
  });

  it('mutate 应用变更并持久化（乐观锁事务内读改写）', async () => {
    if (!hasIndexedDb()) return;
    const adapter = makeAdapter();
    await adapter.profile.mutate((profile) => {
      profile.points += 10;
      profile.endings.push('quiet_town');
    });
    const reloaded = await adapter.profile.load();
    expect(reloaded.points).toBe(10);
    expect(reloaded.endings).toEqual(['quiet_town']);
  });

  it('kv 标记可读回（quota 提示等适配器级状态）', async () => {
    if (!hasIndexedDb()) return;
    const adapter = makeAdapter();
    expect(await adapter.getFlag<number>('schemaVersion')).toBeUndefined();
    await adapter.setFlag('schemaVersion', 2);
    expect(await adapter.getFlag<number>('schemaVersion')).toBe(2);
  });

  it('clearAll 清空三表（重置游戏路径）', async () => {
    if (!hasIndexedDb()) return;
    const adapter = makeAdapter();
    await adapter.write('slot_a', makeBlob({ createdAt: 1000 }));
    await adapter.profile.mutate((profile) => {
      profile.points = 5;
    });
    await adapter.clearAll();
    expect(await adapter.listSaves()).toEqual([]);
    expect((await adapter.profile.load()).points).toBe(0);
  });
});

// 契约套件：仅在提供 IndexedDB 的环境执行（jsdom 默认不提供，CI 走跳过路径；
// 浏览器的 Playwright 冒烟（后续模块）会以真实 IndexedDB 覆盖同一契约）
if (hasIndexedDb()) {
  runPersistenceAdapterContract({
    name: 'DexieAdapter',
    create: async () => {
      const adapter = makeAdapter();
      await adapter.open();
      return adapter;
    },
  });
} else {
  describe('DexieAdapter：契约套件（跳过）', () => {
    it('当前测试环境不提供 IndexedDB，契约由浏览器侧 E2E 覆盖', () => {
      expect(hasIndexedDb()).toBe(false);
    });
  });
}
