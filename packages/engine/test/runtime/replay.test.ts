import { describe, expect, it } from 'vitest';
import { EngineError, createRng, saveBlobSchema } from '@game/shared';
import type { EffectData, SaveBlob } from '@game/shared';
import { makeCtx, makeRuntime } from './fixtures.js';

/**
 * serialize/restore 运行时接线与回放测试（04 任务 C3，DD-09：同种子 Rng +
 * 同操作序列 → 同终态；rngState 随档保存恢复）。
 *
 * 回放口径：运行时 A 执行操作序列并序列化（含 RNG 状态）→ 运行时 B restore
 * 后执行同一序列 → 两次 serialize 深比较一致。随机操作经 ctx.rng 消耗同一
 * 序列，若 rngState 未随档恢复即失败。
 */

const BOOTSTRAP = {
  versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' },
  attrs: { hp: 30, con: 2 },
  derivedFormulas: { max_hp: '10 + attr.con * 3' },
  npcs: { raven: { favor: 1, met: true } },
  factions: { mages: 5 },
  bag: [{ itemId: 'potion', count: 2 }],
};

/** 回放用操作序列：状态写入与随机消耗交错（随机指令使 rngState 恢复可被验证） */
const REPLAY_OPS: EffectData[] = [
  { flag: { name: 'door_opened', value: true } },
  { set: { key: 'attr.hp', value: 22 } },
  { call: { fn: 'test.eval_rand' } },
  { money: { gold: 7 } },
  { call: { fn: 'test.eval_rand' } },
];

/** 以运行时当前状态与 RNG 组装合法 SaveBlob（02 号 schema 校验） */
function snapshotBlob(rt: ReturnType<typeof makeRuntime>): SaveBlob {
  return saveBlobSchema.parse({
    formatVersion: 1,
    engineVersion: '0.0.0',
    gameVersion: '1.0.0',
    schemaVersion: 1,
    state: rt.serialize(),
    rngState: rt.rng.getState(),
    meta: {
      createdAt: 1700000000000,
      playSeconds: 60,
      location: 'scene_tavern',
      day: 1,
      loop: 0,
    },
  });
}

describe('04-C3 GameRuntime.serialize / restore', () => {
  it('serialize 输出即入档投影（schema 终验、不含 checkpoints/npcLocationCache）', () => {
    const rt = makeRuntime({ bootstrap: BOOTSTRAP });
    rt.checkpoint('cp0');
    const serialized = rt.serialize();
    expect(serialized.player.derived.max_hp).toBe(16);
    expect(serialized).not.toHaveProperty('checkpoints');
    expect(serialized.world).not.toHaveProperty('npcLocationCache');
    expect(rt.rng.getState()).toBeTypeOf('number');
  });

  it('restore 恢复状态与 rngState；回滚栈跨档清空', () => {
    const source = makeRuntime({ bootstrap: BOOTSTRAP });
    source.checkpoint('old_point');
    source.exec(REPLAY_OPS, makeCtx({ rng: source.rng }));
    const blob = snapshotBlob(source);
    const rngStateAtSave = blob.rngState;

    const target = makeRuntime({ bootstrap: BOOTSTRAP });
    target.checkpoint('stale_point');
    target.restore(blob);

    expect(target.rng.getState()).toBe(rngStateAtSave);
    expect(target.state.player.attrs.hp).toBe(22);
    expect(target.state.world.flags['door_opened']).toBe(true);
    expect(target.state.player.wallet.gold).toBe(7);
    expect(target.state.player.derived.max_hp).toBe(16);
    expect(target.state.versions).toEqual({
      engineVersion: '0.0.0',
      gameVersion: '1.0.0',
      schemaVersion: 1,
    });
    expect(target.rollback(1).ok).toBe(false); // 旧档回滚点不可达
  });

  it('restore 的状态为冻结副本（绕过事务改写抛错）', () => {
    const blob = snapshotBlob(makeRuntime({ bootstrap: BOOTSTRAP }));
    const target = makeRuntime({ bootstrap: BOOTSTRAP });
    target.restore(blob);
    expect(() => {
      (target.state as { player: { attrs: Record<string, number> } }).player.attrs.hp = 0;
    }).toThrow();
  });

  it('损坏 blob.state 透传 SAVE_CORRUPT（不产生半恢复状态）', () => {
    const blob = snapshotBlob(makeRuntime({ bootstrap: BOOTSTRAP }));
    const corrupt = {
      ...blob,
      state: { ...blob.state, npcs: { raven: { favor: 'high' as unknown as number } } },
    } as unknown as SaveBlob;
    const target = makeRuntime({ bootstrap: BOOTSTRAP });
    const before = target.state;
    expect(() => target.restore(corrupt)).toThrowError(EngineError);
    try {
      target.restore(corrupt);
    } catch (err) {
      expect((err as EngineError).code).toBe('SAVE_CORRUPT');
    }
    expect(target.state).toBe(before); // 恢复失败不触碰当前状态
  });
});

describe('04-C3 回放测试：同种子 + 同操作序列 → 同终态（DD-09）', () => {
  it('restore 后重放同一序列，serialize 深比较一致（含随机指令）', () => {
    // 运行时 A：新档 → 记录操作前快照（含 rngState）→ 执行序列
    const a = makeRuntime({ bootstrap: BOOTSTRAP, rng: createRng(2024) });
    const preBlob = snapshotBlob(a);
    a.exec(REPLAY_OPS, makeCtx({ rng: a.rng }));
    const aAfter = a.serialize();

    // 运行时 B：不同种子预消耗随机（保证 restore 真正重置 RNG 序列）
    // → restore 操作前快照 → 重放同一序列
    const b = makeRuntime({ bootstrap: BOOTSTRAP, rng: createRng(7) });
    b.exec([{ call: { fn: 'test.eval_rand' } }], makeCtx({ rng: b.rng }));
    b.restore(preBlob);
    b.exec(REPLAY_OPS, makeCtx({ rng: b.rng }));

    expect(b.serialize()).toEqual(aAfter);
    // 随机指令产物一致（若 rngState 未随档恢复即失败）
    expect(b.state.world.flags['rand_seen']).toBe(a.state.world.flags['rand_seen']);
  });

  it('操作前快照与终态快照分立：restore 精确回到打点时刻（非终态）', () => {
    const a = makeRuntime({ bootstrap: BOOTSTRAP, rng: createRng(2024) });
    const preBlob = snapshotBlob(a);
    a.exec(REPLAY_OPS, makeCtx({ rng: a.rng }));
    const postBlob = snapshotBlob(a);

    const b = makeRuntime({ bootstrap: BOOTSTRAP, rng: createRng(7) });
    b.restore(postBlob);
    expect(b.state.player.attrs.hp).toBe(22);
    expect(b.state.player.wallet.gold).toBe(7);
    b.restore(preBlob);
    expect(b.state.player.attrs.hp).toBe(30);
    expect(b.state.player.wallet.gold).toBeUndefined();
    expect(b.state.world.flags['rand_seen']).toBeUndefined();
  });

  it('restore 后继续执行与再序列化保持确定性（跨存读档随机序列衔接）', () => {
    const a = makeRuntime({ bootstrap: BOOTSTRAP, rng: createRng(2024) });
    a.exec(REPLAY_OPS, makeCtx({ rng: a.rng }));
    const blob = snapshotBlob(a);
    const aNext = a.exec([{ call: { fn: 'test.eval_rand' } }], makeCtx({ rng: a.rng }));

    const b = makeRuntime({ bootstrap: BOOTSTRAP, rng: createRng(7) });
    b.restore(blob);
    const bNext = b.exec([{ call: { fn: 'test.eval_rand' } }], makeCtx({ rng: b.rng }));

    expect(b.state.world.flags['rand_seen']).toBe(a.state.world.flags['rand_seen']);
    expect(bNext.events.map((event) => event.type)).toEqual(
      aNext.events.map((event) => event.type),
    );
  });
});
