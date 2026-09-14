import type { SaveBlob } from '@game/engine';
import { describe, expect, it } from 'vitest';

/**
 * 持久化适配器契约测试套件（设计 §5.6 / DD-04；20 号任务 1）。
 *
 * **任何 `PersistenceAdapter` 实现必须通过本套件**：engine 的 MemoryAdapter
 * （测试基座与隐私模式降级）与 runtime-ui 的 DexieAdapter（§6.7）复用同一份
 * 用例集——契约只有一处，避免两个实现各测各的、行为悄悄分叉。
 *
 * 放置说明：本文件在 fixtures/helpers（跨包测试支撑包）而非 engine 内，
 * 因为 runtime-ui 的实现也必须能导入它；直接深导入 `@game/engine/test/...`
 * 违反导出约定（§10.4，lint 强制）。`SaveBlob` 直接取自 `@game/engine`
 * 公开导出面（该包已 re-export shared 类型），保证与实现侧的同一性。
 *
 * 契约语义（实现必须满足，不满足即视为实现缺陷）：
 * 1. **往返**：write → load 返回深相等的 blob；
 * 2. **原子性**（FR-SAVE-05 / NFR-22）：覆盖写前旧档移入备份位；写失败时旧档
 *    保持可读（不损坏、不半写）、失败显式抛出（不静默）；
 * 3. **隔离**：store 与调用方各持独立副本（外部改写不污染存储，取出后再改
 *    不影响后续读取）；
 * 4. **缺失语义**：读取/重命名未知槽位抛 SAVE_CORRUPT（含槽位定位），
 *    loadBackup 对无备份槽位返回 null（无备份不是错误）；
 * 5. **投影**：listSaves 返回全部槽位的 SaveMeta（键序确定），字段取自 blob。
 */

/** 适配器最小结构视图（engine.PersistenceAdapter 结构化满足；DD-06 同型缝） */
export interface PersistenceAdapterLike {
  listSaves(): Promise<AdapterSaveMeta[]>;
  load(slot: string): Promise<SaveBlob>;
  write(slot: string, blob: SaveBlob): Promise<void>;
  remove(slot: string): Promise<void>;
  rename(slot: string, name: string): Promise<void>;
  loadBackup(slot: string): Promise<SaveBlob | null>;
}

/** 槽位元信息视图（engine.SaveMeta 的结构对应面） */
export interface AdapterSaveMeta {
  readonly slot: string;
  readonly name?: string;
  readonly loop: number;
  readonly location: string;
  readonly day: number;
  readonly playSeconds: number;
  readonly createdAt: number;
  readonly versions: {
    readonly engineVersion: string;
    readonly gameVersion: string;
    readonly schemaVersion: number;
  };
  /** 活动任务 id（UI 经 QuestDef 解析显示名；设计 §5.6 写 TextKey[]，见实现记录偏差） */
  readonly activeQuests: readonly string[];
}

/** 契约套件的实现工厂（每个实现提供独立实例，测试间不共享状态） */
export type AdapterFactory = () => Promise<PersistenceAdapterLike> | PersistenceAdapterLike;

/** 构造最小合法 SaveBlob（契约套件只关心存取语义，不关心业务字段含义） */
export function sampleBlob(overrides?: {
  name?: string;
  day?: number;
  playSeconds?: number;
  schemaVersion?: number;
}): SaveBlob {
  const state = {
    versions: {
      engineVersion: '0.0.0',
      gameVersion: '1.0.0',
      schemaVersion: overrides?.schemaVersion ?? 1,
      minEngineVersion: '0.0.1',
    },
    player: {
      attrs: { hp: 10 },
      skills: {},
      statuses: [],
      body: {},
      equip: {},
      outfit: {},
      bag: [],
      wallet: {},
      derived: {},
    },
    world: {
      time: { day: overrides?.day ?? 3, slotIndex: 1 },
      unlockedAreas: [],
      flags: {},
      counters: {},
      npcLocationCache: {},
      eventCooldowns: {},
    },
    npcs: {},
    factions: {},
    quests: {
      quest_a: { state: 'active', objectives: { find: 1 } },
      quest_b: { state: 'done', objectives: {} },
    },
    seen: { scenes: [], gallery: [], cg: [], endings: [], codex: [] },
    readStats: {
      playSeconds: overrides?.playSeconds ?? 120,
      eventCounts: {},
      checks: { attempts: 0, successes: 0 },
      battles: { wins: 0, losses: 0, escapes: 0 },
    },
    settings: {
      lang: 'zh-CN',
      textSpeed: 1,
      fontSize: 16,
      lineHeight: 1.6,
      bgmOn: true,
      sfxOn: true,
      imagesOn: true,
      reducedMotion: false,
      disabledTags: [],
      wizardDone: false,
    },
    checkpoints: [],
    loop: 2,
  } as unknown as SaveBlob['state'];
  return {
    formatVersion: 1,
    engineVersion: '0.0.0',
    gameVersion: '1.0.0',
    schemaVersion: overrides?.schemaVersion ?? 1,
    state,
    rngState: 12345,
    meta: {
      ...(overrides?.name !== undefined ? { name: overrides.name } : {}),
      createdAt: 1_700_000_000_000,
      playSeconds: overrides?.playSeconds ?? 120,
      location: 'arrival',
      day: overrides?.day ?? 3,
      loop: 2,
    },
  };
}

/**
 * 注册适配器契约用例集（在调用方的 describe 内使用）。
 *
 * @param name 实现名（用例标题前缀，失败时一眼看出是哪个实现）
 * @param factory 每次调用返回**独立**的适配器实例
 */
export function describePersistenceAdapterContract(
  name: string,
  factory: AdapterFactory,
): void {
  describe(`${name} —— PersistenceAdapter 契约（§5.6）`, () => {
    it('往返：write → load 返回深相等的 blob', async () => {
      const adapter = await factory();
      const blob = sampleBlob();
      await adapter.write('slot_1', blob);
      expect(await adapter.load('slot_1')).toEqual(blob);
    });

    it('多槽位互不干扰：各槽位独立存取', async () => {
      const adapter = await factory();
      await adapter.write('slot_1', sampleBlob({ name: '甲' }));
      await adapter.write('slot_2', sampleBlob({ name: '乙' }));
      expect((await adapter.load('slot_1')).meta.name).toBe('甲');
      expect((await adapter.load('slot_2')).meta.name).toBe('乙');
    });

    it('存储隔离：写入后外部改写入参不影响存储内容', async () => {
      const adapter = await factory();
      const blob = sampleBlob();
      await adapter.write('slot_1', blob);
      (blob.meta as { day: number }).day = 999;
      expect((await adapter.load('slot_1')).meta.day).toBe(3);
    });

    it('读取隔离：取出后外部改写不影响后续读取', async () => {
      const adapter = await factory();
      await adapter.write('slot_1', sampleBlob());
      const first = await adapter.load('slot_1');
      (first.meta as { day: number }).day = 999;
      expect((await adapter.load('slot_1')).meta.day).toBe(3);
    });

    it('写入原子性 + 写前备份（FR-SAVE-05）：覆盖写将旧档移入备份位', async () => {
      const adapter = await factory();
      await adapter.write('slot_1', sampleBlob({ day: 3 }));
      await adapter.write('slot_1', sampleBlob({ day: 5 }));
      expect((await adapter.load('slot_1')).meta.day).toBe(5);
      const backup = await adapter.loadBackup('slot_1');
      expect(backup?.meta.day).toBe(3);
    });

    it('无备份槽位：loadBackup 返回 null（无备份不是错误）', async () => {
      const adapter = await factory();
      await adapter.write('slot_1', sampleBlob());
      expect(await adapter.loadBackup('slot_1')).toBeNull();
    });

    it('读取未知槽位：抛 SAVE_CORRUPT 并携带槽位定位', async () => {
      const adapter = await factory();
      await expect(adapter.load('ghost')).rejects.toMatchObject({
        code: 'SAVE_CORRUPT',
        where: expect.objectContaining({ slot: 'ghost' }),
      });
    });

    it('remove：删除后 listSaves 不再含该槽、load 抛 SAVE_CORRUPT', async () => {
      const adapter = await factory();
      await adapter.write('slot_1', sampleBlob());
      await adapter.write('slot_2', sampleBlob());
      await adapter.remove('slot_1');
      const slots = (await adapter.listSaves()).map((meta) => meta.slot);
      expect(slots).toEqual(['slot_2']);
      await expect(adapter.load('slot_1')).rejects.toMatchObject({ code: 'SAVE_CORRUPT' });
    });

    it('remove 未知槽位：抛 SAVE_CORRUPT（不静默）', async () => {
      const adapter = await factory();
      await expect(adapter.remove('ghost')).rejects.toMatchObject({ code: 'SAVE_CORRUPT' });
    });

    it('rename：显示名更新且 listSaves 反映；槽位数据不变', async () => {
      const adapter = await factory();
      await adapter.write('slot_1', sampleBlob({ name: '旧名' }));
      await adapter.rename('slot_1', '新名');
      const meta = (await adapter.listSaves()).find((entry) => entry.slot === 'slot_1');
      expect(meta?.name).toBe('新名');
      expect((await adapter.load('slot_1')).meta.day).toBe(3);
    });

    it('rename 未知槽位：抛 SAVE_CORRUPT', async () => {
      const adapter = await factory();
      await expect(adapter.rename('ghost', 'x')).rejects.toMatchObject({ code: 'SAVE_CORRUPT' });
    });

    it('listSaves：空存储返回空数组；含槽位时键序确定（槽位字典序）', async () => {
      const adapter = await factory();
      expect(await adapter.listSaves()).toEqual([]);
      await adapter.write('slot_9', sampleBlob());
      await adapter.write('slot_1', sampleBlob());
      expect((await adapter.listSaves()).map((meta) => meta.slot)).toEqual(['slot_1', 'slot_9']);
    });

    it('listSaves 投影：meta 字段取自 blob（周目/位置/时间/时长/版本/活动任务）', async () => {
      const adapter = await factory();
      await adapter.write('slot_1', sampleBlob({ day: 7, playSeconds: 456 }));
      const meta = (await adapter.listSaves())[0];
      expect(meta).toMatchObject({
        slot: 'slot_1',
        loop: 2,
        location: 'arrival',
        day: 7,
        playSeconds: 456,
        createdAt: 1_700_000_000_000,
        versions: { engineVersion: '0.0.0', gameVersion: '1.0.0', schemaVersion: 1 },
      });
      // 活动任务只含 state==='active' 的项（done/failed 不入摘要）
      expect(meta?.activeQuests).toEqual(['quest_a']);
    });

    it('删除即弃备份：remove 后 loadBackup 返回 null（不残留可读旧档）', async () => {
      const adapter = await factory();
      await adapter.write('slot_1', sampleBlob({ day: 3 }));
      await adapter.write('slot_1', sampleBlob({ day: 5 }));
      await adapter.remove('slot_1');
      expect(await adapter.loadBackup('slot_1')).toBeNull();
    });
  });
}
