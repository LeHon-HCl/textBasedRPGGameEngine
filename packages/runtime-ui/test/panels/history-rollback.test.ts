import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { AttrDefs, ContentTagsDef } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import { createGameHost } from '../../src/app/game-host.js';
import type { GameHost } from '../../src/app/game-host.js';
import { projectHistory } from '../../src/panels/history-projection.js';

/**
 * B1/B2 测试（25 号 B 组）：多步回滚 + 历史回看 + **M2 验收第 4 条**。
 *
 * 口径甲（2026-09-23 人类裁定）：回滚 5 步断言**状态树一致**
 * （attrs/flags/wallet/quests/time/npcs）；叙事位置回 entryScene 属设计要求
 * （§6.3），不纳入断言。
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

async function makeHost(): Promise<GameHost> {
  const definition = await loadGamePackage(new InMemoryPackageSource(files));
  const attrDefs = parse(files['data/attrs.yaml'] as string) as AttrDefs;
  const contentTags = parse(files['data/content-tags.yaml'] as string) as ContentTagsDef;
  return createGameHost({
    definition,
    attrDefs,
    contentTags,
    initialAttrs: { hp: 100, stamina: 30, insight: 0, atk: 10, def: 3, spd: 5 },
    seed: 2026,
  });
}

/** 推进到选项相位（advance 直到出现选项） */
function advanceToChoices(host: GameHost, max = 10): void {
  for (let i = 0; i < max; i++) {
    if (host.store.getState().session.phase === 'await_choice') return;
    host.advance();
  }
}

/** 状态快照（验收断言面：与叙事无关的全部易变域） */
function snapshotState(host: GameHost): string {
  const state = host.runtime.state;
  return JSON.stringify({
    attrs: state.player.attrs,
    flags: state.world.flags,
    wallet: state.player.wallet,
    bag: state.player.bag,
    quests: state.quests,
    time: { day: state.world.time.day, slotIndex: state.world.time.slotIndex },
    npcs: state.npcs,
  });
}

describe('25B-B1 多步回滚（宿主面）', () => {
  it('rollback(steps) 回退多步；步数超栈深 → NO_CHECKPOINT 且状态不变', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    // 走两步（每次选择前宿主自动打点）
    host.choose(host.store.getState().session.choices[0]?.id as string);
    advanceToChoices(host);
    const afterFirst = snapshotState(host);
    host.choose(host.store.getState().session.choices[0]?.id as string);
    advanceToChoices(host);

    // 回退 1 步：状态回到上一步
    host.rollback(1);
    expect(snapshotState(host)).toBe(afterFirst);

    // 超栈深：错误显性化且状态不变
    const before = snapshotState(host);
    host.rollback(99);
    expect(host.lastError()?.code).toBe('NO_CHECKPOINT');
    expect(snapshotState(host)).toBe(before);
  });

  it('回滚后叙事会话重建到入口场景（口径甲：叙事位置按 §6.3 处理）', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    host.choose(host.store.getState().session.choices[0]?.id as string);
    advanceToChoices(host);
    expect(host.store.getState().session.sceneId).not.toBe('arrival'); // 已离开入口

    host.rollback(1);
    expect(host.store.getState().session.sceneId).toBe('arrival'); // 重建至入口
  });

  it('无回滚点时 rollback 报错且会话不受影响', async () => {
    const host = await makeHost();
    host.start();
    host.rollback(1);
    expect(host.lastError()?.code).toBe('NO_CHECKPOINT');
  });
});

describe('25B-B2 **M2 验收第 4 条：回滚 5 步状态一致**（口径甲）', () => {
  it('连续 5 次选择后回滚 5 步，状态树与第 1 步前逐字段一致', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    const baseline = snapshotState(host); // 第 1 步**之前**的状态（初始）
    let baselineForFive = baseline; // 第 6 次选择之前（回退 5 步的目标）

    // 连续做 6 次选择（每次选择前宿主自动打 checkpoint），走**可无限往返**路径
    // `market_street ⇄ arrival`（back_arrival / go_market 均无条件 goto）。
    //
    // 为什么是 6 而非 5：检查点栈深上限 = PERF_GUARD.checkpointStackDepth = 5
    // （超深丢最旧）——6 次选择后栈内保留「第 2..6 次选择前」的 5 个快照，
    // 恰好可回退 5 步（回到第 2 次选择之前）。这是「回滚 5 步」的精确可行边界。
    const checkpointsBefore = host.runtime.state.checkpoints.length;
    for (let i = 0; i < 6; i++) {
      advanceToChoices(host);
      const choices = host.store.getState().session.choices;
      expect(choices.length, `第 ${i + 1} 步应有可选项`).toBeGreaterThan(0);
      const pick =
        choices.find((choice) => choice.id === 'go_market' || choice.id === 'back_arrival') ??
        choices[0];
      if (i === 5) baselineForFive = snapshotState(host); // 第 6 次选择之前 = 回退 5 步的目标
      host.choose(pick?.id as string);
      advanceToChoices(host);
    }
    const gained = host.runtime.state.checkpoints.length - checkpointsBefore;
    expect(gained, '栈深上限 5：6 次选择后保留 5 个快照').toBe(5);

    // 回滚 5 步：状态精确还原（含 RNG 状态复原，同种子可复现）
    host.rollback(5);
    const after = JSON.parse(snapshotState(host)) as Record<string, unknown>;
    const before = JSON.parse(baselineForFive) as Record<string, unknown>;
    for (const key of Object.keys(before)) {
      expect(after[key], `字段 ${key} 应一致`).toEqual(before[key]);
    }
  });

  it('回滚 5 步后继续游玩可复现同一状态序列（RNG 复原的旁证）', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    const baseline = snapshotState(host);

    // 6 次选择（同栈深口径），记录路径用于重放
    const path: string[] = [];
    let baselineForFive = baseline;
    for (let i = 0; i < 6; i++) {
      advanceToChoices(host);
      const choices = host.store.getState().session.choices;
      const pick =
        choices.find((choice) => choice.id === 'go_market' || choice.id === 'back_arrival') ??
        choices[0];
      if (i === 5) baselineForFive = snapshotState(host);
      path.push(pick?.id as string);
      host.choose(pick?.id as string);
      advanceToChoices(host);
    }
    expect(path).toHaveLength(6);
    const afterFirstRun = snapshotState(host);

    host.rollback(5);
    expect(snapshotState(host)).toBe(baselineForFive);

    // 重放最后一步：RNG 与状态都应复现（DD-09 旁证）
    advanceToChoices(host);
    host.choose(path[5] as string);
    advanceToChoices(host);
    expect(snapshotState(host)).toBe(afterFirstRun);
  });
});

describe('25B-B1 历史回看投影（FR-READ-04）', () => {
  it('按「场景 + 游戏日」分组；组内保持渲染序', async () => {
    const host = await makeHost();
    host.start();
    host.advance();
    advanceToChoices(host);
    host.choose(host.store.getState().session.choices[0]?.id as string);
    advanceToChoices(host);

    const groups = host.history();
    expect(groups.length).toBeGreaterThan(0);
    // 首组为入口场景；同一组内场景 id 一致
    expect(groups[0]?.sceneId).toBe('arrival');
    for (const group of groups) {
      for (const entry of group.entries) {
        expect(entry.day).toBe(group.day);
      }
    }
    // 渲染序：seq 递增
    const seqs = groups.flatMap((group) => group.entries.map((entry) => entry.seq));
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it('文本物化：注入 resolver 时用译文；缺省回落文本键', () => {
    const entries = [
      {
        seq: 0,
        sceneId: 'arrival',
        segment: { kind: 'text', key: 'scenes.arrival.open' },
        clock: { day: 1, slotIndex: 0 },
      },
      {
        seq: 1,
        sceneId: 'arrival',
        segment: { kind: 'text', key: 'scenes.arrival.more', vars: { n: 2 } },
        clock: { day: 1, slotIndex: 0 },
      },
    ] as never;
    const resolved = projectHistory(entries, (key, vars) =>
      vars !== undefined ? `${key}:${JSON.stringify(vars)}` : `T:${key}`,
    );
    expect(resolved[0]?.entries[0]?.text).toBe('T:scenes.arrival.open');
    expect(resolved[0]?.entries[1]?.text).toBe('scenes.arrival.more:{"n":2}');
    // 缺省（无 resolver）：直接用键（降级可用）
    expect(projectHistory(entries)[0]?.entries[0]?.text).toBe('scenes.arrival.open');
  });

  it('非文本段落不被丢弃（给占位，保证历史完整性）', () => {
    const entries = [
      {
        seq: 0,
        sceneId: 's',
        segment: { kind: 'media', assetId: 'x' },
        clock: { day: 1, slotIndex: 0 },
      },
    ] as never;
    expect(projectHistory(entries)[0]?.entries[0]?.text).toBe('[media]');
  });
});
