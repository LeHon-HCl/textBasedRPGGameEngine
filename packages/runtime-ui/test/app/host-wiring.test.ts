import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import type { AttrDefs, ContentTagsDef } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import { createGameHost } from '../../src/app/game-host.js';
import type { GameHost } from '../../src/app/game-host.js';

/**
 * 宿主接线完整性（develop.md 约束 8；2026-09-15 新增）。
 *
 * 背景：包内有 `data/events.yaml`（10 条事件）却因宿主未配置时间管线的
 * `eventEval` 步骤、未向效果注册表注入 `eventPool`、且丢弃了管线产出的事件跳转，
 * 导致**事件零触发**——而全量测试与加载器诊断全绿
 * （见 `docs/retros/content-integrity-postmortem.md`）。
 *
 * 本文件钉死「接线完备」的契约（端到端可观察结果，而非「元素存在」）：
 * 1. 事件池已注入：驱动事件评估不报「未注入 eventPool」；
 * 2. 事件跳转回流：时间推进产出的 jumps 被注入会话，事件场景可播放；
 * 3. 向后兼容：包内无事件时接线不改变既有行为。
 */

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

async function makeHost(
  mutate?: (r: Record<string, string>) => Record<string, string>,
): Promise<GameHost> {
  const source = mutate === undefined ? files : mutate({ ...files });
  const definition = await loadGamePackage(new InMemoryPackageSource(source));
  const attrDefs = parse(source['data/attrs.yaml'] as string) as AttrDefs;
  const contentTags = parse(source['data/content-tags.yaml'] as string) as ContentTagsDef;
  return createGameHost({
    definition,
    attrDefs,
    contentTags,
    initialAttrs: { hp: 100, stamina: 30, insight: 0 },
    initialWallet: { town_silver: 20 },
    seed: 2026,
  });
}

describe('宿主接线完整性：事件系统（约束 8）', () => {
  it('事件池已注入：直接驱动评估不报「未注入 eventPool」', async () => {
    const host = await makeHost();
    host.start();
    // 内部指令名含点，用计算属性构造后转型（作者面 schema 不认 `__` 前缀，
    // 这里模拟时间管线的调用路径）。
    const instruction = { ['__events.eval']: {} } as unknown as never;
    const outcome = host.runtime.exec([instruction], {
      source: 'debug',
      where: {},
      rng: host.runtime.rng,
    });
    expect(outcome).toBeDefined();
    // 注入成功的关键信号：错误不是 error.events.pool
    const err = host.lastError();
    expect(err?.messageKey ?? '').not.toBe('error.events.pool');
  });

  it('事件跳转回流：推进时间触发条件型事件后，会话进入事件场景', async () => {
    // 构造最小可触发条件：把 ev_wall_whisper 的 require 改成恒真、去掉时段窗口
    // （其余保持真实数据），验证「事件评估 → 跳转 → 会话进入事件场景」全链路。
    const host = await makeHost((r) => {
      const events = parse(r['data/events.yaml'] as string) as Array<Record<string, unknown>>;
      const wall = events.find((e) => e['id'] === 'ev_wall_whisper');
      if (wall !== undefined) {
        wall['when'] = {};
        wall['trigger'] = { type: 'condition', require: 'attr.insight >= 0' };
      }
      r['data/events.yaml'] = stringify(events);
      return r;
    });
    host.start();
    // 进入镇口（事件作用域 old_town/gate）——moveTo 会推进 1 个时段，
    // 触发管线步骤 6 的事件评估，其跳转经 applyFlowJumps 注入会话。
    host.moveTo({ area: 'old_town', location: 'gate' });
    const s = host.store.getState().session;
    console.log(
      'AFTER_MOVE scene=' +
        s.sceneId +
        ' phase=' +
        s.phase +
        ' err=' +
        JSON.stringify(host.lastError()),
    );
    // 事件场景作为子会话进入（ev_wall_whisper_scene）
    expect(s.sceneId).toBe('ev_wall_whisper_scene');
    expect(host.lastError()).toBeNull();
  });

  it('向后兼容：包内无事件时接线不改变既有会话行为', async () => {
    const definition = await loadGamePackage(new InMemoryPackageSource(files));
    const emptyDef = { ...definition, events: [] };
    const attrDefs = parse(files['data/attrs.yaml'] as string) as AttrDefs;
    const contentTags = parse(files['data/content-tags.yaml'] as string) as ContentTagsDef;
    const host = createGameHost({
      definition: emptyDef,
      attrDefs,
      contentTags,
      initialAttrs: { hp: 100, stamina: 30, insight: 0 },
      seed: 2026,
    });
    host.start();
    host.advance();
    expect(host.store.getState().session.sceneId).toBe('arrival');
    expect(host.lastError()).toBeNull();
  });
});
