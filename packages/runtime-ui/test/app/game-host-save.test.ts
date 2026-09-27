import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { AttrDefs, ContentTagsDef, SaveBlob } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import { createGameHost } from '../../src/app/game-host.js';
import type { GameHost } from '../../src/app/game-host.js';
import { MemoryAdapter } from '../../src/persistence/index.js';
import type { PersistenceAdapter } from '../../src/persistence/index.js';

/**
 * 25 号宿主补充：存读档 API（FR-SAVE-01/03/04；demo-issues #11 的宿主入口）。
 *
 * ## 为什么这一层必须有（该缺陷为何此前无人抓）
 * 问题 #11「界面上找不到存读档入口」的根因是**宿主没有 save/load API**——
 * 引擎的 `SaveService`、runtime-ui 的 `DexieAdapter`/`selectAdapter`、
 * `TitleScreen` 都就绪，但无一被装配起来（L-1 装配缺口的又一例）。引擎单测
 * 覆盖 `SaveService` 自身，却覆盖不到「宿主把 save/load 接到运行时 + 读档后
 * 收口会话」这一段。
 *
 * ## 本文件断言的**行为**（不是「方法存在」）
 * - 往返一致：存档 → 继续改变状态 → 读档 → 逐字段回到存档时刻；
 * - 读档后的收口：会话回到入口场景（口径甲）+ 回滚栈为空（不跨档沿用检查点）；
 * - 失败路径：空槽位 / 版本闸门拒绝 → `lastError` 显性化且**状态不变**；
 * - 适配器装配：未注入时经既有 `selectAdapter` 探测（jsdom 无 IndexedDB →
 *   降级到内存 + `degraded` 报告），不另写一份探测。
 */

const ROOT = 'fixtures/mini-game';

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`);
}

function readPackage(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const absolute of listFiles(ROOT)) {
    const relative = absolute.slice(absolute.indexOf(ROOT) + ROOT.length + 1);
    files[relative] = readFileSync(absolute, 'utf8');
  }
  return files;
}

const files = readPackage();

async function makeHost(options?: { persistence?: PersistenceAdapter }): Promise<GameHost> {
  const definition = await loadGamePackage(new InMemoryPackageSource(files));
  const attrDefs = parse(files['data/attrs.yaml'] as string) as AttrDefs;
  const contentTags = parse(files['data/content-tags.yaml'] as string) as ContentTagsDef;
  return createGameHost({
    definition,
    attrDefs,
    contentTags,
    initialAttrs: { hp: 100, stamina: 30, insight: 0, atk: 10, def: 3, spd: 5 },
    initialWallet: { town_silver: 20 },
    seed: 2026,
    ...(options?.persistence !== undefined ? { persistence: options.persistence } : {}),
  });
}

/** 反复推进直到出现选项或没有可推进的段落 */
function drain(host: GameHost, max = 12): void {
  for (let i = 0; i < max; i += 1) {
    if (host.store.getState().session.phase !== 'await_advance') break;
    host.advance();
  }
}

/**
 * 走到「集市听传闻 → 镇口」这一步：已产生属性（insight+2）、旗标（heard_rumor）、
 * 时间与两个回滚检查点。作为往返一致用例的共同起点。
 */
function walkToGate(host: GameHost): void {
  host.start();
  drain(host);
  host.choose('go_market');
  drain(host);
  host.choose('listen_rumor');
  drain(host);
}

/** 包装内存适配器：读取时改写 blob 版本字段（版本闸门用例的注入面） */
function withBlobPatch(
  base: MemoryAdapter,
  patch: (blob: SaveBlob) => SaveBlob,
): PersistenceAdapter {
  return {
    listSaves: () => base.listSaves(),
    load: async (slot) => patch(await base.load(slot)),
    write: (slot, blob) => base.write(slot, blob),
    remove: (slot) => base.remove(slot),
    rename: (slot, name) => base.rename(slot, name),
    loadBackup: (slot) => base.loadBackup(slot),
  };
}

const SLOT = 'slot_manual';

describe('宿主存读档：往返一致（FR-SAVE-01/03，demo-issues #11）', () => {
  it('存档 → 继续改变状态 → 读档：逐字段回到存档时刻，且会话已重建', async () => {
    const host = await makeHost({ persistence: new MemoryAdapter() });
    walkToGate(host);

    // 存档时刻的状态快照（属性 / 旗标 / 钱包 / 任务 / 时间 / 统计）
    const saved = host.runtime.serialize();
    const savedScene = host.store.getState().session.sceneId;
    expect(saved.world.flags['heard_rumor']).toBe(true);

    const savedResult = await host.saveToSlot(SLOT);
    expect(savedResult.ok).toBe(true);
    expect(host.lastError()).toBeNull();

    // 存档后继续走：旗标 + 时间（时段推进）都变化
    host.choose('greet_guard');
    drain(host);
    host.moveTo({ area: 'old_town', location: 'gate' });
    const mutated = host.runtime.serialize();
    expect(mutated.world.flags['old_guard_met']).toBe(true);
    expect(mutated.world.time.slotIndex).not.toBe(saved.world.time.slotIndex);

    // 读档
    const loadResult = await host.loadFromSlot(SLOT);
    expect(loadResult.ok).toBe(true);
    expect(host.lastError()).toBeNull();

    // 逐字段断言：回到存档时刻（attr / flag / wallet / quests / time）
    const restored = host.runtime.serialize();
    expect(restored.player.attrs).toEqual(saved.player.attrs);
    expect(restored.player.wallet).toEqual(saved.player.wallet);
    expect(restored.world.flags).toEqual(saved.world.flags);
    expect(restored.world.time).toEqual(saved.world.time);
    expect(restored.quests).toEqual(saved.quests);
    expect(restored.readStats).toEqual(saved.readStats);
    // 整体一致（以上逐域断言的兜底：防漏掉某个未单列的域）
    expect(restored).toEqual(saved);

    // 会话已重建：入口场景（口径甲——状态精确还原，叙事位置回入口场景）
    expect(host.store.getState().session.sceneId).toBe('arrival');
    expect(host.store.getState().screen).toBe('game');
    // 且与存档时的所在场景不同（证明确实重建而非沿用旧会话）
    expect(savedScene).toBe('town_gate');
  });

  it('读档后回滚栈为空（不跨档沿用旧检查点）', async () => {
    const host = await makeHost({ persistence: new MemoryAdapter() });
    walkToGate(host);
    // 走两步以上 → 已有检查点（每次选择打一个）
    expect(host.availableRollbackSteps()).toBeGreaterThan(0);
    // 存档前的历史含多组（arrival/market_street/town_gate）
    const groupsBefore = host.history().map((group) => group.sceneId);
    expect(groupsBefore.length).toBeGreaterThan(1);

    await host.saveToSlot(SLOT);
    expect(host.availableRollbackSteps()).toBeGreaterThan(0);

    await host.loadFromSlot(SLOT);
    // 引擎 runtime.restore 清空快照栈 + 宿主 resetHistoryBuffers 清回退锚点
    expect(host.runtime.state.checkpoints).toEqual([]);
    expect(host.availableRollbackSteps()).toBe(0);
    // 历史只含**重建会话的入口场景**（与新开局同形）：旧档的历史组一律不得残留
    const groupsAfter = host.history().map((group) => group.sceneId);
    expect(groupsAfter).toEqual(['arrival']);
    // 且没有任何分组附带回退步数（回滚栈空 → 不给会报错的按钮，#9b 口径）
    expect(host.history().every((group) => group.rollbackSteps === undefined)).toBe(true);
  });

  it('listSlots 反映已写入的槽位（FR-SAVE-01 UI 数据源）', async () => {
    const host = await makeHost({ persistence: new MemoryAdapter() });
    walkToGate(host);
    expect(await host.listSlots()).toEqual([]);

    await host.saveToSlot(SLOT);
    const slots = await host.listSlots();
    expect(slots.map((slot) => slot.slot)).toEqual([SLOT]);
    // 展示口径：slotName 由 persistence 切片派生（非 quick_/auto_ → manual）
    expect(slots[0]?.slotName).toBe('manual');
    expect(slots[0]?.location).toBe('town_gate');
    expect(slots[0]?.day).toBe(1);
  });
});

describe('宿主存读档：失败路径显性化且不改状态（NFR-10 / FR-MIGR-02）', () => {
  it('空槽位读档：返回失败 + lastError 显性化，状态与会话均不变', async () => {
    const host = await makeHost({ persistence: new MemoryAdapter() });
    host.start();
    drain(host);
    host.choose('go_market');
    drain(host);

    const before = host.runtime.serialize();
    const sceneBefore = host.store.getState().session.sceneId;

    const result = await host.loadFromSlot('empty_slot');
    expect(result.ok).toBe(false);
    expect(result.detail).toBeTypeOf('string');
    // 适配器抛 PersistenceError（不带引擎三元组）→ 宿主映射到存档错误码，
    // 而非落成 INTERNAL（否则「没存过档」看起来像「引擎坏了」）
    expect(host.lastError()?.code).toBe('SAVE_CORRUPT');
    expect(host.lastError()?.messageKey).toBe('error.save.slotMissing');

    // 状态不变（引擎 restore 未被调用）+ 会话未重建
    expect(host.runtime.serialize()).toEqual(before);
    expect(host.store.getState().session.sceneId).toBe(sceneBefore);
  });

  it('未 start 即存/读档：NOT_STARTED（与 withSession 同口径，不写半成品档）', async () => {
    const host = await makeHost({ persistence: new MemoryAdapter() });
    const save = await host.saveToSlot(SLOT);
    expect(save.ok).toBe(false);
    expect(host.lastError()?.code).toBe('NOT_STARTED');

    const load = await host.loadFromSlot(SLOT);
    expect(load.ok).toBe(false);
    expect(host.lastError()?.code).toBe('NOT_STARTED');
  });

  it('写入失败（quota 等）：转为 lastError，不静默（SAVE_CORRUPT）', async () => {
    const adapter = new MemoryAdapter();
    const host = await makeHost({ persistence: adapter });
    walkToGate(host);
    adapter.failNextWrite(new Error('QuotaExceededError'));

    const result = await host.saveToSlot(SLOT);
    expect(result.ok).toBe(false);
    expect(host.lastError()?.code).toBe('SAVE_CORRUPT');
    expect(host.lastError()?.detail).toContain('QuotaExceededError');
  });

  it('版本过高（VERSION_UNSUPPORTED）：拒绝且不触碰运行时状态（FR-MIGR-02）', async () => {
    const base = new MemoryAdapter();
    const host = await makeHost({
      persistence: withBlobPatch(base, (blob) => ({ ...blob, schemaVersion: 99 })),
    });
    walkToGate(host);
    await host.saveToSlot(SLOT);
    const before = host.runtime.serialize();

    const result = await host.loadFromSlot(SLOT);
    expect(result.ok).toBe(false);
    expect(host.lastError()?.code).toBe('VERSION_UNSUPPORTED');
    expect(host.runtime.serialize()).toEqual(before);
    expect(host.store.getState().session.sceneId).toBe('town_gate');
  });

  it('低版本且未注入迁移入口（MIGRATION_FAILED）：拒绝且不触碰运行时状态', async () => {
    const base = new MemoryAdapter();
    const host = await makeHost({
      persistence: withBlobPatch(base, (blob) => ({ ...blob, schemaVersion: 0 })),
    });
    walkToGate(host);
    await host.saveToSlot(SLOT);
    const before = host.runtime.serialize();

    const result = await host.loadFromSlot(SLOT);
    expect(result.ok).toBe(false);
    expect(host.lastError()?.code).toBe('MIGRATION_FAILED');
    expect(host.runtime.serialize()).toEqual(before);
  });
});

describe('宿主存读档：导出（FR-SAVE-04）', () => {
  it('exportSlot 产出可解析的 SaveBlob（JSON 往返）', async () => {
    const host = await makeHost({ persistence: new MemoryAdapter() });
    walkToGate(host);
    await host.saveToSlot(SLOT);

    const blob = await host.exportSlot(SLOT);
    expect(blob.formatVersion).toBeGreaterThanOrEqual(1);
    expect(blob.schemaVersion).toBe(1);
    expect(blob.state.world.flags['heard_rumor']).toBe(true);
    expect(blob.meta.location).toBe('town_gate');
    // JSON 文档往返（demo 的下载按钮即写这份文本）
    const roundTrip = JSON.parse(JSON.stringify(blob)) as SaveBlob;
    expect(roundTrip.state).toEqual(blob.state);
    expect(roundTrip.rngState).toBe(blob.rngState);
  });

  it('导出空槽位：抛错且 lastError 显性化（错误卡片可见）', async () => {
    const host = await makeHost({ persistence: new MemoryAdapter() });
    host.start();
    await expect(host.exportSlot('missing')).rejects.toThrow();
    expect(host.lastError()?.code).toBe('SAVE_CORRUPT');
  });
});

describe('宿主持久化装配：经既有 selectAdapter 探测（NFR-10，不自写探测）', () => {
  it('未注入适配器时：jsdom 无 IndexedDB → 降级到内存且报告 degraded', async () => {
    const host = await makeHost();
    // 装配是异步的：以一次存读档操作等待其就绪（与玩家首次点击同一路径）
    await host.listSlots();
    const status = host.persistenceStatus();
    expect(status.ready).toBe(true);
    expect(status.degraded).toBe(true);
    expect(status.adapter).toBe('memory');
    expect(status.reason).toBeTypeOf('string');
  });

  it('注入适配器时：直接采用（ready、不报降级）', async () => {
    const host = await makeHost({ persistence: new MemoryAdapter() });
    await host.listSlots();
    expect(host.persistenceStatus()).toMatchObject({ ready: true, degraded: false });
  });

  it('降级态下存读档仍可用（本次会话内往返成立）', async () => {
    const host = await makeHost();
    host.start();
    drain(host);
    host.choose('go_market');
    drain(host);
    host.choose('listen_rumor');
    drain(host);
    const saved = host.runtime.serialize();

    expect((await host.saveToSlot(SLOT)).ok).toBe(true);
    host.moveTo({ area: 'old_town', location: 'gate' });
    expect((await host.loadFromSlot(SLOT)).ok).toBe(true);
    expect(host.runtime.serialize()).toEqual(saved);
    expect(host.store.getState().session.sceneId).toBe('arrival');
  });
});
