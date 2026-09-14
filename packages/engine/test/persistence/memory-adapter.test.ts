import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { SaveBlob } from '@game/shared';
import { GameRuntime } from '../../src/runtime/index.js';
import { createBuiltinEffectRegistry } from '../../src/effects/index.js';
import { newGameState } from '../../src/state/index.js';
import { MemoryAdapter, projectSaveMeta } from '../../src/persistence/index.js';

/**
 * MemoryAdapter 的引擎侧行为（非契约部分，20 号任务 2/8）。
 *
 * 契约面（往返/隔离/原子写/缺失语义/列表投影）由 fixtures/helpers 的公共套件
 * 守护（fixtures/helpers/test/persistence-contract.test.ts——engine 自身不得
 * import 该包，设计 §1.2 R2 对 test 同样适用）。本文件断言实现独有的降级与
 * 注入语义：写失败注入（quota 路径）、size 观测、rename 保留备份位。
 */

const VERSIONS = { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' };

/** 构造最小合法 SaveBlob（经真实运行时序列化，口径与 SaveService 一致） */
function makeBlob(day: number): SaveBlob {
  const rng = createRng(7);
  const runtime = new GameRuntime({
    state: newGameState({ versions: VERSIONS, attrs: { hp: 30 } }, rng),
    rng,
    effectExecutor: createBuiltinEffectRegistry(),
  });
  const state = runtime.serialize();
  return {
    formatVersion: 1,
    engineVersion: '0.0.1',
    gameVersion: '1.0.0',
    schemaVersion: 1,
    state: { ...state, world: { ...state.world, time: { ...state.world.time, day } } },
    rngState: runtime.rng.getState(),
    meta: { createdAt: 1_700_000_000_000, playSeconds: 60, location: 'scene_start', day, loop: 0 },
  };
}

describe('MemoryAdapter：非契约行为', () => {
  it('写失败注入（quota 异常）：本次写入不生效，槽位保持写入前状态', async () => {
    let failing = false;
    const adapter = new MemoryAdapter({
      beforeWrite: () => {
        if (failing) throw new Error('QuotaExceededError');
      },
    });
    await adapter.write('slot_1', makeBlob(3));
    failing = true;
    await expect(adapter.write('slot_2', makeBlob(9))).rejects.toThrow('QuotaExceededError');
    // 失败写入不留残留：新槽位不存在，size 不增长
    expect(adapter.size).toBe(1);
    await expect(adapter.load('slot_2')).rejects.toMatchObject({ code: 'SAVE_CORRUPT' });
  });

  it('写失败不损坏旧档：旧档可读、备份位未被本轮污染', async () => {
    let failing = false;
    const adapter = new MemoryAdapter({
      beforeWrite: () => {
        if (failing) throw new Error('QuotaExceededError');
      },
    });
    await adapter.write('slot_1', makeBlob(3));
    failing = true;
    await expect(adapter.write('slot_1', makeBlob(5))).rejects.toThrow('QuotaExceededError');
    expect((await adapter.load('slot_1')).meta.day).toBe(3);
    expect(await adapter.loadBackup('slot_1')).toBeNull();
  });

  it('size 反映已用槽位数（隐私模式降级诊断面，NFR-10）', async () => {
    const adapter = new MemoryAdapter();
    expect(adapter.size).toBe(0);
    await adapter.write('slot_1', makeBlob(1));
    await adapter.write('slot_2', makeBlob(2));
    expect(adapter.size).toBe(2);
    await adapter.remove('slot_1');
    expect(adapter.size).toBe(1);
  });

  it('rename 保留备份位（重命名只动显示名，不动数据面）', async () => {
    const adapter = new MemoryAdapter();
    await adapter.write('slot_1', makeBlob(3));
    await adapter.write('slot_1', makeBlob(5));
    await adapter.rename('slot_1', '手动命名');
    expect((await adapter.loadBackup('slot_1'))?.meta.day).toBe(3);
    expect((await adapter.load('slot_1')).meta.day).toBe(5);
  });
});

describe('projectSaveMeta：blob → 元信息投影', () => {
  it('activeQuests 只含 active 状态任务，按 id 排序', () => {
    const blob = makeBlob(1);
    const state = blob.state as { quests: Record<string, { state: string; objectives: object }> };
    state.quests = {
      quest_b: { state: 'done', objectives: {} },
      quest_a: { state: 'active', objectives: {} },
      quest_c: { state: 'active', objectives: {} },
    };
    expect(projectSaveMeta('slot_1', blob).activeQuests).toEqual(['quest_a', 'quest_c']);
  });

  it('无 name 时投影不含 name 字段（可选面不显示 undefined）', () => {
    const meta = projectSaveMeta('slot_1', makeBlob(1));
    expect(meta).not.toHaveProperty('name');
    expect(projectSaveMeta('slot_1', makeBlob(1)).day).toBe(1);
  });

  it('name 存在时透传（FR-SAVE-06 显示名）', () => {
    const blob = makeBlob(1);
    blob.meta = { ...blob.meta, name: '进镇前' };
    expect(projectSaveMeta('slot_1', blob).name).toBe('进镇前');
  });
});
