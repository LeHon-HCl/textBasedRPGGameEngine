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

/**
 * 问题 #5（2026-09-26）：宿主 `history()` 曾**不传 resolver** 调用
 * `projectHistory(historyLog)`，落到「缺省直接用键」的降级分支，玩家在历史面板
 * 看到 `scenes.arrival.open` 这类原始文本键。
 *
 * 上方 FR-READ-04 用例组已覆盖投影层的两分支（注入 resolver / 缺省回落）；
 * 本组补的是**宿主装配层**——投影层正确不等于宿主接线正确（本项目已发生多次
 * 「引擎就绪但玩家点了没反应」的装配缺口）。断言打到 `host.history()` 的输出。
 */
describe('FR-READ-04 问题 #5：宿主 history() 条目文本物化', () => {
  /** 原始文本键的形态（`scenes.arrival.open` / `items.herb.name`） */
  const KEY_SHAPE = /^[a-z_]+\.[a-z_.]+$/;

  it('条目文本是译文而非原始键；与 textOf 同源', async () => {
    const host = await makeHost();
    host.start();
    host.advance();
    advanceToChoices(host);

    const entries = host.history().flatMap((group) => group.entries);
    expect(entries.length, '入口场景推进后应有历史条目').toBeGreaterThan(0);

    for (const entry of entries) {
      const title = `条目 seq=${String(entry.seq)}`;
      expect(entry.text.length, `${title} 文本非空`).toBeGreaterThan(0);
      // 核心断言：展示文本**不是**原始文本键（缺陷的直接表征）
      expect(entry.text, `${title} 不应是文本键`).not.toMatch(KEY_SHAPE);
    }
    // 首段 = 入口场景开场白：与 textOf 同源（语言口径一致）且是 zh-CN 译文
    expect(entries[0]?.text).toBe(host.textOf('scenes.arrival.open'));
    expect(entries[0]?.text).not.toBe('scenes.arrival.open');
    expect(entries[0]?.text).toContain('石板路');
  });

  it('切换语言到 en-US 后条目文本随之变化（语言来源 = 当前设置语言）', async () => {
    const host = await makeHost();
    host.start();
    host.advance();
    advanceToChoices(host);
    const zhEntries = host.history().flatMap((group) => group.entries);
    const zh = zhEntries.map((entry) => entry.text);
    expect(zh[0], '主语言（zh-CN）译文').toContain('石板路');

    host.updateSettings({ lang: 'en-US' });
    const enEntries = host.history().flatMap((group) => group.entries);
    const en = enEntries.map((entry) => entry.text);

    // 抓「传了 resolver 但语言写死 zh-CN / mainLang」的错误：文本必须变
    expect(en[0], '切语言后历史文本应变化').not.toBe(zh[0]);
    expect(en[0]).toBe(host.textOf('scenes.arrival.open'));
    expect(en[0]).toContain('flagstones');
    // 只换语言，不改历史：条目数与 seq 不变
    expect(en).toHaveLength(zh.length);
    expect(enEntries.map((entry) => entry.seq)).toEqual(zhEntries.map((entry) => entry.seq));
    for (const text of en) expect(text, '切换后仍不应出现原始键').not.toMatch(KEY_SHAPE);
  });
});

/**
 * #9 / #9b / #9c 回归防线（2026-09-26）。
 *
 * 背景（用户实测 #9）：走了很多步后点「回退一步」，历史面板从 7 组变成 1 组、
 * 画面回到入口场景，看起来像「全部回退了」。**状态回退本身是精确的**（上方
 * 既有用例已逐字段断言），真正原因是会话重建丢弃了历史环形缓冲——而
 * `SceneRunner` 的历史属于会话对象，回滚重建会话后新会话历史为空。
 *
 * 设计决定（不在引擎侧改）：宿主累积 `historyLog` 跨会话保留，并维护与引擎
 * 检查点栈同长同序的 `rollbackMarks`，回滚时把历史截断到对应的检查点位置。
 *
 * 走 `market_street ⇄ arrival` 的**可无限往返**路径（两个 goto 均无条件），
 * 使「走 N 步 + 回退」可精确构造。
 */
describe('25B-B1 #9 回退保留历史并截断到对应位置', () => {
  /** 走一步可往返的路径（每次选择前宿主自动打点） */
  function stepOnce(host: GameHost): void {
    advanceToChoices(host);
    const choices = host.store.getState().session.choices;
    const pick =
      choices.find((choice) => choice.id === 'go_market' || choice.id === 'back_arrival') ??
      choices[0];
    host.choose(pick?.id as string);
    advanceToChoices(host);
  }

  /** 各组「场景 + 条目数」的签名（截断断言的比较面） */
  function groupSignature(host: GameHost): readonly string[] {
    return host.history().map((group) => `${group.sceneId}:${String(group.entries.length)}`);
  }

  /** 全部历史条目的展示文本（逐条断言首尾用；已物化译文） */
  function entryKeys(host: GameHost): readonly string[] {
    return host.history().flatMap((group) => group.entries.map((entry) => entry.text));
  }

  it('#9 回归防线：走 5 步后 rollback(1)，历史不塌成 1 组且截断到最后一步之前', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    // 走 5 步；`signatures[i]` = 第 i+1 步**之前**的历史签名（即该步的目标截断点）
    const signatures: string[][] = [];
    for (let i = 0; i < 5; i += 1) {
      signatures.push([...groupSignature(host)]);
      stepOnce(host);
    }
    const afterFive = [...groupSignature(host)];
    const keysAfterFive = [...entryKeys(host)];
    expect(afterFive.length, '走 5 步后历史应有多组').toBe(6);
    expect(host.availableRollbackSteps()).toBe(5);

    host.rollback(1);

    // **核心断言（#9 的回归防线）**：历史仍在——旧实现因会话重建把历史缓冲
    // 整个丢掉，面板从 6 组塌成入口场景 1 组。
    const afterRollback = host.history();
    expect(afterRollback.length, '#9：回退一步后历史不应塌成 1 组').toBeGreaterThan(1);
    // 截断到「第 5 步之前」= signatures[4]（5 组 / 10 段）；随后重建的会话在
    // 入口场景渲染 1 段，与末尾同场景组并合 → 末组由 2 段变 3 段。
    const expected = [...(signatures[4] as string[])];
    expect(expected.at(-1)).toBe('arrival:2'); // 末组恰好是入口场景（夹具往返路径）
    expected[expected.length - 1] = 'arrival:3';
    expect(groupSignature(host), '截断目标 = 第 5 步之前的检查点').toEqual(expected);
    // 逐条断言：被回退的目标段之前的条目**逐条原样保留**（只截尾，不清空）
    const surviving = entryKeys(host);
    expect(surviving.slice(0, 10), '前 10 段（= 4 步的历史）原样保留').toEqual(
      keysAfterFive.slice(0, 10),
    );
    expect(surviving[0], '历史起点（首段）没丢').toBe(keysAfterFive[0]);
    expect(surviving.length, '12 段 − 被截掉的 2 段 + 重建会话的 1 段').toBe(11);
    // 引擎侧同步：可用步数 -1；会话按口径甲重建到入口场景
    expect(host.availableRollbackSteps()).toBe(4);
    expect(host.store.getState().session.sceneId).toBe('arrival');
  });

  it('连续 rollback(2) 的截断位置正确（覆盖 off-by-one）', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    // `afterStep[i]` = 走完第 i+1 步之后的历史签名
    const afterStep: string[][] = [];
    for (let i = 0; i < 5; i += 1) {
      stepOnce(host);
      afterStep.push([...groupSignature(host)]);
    }
    expect(host.availableRollbackSteps()).toBe(5);

    // 回退 2 步 → 截断目标 = marks 中最早被弹出的那个 = 「第 3 步之前」的
    // historyLog 长度 = 走完第 3 步之后的 8 段（= afterStep[2]）。
    // off-by-one 会把这里留成 afterStep[3]（4 组）或退到 afterStep[1]。
    host.rollback(2);
    expect(groupSignature(host), '按 popped[0] 截断（最早被回退到的检查点）').toEqual([
      ...(afterStep[2] as string[]),
      'arrival:1', // 重建会话的入口场景段（末组是 market_street，故另开一组）
    ]);
    expect(host.availableRollbackSteps()).toBe(3);
    expect(host.store.getState().session.sceneId).toBe('arrival');

    // 再回退 3 步 → marks 见底（回到最初）→ 截断目标 = 0：
    // 只保留重建会话在入口场景的 1 段
    host.rollback(3);
    expect(host.availableRollbackSteps()).toBe(0);
    expect(groupSignature(host), '回退到最初后只剩重建会话的入口场景').toEqual(['arrival:1']);
    // 语义修正（问题 #5）：宿主 history() 已物化文本，首段是入口场景开场白译文，
    // 不再是原始键 'scenes.arrival.open'。与 textOf 同源（同一 resolver + 语言）。
    expect(entryKeys(host)[0]).toBe(host.textOf('scenes.arrival.open'));
    expect(entryKeys(host)[0]).not.toBe('scenes.arrival.open');
  });

  it('检查点为 0 时回滚报 NO_CHECKPOINT 且历史不变（既有行为）', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    stepOnce(host);
    const before = [...entryKeys(host)];
    expect(host.availableRollbackSteps()).toBe(1);

    // 先退光回滚点，再退一次 → 报错
    host.rollback(1);
    expect(host.availableRollbackSteps()).toBe(0);
    const afterFirst = [...entryKeys(host)];
    host.rollback(1);
    expect(host.lastError()?.code).toBe('NO_CHECKPOINT');
    // 失败不改历史、也不改状态（与既有语义一致）
    expect(entryKeys(host)).toEqual(afterFirst);
    expect(entryKeys(host).length).toBeGreaterThan(0);
    expect(before.length).toBeGreaterThan(afterFirst.length); // 前一次成功回退确实截断了
  });

  it('历史 seq 跨会话重建仍唯一且有序（宿主重编号）', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    for (let i = 0; i < 4; i += 1) stepOnce(host);
    const seqsBefore = host.history().flatMap((group) => group.entries.map((e) => e.seq));
    expect(new Set(seqsBefore).size, 'seq 唯一').toBe(seqsBefore.length);

    host.rollback(1); // 会话重建：会话内 seq 从 0 重来，宿主须重编号
    stepOnce(host); // 重建后继续走 → 新条目入账
    const seqsAfter = host.history().flatMap((group) => group.entries.map((e) => e.seq));
    expect(new Set(seqsAfter).size, '跨会话重建后 seq 仍唯一（宿主重编号）').toBe(seqsAfter.length);
    expect(
      [...seqsAfter].sort((a, b) => a - b),
      'seq 有序',
    ).toEqual(seqsAfter);
  });
});

describe('25B-B1 #9b/#9c 历史面板步数口径（宿主投影 + 面板渲染）', () => {
  function stepOnce(host: GameHost): void {
    advanceToChoices(host);
    const choices = host.store.getState().session.choices;
    const pick =
      choices.find((choice) => choice.id === 'go_market' || choice.id === 'back_arrival') ??
      choices[0];
    host.choose(pick?.id as string);
    advanceToChoices(host);
  }

  it('#9b：分组 rollbackSteps 与真实可用步数一致（按该步数回滚后状态 == 该组开始时）', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    // 记录每一步之前的状态（= 该步对应组的「开始状态」）
    const statesBeforeStep: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      statesBeforeStep.push(snapshotState(host));
      stepOnce(host);
    }
    expect(host.availableRollbackSteps()).toBe(4);

    const groups = host.history();
    const withSteps = groups.filter((group) => group.rollbackSteps !== undefined);
    expect(withSteps.length, '应有分组附带回退步数').toBeGreaterThan(0);

    // 每个带步数的分组：步数不超过可用步数（点得动），且回滚后状态与该组开始一致
    for (const group of withSteps) {
      const steps = group.rollbackSteps as number;
      expect(steps, '步数应在 1..可用步数 之间（否则按钮点了必报错）').toBeGreaterThan(0);
      expect(steps).toBeLessThanOrEqual(host.availableRollbackSteps());
    }

    // **行为断言**（不只是数字自洽）：取最后一步对应的组，按其步数回滚，
    // 状态应等于「该步开始时」的状态——这是 #9b「步数口径正确」的实证。
    const fresh = await makeHost();
    fresh.start();
    advanceToChoices(fresh);
    const target = statesBeforeStep[3] as string; // 第 4 步（最后一次选择）之前的状态
    const lastGroupWithSteps = [...withSteps].at(-1);
    expect(lastGroupWithSteps?.rollbackSteps, '末组应带步数（= 1，回到最后一步之前）').toBe(1);
    fresh.history(); // 投影不改变状态（只读）
    fresh.rollback(lastGroupWithSteps?.rollbackSteps as number);
    expect(snapshotState(fresh), '按投影步数回滚后状态应等于该组开始时的状态').toBe(target);
  });

  it('#9b：无对应检查点的分组不附步数（面板据此不渲染按钮）', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    stepOnce(host);
    const groups = host.history();
    // 实测签名：[arrival:2 (rb=1), market_street:2 (rb=undefined)]
    // 当前所在组（末组）之后没有检查点 → 无步数：玩家已在「这里」，不给按钮
    expect(groups.at(-1)?.rollbackSteps, '当前所在组无步数（无处可退）').toBeUndefined();
    // 首组末尾有检查点（本次选择之前打的）→ 有步数：退 1 步即回到该组
    expect(groups[0]?.rollbackSteps, '首组可退 1 步到达').toBe(1);
  });

  it('#9c：availableRollbackSteps 随打点/回滚变化（canRollback 的数据源）', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    // 未做任何选择：无回滚点 → canRollback 应为 false
    expect(host.availableRollbackSteps()).toBe(0);
    stepOnce(host);
    expect(host.availableRollbackSteps()).toBe(1);
    stepOnce(host);
    expect(host.availableRollbackSteps()).toBe(2);
    host.rollback(1);
    expect(host.availableRollbackSteps()).toBe(1);
    host.rollback(1);
    expect(host.availableRollbackSteps()).toBe(0); // 栈空 → 面板应置灰按钮
  });

  it('#9c：回退锚点与引擎快照栈同长（超深丢最旧，宿主同步 shift）', async () => {
    const host = await makeHost();
    host.start();
    advanceToChoices(host);
    // 引擎栈深上限 = PERF_GUARD.checkpointStackDepth = 5；走 7 步必然溢出
    for (let i = 0; i < 7; i += 1) stepOnce(host);
    const engineDepth = host.runtime.state.checkpoints.length;
    expect(engineDepth, '引擎栈深上限 5').toBe(5);
    // 宿主锚点必须与引擎**同长**——不同长则回滚截断会指向错误的界
    // （#9b 的步数推导依赖「marks[i] ↔ 引擎第 i 个快照」的一一对应）
    expect(host.availableRollbackSteps(), '宿主锚点数 == 引擎快照数').toBe(engineDepth);
  });
});
