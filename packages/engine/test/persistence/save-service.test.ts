import { describe, expect, it, vi } from 'vitest';
import { createRng } from '@game/shared';
import type { SceneRunnerRuntime } from '../../src/narrative/index.js';
import { SceneRunner } from '../../src/narrative/index.js';
import { GameRuntime } from '../../src/runtime/index.js';
import { createBuiltinEffectRegistry } from '../../src/effects/index.js';
import { newGameState } from '../../src/state/index.js';
import { MemoryAdapter } from '../../src/persistence/index.js';
import { SaveService, AUTOSAVE_SLOTS, QUICKSAVE_SLOT } from '../../src/persistence/index.js';
import { makeCtx } from '../effects/fixtures.js';
import { makeDef } from '../narrative/fixtures.js';

/**
 * SaveService（设计 §5.6；20 号任务 3–9）。
 *
 * 覆盖：SaveBlob 组装（三层版本 + rngState + meta）、多槽位列表与元信息投影、
 * autosave 三点触发与 auto_1..3 环形轮换、快存快读独立槽位、导出导入 JSON
 * 往返、写失败路径（quota → SAVE_CORRUPT 不静默）、槽位 rename/remove。
 */

/** 测试用定义（最小场景，用于会话/位置投影） */
const DEF = makeDef({
  scenes: [
    { id: 'scene_start', area: 'demo', segments: [{ key: 'scenes.a.p1' }], choices: [] },
    { id: 'scene_next', area: 'demo', segments: [{ key: 'scenes.a.p2' }], choices: [] },
  ],
  locales: { 'zh-CN': { scenes: { a: { p1: '一。', p2: '二。' } } } },
});

const VERSIONS = { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' };

/** 构造运行时（固定种子，确定性 rngState 断言） */
function makeRt(seed = 7): GameRuntime {
  const rng = createRng(seed);
  return new GameRuntime({
    state: newGameState({ versions: VERSIONS, attrs: { hp: 30, stamina: 5 } }, rng),
    rng,
    effectExecutor: createBuiltinEffectRegistry(),
  });
}

/** 构造 SaveService + MemoryAdapter 组合 */
function makeService(options?: { beforeWrite?: (slot: string) => void }): {
  service: SaveService;
  adapter: MemoryAdapter;
} {
  const adapter = new MemoryAdapter(
    options?.beforeWrite === undefined
      ? {}
      : {
          beforeWrite: () => {
            options.beforeWrite?.('any');
          },
        },
  );
  const service = new SaveService({ adapter, versions: VERSIONS, engineVersion: '0.0.1' });
  return { service, adapter };
}

describe('20-3 SaveService.save/load：SaveBlob 组装', () => {
  it('save 组装三层版本 + rngState + meta（位置/天/周目/时长）', async () => {
    const { service } = makeService();
    const rt = makeRt();
    await service.save('slot_1', { runtime: rt, location: 'scene_start', playSeconds: 300 });
    const blob = await service.loadBlob('slot_1');
    expect(blob.formatVersion).toBe(1);
    expect(blob.engineVersion).toBe('0.0.1');
    expect(blob.gameVersion).toBe('1.0.0');
    expect(blob.schemaVersion).toBe(1);
    expect(blob.meta).toEqual({
      createdAt: expect.any(Number),
      playSeconds: 300,
      location: 'scene_start',
      day: expect.any(Number),
      loop: 0,
    });
    // rngState 取自运行时（可回放）
    expect(blob.rngState).toBe(rt.rng.getState());
    // state 是运行时序列化投影
    expect(blob.state.player.attrs['hp']).toBe(30);
  });

  it('save 可附槽位显示名（FR-SAVE-06）与创建时刻覆盖', async () => {
    const { service } = makeService();
    await service.save('slot_1', {
      runtime: makeRt(),
      location: 'scene_start',
      playSeconds: 0,
      name: '进镇前',
      createdAt: 1_700_000_000_000,
    });
    const meta = (await service.listSaves()).find((entry) => entry.slot === 'slot_1');
    expect(meta).toMatchObject({ name: '进镇前', createdAt: 1_700_000_000_000 });
  });

  it('load 恢复到运行时：状态与 RNG 同档（同档行为确定可回放）', async () => {
    const { service } = makeService();
    const source = makeRt();
    source.exec([{ add: { key: 'attr.hp', amount: -5 } }], makeCtx());
    await service.save('slot_1', { runtime: source, location: 'scene_start', playSeconds: 10 });

    const target = makeRt(999); // 不同种子，读档后被 blob.rngState 覆盖
    await service.load('slot_1', target);
    expect(target.state.player.attrs['hp']).toBe(source.state.player.attrs['hp']);
    expect(target.rng.getState()).toBe(source.rng.getState());
  });

  it('meta.day 取存档时刻的 world.time.day', async () => {
    const { service } = makeService();
    const rt = makeRt();
    // 新档从第 1 天起（advanceClock 语义）；时间推进经 advance_time 跳转由宿主归约
    expect(rt.state.world.time.day).toBe(1);
    await service.save('slot_1', { runtime: rt, location: 'scene_start', playSeconds: 0 });
    const blob = await service.loadBlob('slot_1');
    expect(blob.meta.day).toBe(rt.state.world.time.day);
  });

  it('load 未知槽位 → 适配器的 SAVE_CORRUPT 原样上抛（不吞错）', async () => {
    const { service } = makeService();
    await expect(service.load('ghost', makeRt())).rejects.toMatchObject({
      code: 'SAVE_CORRUPT',
    });
  });
});

describe('20-4 多槽位 listSaves + SaveMeta 投影', () => {
  it('列表含槽位/名称/周目/位置/天/时长/版本/活动任务', async () => {
    const { service } = makeService();
    const rt = makeRt();
    // 接取任务后 activeQuests 摘要应含该任务（投影口径见 projectSaveMeta）
    rt.exec([{ quest: { id: 'quest_a', action: 'accept' } }], makeCtx());
    await service.save('slot_1', { runtime: rt, location: 'scene_start', playSeconds: 42 });
    const meta = (await service.listSaves())[0];
    expect(meta).toMatchObject({
      slot: 'slot_1',
      loop: 0,
      location: 'scene_start',
      playSeconds: 42,
      versions: { engineVersion: '0.0.1', gameVersion: '1.0.0', schemaVersion: 1 },
    });
    expect(meta?.activeQuests).toEqual(['quest_a']);
  });

  it('空存储列表为空数组', async () => {
    const { service } = makeService();
    expect(await service.listSaves()).toEqual([]);
  });
});

describe('20-5 autosave：触发点 + auto_1..3 环形轮换', () => {
  it('AUTOSAVE_SLOTS 为 auto_1..3（设计 §5.6「默认保留 3 份」）', () => {
    expect(AUTOSAVE_SLOTS).toEqual(['auto_1', 'auto_2', 'auto_3']);
  });

  it('three 个触发点均可触发（slot_advance/scene_enter/event_end）', async () => {
    const { service } = makeService();
    const rt = makeRt();
    await service.autosave('slot_advance', {
      runtime: rt,
      location: 'scene_start',
      playSeconds: 1,
    });
    await service.autosave('scene_enter', { runtime: rt, location: 'scene_next', playSeconds: 2 });
    await service.autosave('event_end', { runtime: rt, location: 'scene_next', playSeconds: 3 });
    const slots = (await service.listSaves()).map((meta) => meta.slot);
    expect(slots).toEqual(['auto_1', 'auto_2', 'auto_3']);
  });

  it('环形轮换：第 4 次回到 auto_1 并覆盖最旧', async () => {
    const { service } = makeService();
    const rt = makeRt();
    for (let i = 0; i < 4; i++) {
      await service.autosave('slot_advance', {
        runtime: rt,
        location: i === 3 ? 'scene_next' : 'scene_start',
        playSeconds: i,
      });
    }
    const list = await service.listSaves();
    expect(list.map((meta) => meta.slot)).toEqual(['auto_1', 'auto_2', 'auto_3']);
    expect(list.find((meta) => meta.slot === 'auto_1')?.playSeconds).toBe(3);
  });

  it('轮换只动 auto 槽：手动槽位不受影响（FR-SAVE-02 独立自动槽位）', async () => {
    const { service } = makeService();
    const rt = makeRt();
    await service.save('slot_5', { runtime: rt, location: 'scene_start', playSeconds: 9 });
    for (let i = 0; i < 5; i++) {
      await service.autosave('scene_enter', {
        runtime: rt,
        location: 'scene_start',
        playSeconds: i,
      });
    }
    const slots = (await service.listSaves()).map((meta) => meta.slot);
    expect(slots).toEqual(['auto_1', 'auto_2', 'auto_3', 'slot_5']);
  });

  it('轮换游标按适配器现状推导：手动删除 auto_2 后下一次写入补位而不跳号', async () => {
    const { service, adapter } = makeService();
    const rt = makeRt();
    await service.autosave('scene_enter', { runtime: rt, location: 'scene_start', playSeconds: 0 });
    await service.autosave('scene_enter', { runtime: rt, location: 'scene_start', playSeconds: 1 });
    await adapter.remove('auto_1');
    await service.autosave('scene_enter', { runtime: rt, location: 'scene_start', playSeconds: 2 });
    // auto_1 空缺 → 下一份写入 auto_1（保持槽位集连续）
    const slots = (await service.listSaves()).map((meta) => meta.slot);
    expect(slots).toEqual(['auto_1', 'auto_2']);
  });
});

describe('20-6 quicksave/quickload 独立槽位', () => {
  it('QUICKSAVE_SLOT 为独立槽位名（不与手动槽位或 auto 槽冲突）', () => {
    expect(QUICKSAVE_SLOT).toBe('quick');
    expect(AUTOSAVE_SLOTS).not.toContain(QUICKSAVE_SLOT);
  });

  it('快存覆盖同一槽位（单键快存语义）', async () => {
    const { service } = makeService();
    const rt = makeRt();
    await service.quicksave({ runtime: rt, location: 'scene_start', playSeconds: 1 });
    await service.quicksave({ runtime: rt, location: 'scene_next', playSeconds: 2 });
    const list = await service.listSaves();
    expect(list).toHaveLength(1);
    expect(list[0]?.location).toBe('scene_next');
  });

  it('快读恢复状态（无快存槽 → SAVE_CORRUPT）', async () => {
    const { service } = makeService();
    const rt = makeRt();
    await expect(service.quickload(makeRt())).rejects.toMatchObject({ code: 'SAVE_CORRUPT' });

    rt.exec([{ add: { key: 'attr.hp', amount: -9 } }], makeCtx());
    await service.quicksave({ runtime: rt, location: 'scene_start', playSeconds: 0 });
    rt.exec([{ add: { key: 'attr.hp', amount: -9 } }], makeCtx());
    await service.quickload(rt);
    expect(rt.state.player.attrs['hp']).toBe(21);
  });
});

describe('20-7 exportSlot/importSlot：JSON 往返', () => {
  it('exportSlot 产出可 JSON 序列化的 SaveBlob（导出即 JSON 文档）', async () => {
    const { service } = makeService();
    await service.save('slot_1', {
      runtime: makeRt(),
      location: 'scene_start',
      playSeconds: 5,
    });
    const blob = await service.exportSlot('slot_1');
    expect(JSON.parse(JSON.stringify(blob))).toEqual(blob);
  });

  it('importSlot：JSON 往返后导入到目标运行时（结构校验通过）', async () => {
    const { service } = makeService();
    const source = makeRt();
    source.exec([{ add: { key: 'attr.hp', amount: -3 } }], makeCtx());
    await service.save('slot_1', { runtime: source, location: 'scene_start', playSeconds: 5 });
    const exported = await service.exportSlot('slot_1');

    const target = makeRt(1);
    await service.importSlot(exported, target);
    expect(target.state.player.attrs['hp']).toBe(27);
  });

  it('importSlot 不触碰调用方对象：导入后改写原对象不影响运行时', async () => {
    const { service } = makeService();
    await service.save('slot_1', { runtime: makeRt(), location: 'scene_start', playSeconds: 0 });
    const exported = await service.exportSlot('slot_1');
    (exported.meta as { day: number }).day = 999;
    const target = makeRt(1);
    await service.importSlot(exported, target);
    expect(target.state.world.time.day).toBe(1);
  });

  it('importSlot 结构非法 → SAVE_CORRUPT（不静默、不部分写入）', async () => {
    const { service } = makeService();
    const target = makeRt();
    const before = target.state.player.attrs['hp'];
    await expect(service.importSlot({ nope: true }, target)).rejects.toMatchObject({
      code: 'SAVE_CORRUPT',
    });
    expect(target.state.player.attrs['hp']).toBe(before);
  });

  it('导入不写槽位（纯恢复路径，可复用于 UI 预览）', async () => {
    const { service } = makeService();
    await service.importSlot(
      {
        formatVersion: 1,
        engineVersion: '0.0.1',
        gameVersion: '1.0.0',
        schemaVersion: 1,
        rngState: 1,
        meta: { createdAt: 0, playSeconds: 0, location: 'scene_start', day: 1, loop: 0 },
        state: await (async () => {
          await service.save('tmp', { runtime: makeRt(), location: 'scene_start', playSeconds: 0 });
          return (await service.loadBlob('tmp')).state;
        })(),
      },
      makeRt(),
    );
    // importSlot 是纯恢复路径：只有用例自身预置的 tmp 槽，导入未新增槽位
    expect((await service.listSaves()).map((meta) => meta.slot)).toEqual(['tmp']);
  });
});

describe('20-8 写入失败路径：quota → SAVE_CORRUPT（不静默）+ 备份恢复', () => {
  it('写入抛 quota 异常 → 包装为 SAVE_CORRUPT 上抛（NFR-10）', async () => {
    const { service } = makeService({
      beforeWrite: () => {
        throw new Error('QuotaExceededError');
      },
    });
    await expect(
      service.save('slot_1', { runtime: makeRt(), location: 'scene_start', playSeconds: 0 }),
    ).rejects.toMatchObject({ code: 'SAVE_CORRUPT' });
  });

  it('SAVE_CORRUPT 保留底层错误链（cause）与槽位定位', async () => {
    const cause = new Error('QuotaExceededError');
    const { service } = makeService({
      beforeWrite: () => {
        throw cause;
      },
    });
    await expect(
      service.save('slot_1', { runtime: makeRt(), location: 'scene_start', playSeconds: 0 }),
    ).rejects.toMatchObject({
      code: 'SAVE_CORRUPT',
      where: expect.objectContaining({ slot: 'slot_1', operation: 'write' }),
      cause,
    });
  });

  it('写失败不损坏既有档：旧档保持可读', async () => {
    let failing = false;
    const adapter = new MemoryAdapter({
      beforeWrite: () => {
        if (failing) throw new Error('QuotaExceededError');
      },
    });
    const service = new SaveService({ adapter, versions: VERSIONS, engineVersion: '0.0.1' });
    const rt = makeRt();
    await service.save('slot_1', { runtime: rt, location: 'scene_start', playSeconds: 7 });
    failing = true;
    await expect(
      service.save('slot_1', { runtime: rt, location: 'scene_next', playSeconds: 8 }),
    ).rejects.toMatchObject({ code: 'SAVE_CORRUPT' });
    expect((await service.loadBlob('slot_1')).meta.playSeconds).toBe(7);
  });

  it('restoreBackup：从写前备份恢复槽位（FR-SAVE-05）', async () => {
    const { service } = makeService();
    const rt = makeRt();
    await service.save('slot_1', { runtime: rt, location: 'scene_start', playSeconds: 1 });
    await service.save('slot_1', { runtime: rt, location: 'scene_next', playSeconds: 2 });
    const restored = await service.restoreBackup('slot_1');
    expect(restored).toBe(true);
    expect((await service.loadBlob('slot_1')).meta.playSeconds).toBe(1);
  });

  it('restoreBackup：无备份槽位返回 false（不视为错误）', async () => {
    const { service } = makeService();
    await service.save('slot_1', { runtime: makeRt(), location: 'scene_start', playSeconds: 1 });
    expect(await service.restoreBackup('slot_1')).toBe(false);
    expect(await service.restoreBackup('ghost')).toBe(false);
  });
});

describe('20-9 槽位 rename/remove（服务层纯操作，二次确认在 UI 层）', () => {
  it('rename 转发到适配器且列表反映', async () => {
    const { service } = makeService();
    await service.save('slot_1', { runtime: makeRt(), location: 'scene_start', playSeconds: 0 });
    await service.rename('slot_1', '第二章前');
    expect((await service.listSaves())[0]?.name).toBe('第二章前');
  });

  it('remove 删除槽位（含备份）', async () => {
    const { service } = makeService();
    await service.save('slot_1', { runtime: makeRt(), location: 'scene_start', playSeconds: 0 });
    await service.remove('slot_1');
    expect(await service.listSaves()).toEqual([]);
    expect(await service.restoreBackup('slot_1')).toBe(false);
  });

  it('会话位置经 SceneRunner 更新（宿主可传 currentSceneId）', async () => {
    const { service } = makeService();
    const rt = makeRt();
    const runner = new SceneRunner(rt as unknown as SceneRunnerRuntime, {
      def: DEF,
      sceneId: 'scene_start',
    });
    runner.renderList();
    await service.save('slot_1', {
      runtime: rt,
      location: runner.currentSceneId,
      playSeconds: 0,
    });
    expect((await service.loadBlob('slot_1')).meta.location).toBe('scene_start');
  });
});

describe('SaveService：依赖未满足时的显式失败', () => {
  it('适配器 getter 暴露注入实例（宿主可复用同一持久层做 Profile）', () => {
    const adapter = new MemoryAdapter();
    const service = new SaveService({ adapter, versions: VERSIONS, engineVersion: '0.0.1' });
    expect(service.adapter).toBe(adapter);
  });

  it('版本信息缺省取自运行时状态（未显式注入时）', async () => {
    const adapter = new MemoryAdapter();
    const service = new SaveService({ adapter });
    await service.save('slot_1', { runtime: makeRt(), location: 'scene_start', playSeconds: 0 });
    const blob = await service.loadBlob('slot_1');
    expect(blob.gameVersion).toBe('1.0.0');
    expect(blob.schemaVersion).toBe(1);
  });

  it('beforeWrite 钩子被调用一次/写（失败注入面本身可断言）', async () => {
    const spy = vi.fn();
    const adapter = new MemoryAdapter({ beforeWrite: spy });
    const service = new SaveService({ adapter, versions: VERSIONS, engineVersion: '0.0.1' });
    await service.save('slot_1', { runtime: makeRt(), location: 'scene_start', playSeconds: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
