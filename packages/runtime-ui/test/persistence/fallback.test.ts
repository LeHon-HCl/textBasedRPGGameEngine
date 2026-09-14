import { describe, expect, it, beforeEach } from 'vitest';
import type { SaveBlob } from '@game/shared';
import { makeBlob } from './contract.js';
import {
  MemoryAdapter,
  PrivacyModeError,
  probeIndexedDb,
  selectAdapter,
  type PersistenceAdapter,
} from '../../src/persistence/index.js';

/**
 * 25 任务 10：隐私模式降级选择（NFR-10 / 设计 §6.7）。
 *
 * 「不静默丢档」的落地：探测 IndexedDB 不可用时切内存适配器，并由宿主呈现
 * 常驻横幅（见 PrivacyBanner.tsx）。选择逻辑抽为纯函数便于测试：
 * `selectAdapter(probe)` 返回 `{ adapter, degraded, reason }`。
 */

/** 构造探测结果（测试桩） */
function probe(available: boolean, reason = 'unavailable') {
  return { available, reason };
}

describe('probeIndexedDb：可用性探测（不抛错，只报告）', () => {
  it('jsdom 无 indexedDB → available=false 且给出原因', async () => {
    const result = await probeIndexedDb();
    expect(result.available).toBe(false);
    expect(result.reason).toBeTypeOf('string');
  });

  it('探测过程不抛错（拒绝路径也返回结果对象）', async () => {
    await expect(probeIndexedDb()).resolves.toBeDefined();
  });
});

describe('selectAdapter：降级选择（NFR-10）', () => {
  it('探测可用 → Dexie 适配器，degraded=false', async () => {
    const dexieFactory = () => new MemoryAdapter();
    const selection = await selectAdapter({
      probe: () => probe(true),
      createDexie: dexieFactory,
      createMemory: () => new MemoryAdapter(),
    });
    expect(selection.degraded).toBe(false);
    expect(selection.reason).toBeUndefined();
    expect(selection.adapter.name).toBe('memory'); // 桩工厂返回什么就是什么
  });

  it('探测不可用 → 内存适配器，degraded=true 且携带原因（横幅文案源）', async () => {
    const selection = await selectAdapter({
      probe: () => probe(false, 'IndexedDB 被隐私模式禁用'),
      createDexie: () => {
        throw new Error('不应调用 Dexie 工厂');
      },
      createMemory: () => new MemoryAdapter(),
    });
    expect(selection.degraded).toBe(true);
    expect(selection.reason).toBe('IndexedDB 被隐私模式禁用');
    expect(selection.adapter.name).toBe('memory');
  });

  it('Dexie 构造/打开抛错 → 回落内存且保留原始错误信息（不静默）', async () => {
    const selection = await selectAdapter({
      probe: () => probe(true),
      createDexie: () => {
        throw new PrivacyModeError('open 被拒绝');
      },
      createMemory: () => new MemoryAdapter(),
    });
    expect(selection.degraded).toBe(true);
    expect(selection.reason).toContain('open 被拒绝');
    expect(selection.adapter.name).toBe('memory');
  });

  it('探测函数自身抛错 → 按不可用处理（防御式：探测不得成为失败点）', async () => {
    const selection = await selectAdapter({
      probe: () => {
        throw new Error('probe crashed');
      },
      createDexie: () => new MemoryAdapter(),
      createMemory: () => new MemoryAdapter(),
    });
    expect(selection.degraded).toBe(true);
    expect(selection.reason).toContain('probe crashed');
  });
});

describe('适配器切换的可移植性（NFR-10 导出提醒的数据面）', () => {
  let adapter: PersistenceAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  it('内存适配器可导出全部存档（宿主据此提示「请导出存档」）', async () => {
    await adapter.write('quick', makeBlob({ createdAt: 1000 }));
    const metas = await adapter.listSaves();
    const exported: SaveBlob[] = [];
    for (const meta of metas) exported.push(await adapter.load(meta.slot));
    expect(exported).toHaveLength(1);
    // 导出面 = 槽位列表 + 逐槽 blob：宿主据此组装「槽位 → 文档」的导出包
    expect(metas.map((meta) => meta.slot)).toEqual(['quick']);
    expect(exported[0]?.meta.createdAt).toBe(1000);
  });
});
