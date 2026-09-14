import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { SaveBlob } from '@game/shared';
import { newGameState, serializeState } from '@game/engine';
import type { PersistenceAdapter } from '../../src/persistence/index.js';

/**
 * 持久化适配器**契约套件**（设计 §5.6 / §6.7，DD-04）。
 *
 * 20 号（存档系统）与本模块并行开发，其契约套件尚未落地；本文件按 §5.6 的
 * 接口语义自建等价套件，与 20 号落地后的套件**断言同一组不变量**：
 *
 * 1. listSaves 按创建时刻降序（最近的存档在首位，主菜单「继续」直接取首项）；
 * 2. load 对未知槽位抛错（不静默返回空档）；
 * 3. write 为原子写：覆盖已有槽位时先备份旧档，失败不留半写状态；
 * 4. remove 删除槽位与备份；rename 只改显示名不动数据；
 * 5. loadBackup 无备份返回 null（首写前没有备份是合法状态）。
 *
 * 为什么契约套件与实现同仓而非共享：内存适配器与 Dexie 适配器的**行为等价**
 * 是本模块的核心承诺（NFR-10 降级不改变语义），套件即该承诺的可执行定义。
 */

/** 契约套件的被测对象描述 */
export interface AdapterUnderTest {
  /** 适配器名称（用例标题用） */
  readonly name: string;
  /** 每个用例前构造全新适配器（隔离） */
  readonly create: () => Promise<PersistenceAdapter>;
}

/**
 * 构造一个合法 SaveBlob（经引擎 newGameState + serializeState 生成，
 * 保证 state 与 shared schema 逐字一致，而非手写近似物）。
 *
 * @param overrides.createdAt 元信息创建时刻（排序断言用）
 * @param overrides.name 槽位显示名
 */
export function makeBlob(
  overrides: { createdAt?: number; name?: string; location?: string; playSeconds?: number } = {},
): SaveBlob {
  const state = newGameState(
    { versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' }, attrs: {} },
    createRng(1),
  );
  return {
    formatVersion: 1,
    engineVersion: '0.0.0',
    gameVersion: '1.0.0',
    schemaVersion: 1,
    state: serializeState(state),
    rngState: 1,
    meta: {
      name: overrides.name ?? '手动存档',
      createdAt: overrides.createdAt ?? 1_700_000_000_000,
      playSeconds: overrides.playSeconds ?? 60,
      location: overrides.location ?? 'arrival',
      day: 1,
      loop: 0,
    },
  };
}

/** 适配器契约断言（对内存与 Dexie 两种实现跑同一组） */
export function runPersistenceAdapterContract(target: AdapterUnderTest): void {
  describe(`${target.name}：PersistenceAdapter 契约（§5.6）`, () => {
    it('空库：listSaves 为空、loadBackup 为 null', async () => {
      const adapter = await target.create();
      expect(await adapter.listSaves()).toEqual([]);
      expect(await adapter.loadBackup('slot_a')).toBeNull();
    });

    it('write → listSaves 投影元信息（槽名/天数/周目/位置/版本）', async () => {
      const adapter = await target.create();
      await adapter.write('slot_a', makeBlob({ createdAt: 1000 }));
      const list = await adapter.listSaves();
      expect(list).toHaveLength(1);
      const meta = list[0];
      expect(meta).toMatchObject({
        slot: 'slot_a',
        day: 1,
        loop: 0,
        location: 'arrival',
        playSeconds: 60,
      });
      expect(meta?.versions).toEqual({
        engineVersion: '0.0.0',
        gameVersion: '1.0.0',
        schemaVersion: 1,
      });
    });

    it('listSaves 按创建时刻降序（主菜单「继续」取首项即最近存档）', async () => {
      const adapter = await target.create();
      await adapter.write('old', makeBlob({ createdAt: 1000 }));
      await adapter.write('newest', makeBlob({ createdAt: 3000 }));
      await adapter.write('middle', makeBlob({ createdAt: 2000 }));
      expect((await adapter.listSaves()).map((meta) => meta.slot)).toEqual([
        'newest',
        'middle',
        'old',
      ]);
    });

    it('load 返回写入的档（深等）', async () => {
      const adapter = await target.create();
      const blob = makeBlob({ createdAt: 1000 });
      await adapter.write('slot_a', blob);
      expect(await adapter.load('slot_a')).toEqual(blob);
    });

    it('load 未知槽位抛错（不静默返回空档）', async () => {
      const adapter = await target.create();
      await expect(adapter.load('missing')).rejects.toThrow();
    });

    it('覆盖写：旧档进入备份（FR-SAVE-05）', async () => {
      const adapter = await target.create();
      await adapter.write('slot_a', makeBlob({ createdAt: 1000 }));
      await adapter.write('slot_a', makeBlob({ createdAt: 2000 }));
      const backup = await adapter.loadBackup('slot_a');
      expect(backup?.meta.createdAt).toBe(1000);
      expect((await adapter.load('slot_a')).meta.createdAt).toBe(2000);
      // 备份不进入槽位列表（不是独立存档）
      expect((await adapter.listSaves()).map((meta) => meta.slot)).toEqual(['slot_a']);
    });

    it('rename 只改显示名，不动存档数据与备份', async () => {
      const adapter = await target.create();
      await adapter.write('slot_a', makeBlob({ createdAt: 1000 }));
      await adapter.rename('slot_a', '第一章 · 旧镇');
      expect((await adapter.load('slot_a')).meta.name).toBe('第一章 · 旧镇');
      expect(await adapter.loadBackup('slot_a')).toBeNull();
    });

    it('remove 删除槽位与备份', async () => {
      const adapter = await target.create();
      await adapter.write('slot_a', makeBlob({ createdAt: 1000 }));
      await adapter.write('slot_a', makeBlob({ createdAt: 2000 }));
      await adapter.remove('slot_a');
      expect(await adapter.listSaves()).toEqual([]);
      expect(await adapter.loadBackup('slot_a')).toBeNull();
      await expect(adapter.load('slot_a')).rejects.toThrow();
    });

    it('多槽位互不干扰（隔离性）', async () => {
      const adapter = await target.create();
      await adapter.write('auto_1', makeBlob({ createdAt: 1000 }));
      await adapter.write('auto_2', makeBlob({ createdAt: 2000 }));
      await adapter.remove('auto_1');
      expect((await adapter.listSaves()).map((meta) => meta.slot)).toEqual(['auto_2']);
      expect((await adapter.load('auto_2')).meta.createdAt).toBe(2000);
    });
  });
}
