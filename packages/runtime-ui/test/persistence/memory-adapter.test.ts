import { describe, expect, it } from 'vitest';
import { MemoryAdapter, PrivacyModeError } from '../../src/persistence/index.js';
import { makeBlob, runPersistenceAdapterContract } from './contract.js';

/**
 * 25 任务 10：内存适配器（NFR-10 隐私模式降级实现）。
 *
 * 与 DexieAdapter 跑**同一份契约套件**：降级不得改变语义（NFR-10
 * 「IndexedDB 不可用（隐私模式等）时降级到内存 + 频繁导出提醒，不静默丢档」）。
 */

/** 允许注入写入失败的适配器（契约 3「原子写」的失败路径断言） */
describe('MemoryAdapter 失败注入（NFR-10 降级路径的可测性）', () => {
  it('quota 失败向上抛错且不留半写状态（旧档可读）', async () => {
    const adapter = new MemoryAdapter();
    await adapter.write('slot_a', makeBlob({ createdAt: 1000 }));
    adapter.failNextWrite(new Error('QuotaExceededError'));
    await expect(adapter.write('slot_a', makeBlob({ createdAt: 2000 }))).rejects.toThrow(
      'QuotaExceededError',
    );
    // 原子性：失败后旧档仍可读（不是半写）
    expect((await adapter.load('slot_a')).meta.createdAt).toBe(1000);
  });
});

describe('MemoryAdapter 元信息', () => {
  it('name 标明内存实现（宿主据此提示「数据不会保留」）', () => {
    expect(new MemoryAdapter().name).toBe('memory');
  });

  it('PrivacyModeError 携带原因（诊断面可读）', () => {
    const error = new PrivacyModeError('IndexedDB 打开被拒（隐私模式）');
    expect(error.name).toBe('PrivacyModeError');
    expect(error.message).toContain('隐私模式');
  });
});

runPersistenceAdapterContract({
  name: 'MemoryAdapter',
  create: async () => new MemoryAdapter(),
});
