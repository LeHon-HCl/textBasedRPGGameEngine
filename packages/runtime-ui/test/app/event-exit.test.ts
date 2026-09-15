import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { AttrDefs, ContentTagsDef } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import { createGameHost } from '../../src/app/game-host.js';
import type { GameHost } from '../../src/app/game-host.js';

const ROOT = 'fixtures/mini-game';

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => `${e.parentPath.replaceAll('\\', '/')}/${e.name}`);
}

function readPackage(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const abs of listFiles(ROOT)) {
    files[abs.slice(abs.indexOf(ROOT) + ROOT.length + 1)] = readFileSync(abs, 'utf8');
  }
  return files;
}

const files = readPackage();

async function makeHost(): Promise<GameHost> {
  const definition = await loadGamePackage(new InMemoryPackageSource(files));
  const attrDefs = parse(files['data/attrs.yaml'] as string) as AttrDefs;
  const contentTags = parse(files['data/content-tags.yaml'] as string) as ContentTagsDef;
  const host = createGameHost({
    definition,
    attrDefs,
    contentTags,
    initialAttrs: { hp: 100, stamina: 30, insight: 0 },
    seed: 2026,
  });
  host.start();
  return host;
}

function drain(host: GameHost, max = 12): void {
  for (let i = 0; i < max; i += 1) {
    if (host.store.getState().session.phase !== 'await_advance') break;
    host.advance();
  }
}

/** 反复移动直到进入任一事件场景（随机事件窗口命中） */
function enterEventScene(host: GameHost, max = 60): string {
  let scene = host.store.getState().session.sceneId;
  for (let i = 0; i < max && !scene.startsWith('ev_'); i += 1) {
    host.moveTo({ area: 'old_town', location: 'gate' });
    host.moveTo({ area: 'old_town', location: 'market' });
    scene = host.store.getState().session.sceneId;
  }
  return scene;
}

describe('事件场景可退出（约束 7 C7 的运行时验证）', () => {
  it('集市闲谈事件：选 listen_closely 后 back 弹栈回到主会话场景', async () => {
    const host = await makeHost();
    drain(host);
    host.choose('go_market');
    drain(host);
    host.choose('listen_rumor');
    drain(host);
    const scene = enterEventScene(host);
    expect(scene, '未能进入事件场景（随机窗口未命中）').toMatch(/^ev_/);
    drain(host);

    const before = host.store.getState().session.sceneId;
    const choices = host.store.getState().session.choices;
    const firstChoice = choices.find((choice) => choice.hiddenByFilter !== true);
    expect(firstChoice, '事件场景应至少有一个可见选项').toBeDefined();
    if (firstChoice === undefined) return; // 类型收窄（上一行的断言已保证）
    host.choose(firstChoice.id);
    drain(host);

    const after = host.store.getState().session;
    // 退出证据一：不再停留在事件场景
    expect(after.sceneId).not.toBe(before);
    expect(after.sceneId.startsWith('ev_')).toBe(false);
    // 退出证据二：无错误（EFFECT_FAILED 会让会话卡在 resolving）
    expect(host.lastError()).toBeNull();
    // 退出证据三：回到了**可交互的主会话场景**（挂起栈顶，即事件触发时所在场景）
    // ——本用例的移动序列使事件在 town_gate→market 的移动中触发，
    // 故主会话帧为 town_gate（点击事件选项前玩家所在处）。
    expect(after.phase).toBe('await_choice');
    expect(after.sceneId).toBe('town_gate');
  });

  it('渡口搭话：遇见 flag 必落地（不与可失败的接取同事务）', async () => {
    const host = await makeHost();
    drain(host);
    host.choose('go_gate');
    drain(host);
    host.choose('go_riverside');
    drain(host);
    expect(host.store.getState().session.sceneId).toBe('riverside_ferry');

    // 初始 insight=0：搭话只置「已遇见」，不得因接取任务失败而回滚
    host.choose('talk_ferryman');
    expect(host.lastError(), `搭话失败：${host.lastError()?.detail ?? ''}`).toBeNull();
    expect(host.runtime.state.world.flags['ferryman_met']).toBe(true);
    // 不满足 acceptIf/requires 时，接取选项**不可见**（避免点了必失败的选项）。
    // 注意：会话投影含 hiddenByFilter 条目（UI 层过滤），故这里只看可见项。
    const visible = host.store
      .getState()
      .session.choices.filter((choice) => choice.hiddenByFilter !== true)
      .map((choice) => choice.id);
    expect(visible).toContain('ask_ferry');
    expect(visible).not.toContain('accept_survey');
    expect(visible).not.toContain('talk_ferryman');
  });

  it('事件场景的每个选项都能离开（穷举 10 条事件的场景）', async () => {
    const definition = await loadGamePackage(new InMemoryPackageSource(files));
    const evSceneIds = [...new Set(definition.events.map((e) => e.scene))];
    for (const sceneId of evSceneIds) {
      const scene = definition.scenes.get(sceneId);
      expect(scene, `事件场景缺失：${sceneId}`).toBeDefined();
      if (scene === undefined) continue; // 类型收窄（上一行的断言已保证）
      // 至少一个无条件出口（与 C7 静态检同口径，这里断言加载产物）
      const hasUnconditional = (
        scene.def.choices as { goto?: string; showIf?: string; effects?: unknown[] }[]
      ).some(
        (choice) =>
          choice.showIf === undefined &&
          (choice.goto !== undefined ||
            (choice.effects ?? []).some((effect) => {
              if (typeof effect !== 'object' || effect === null) return false;
              const record = effect as Record<string, unknown>;
              return (
                'goto' in record ||
                'back' in record ||
                'ending' in record ||
                'loop_transition' in record
              );
            })),
      );
      expect(hasUnconditional, `${sceneId} 无无条件出口`).toBe(true);
    }
  });
});
