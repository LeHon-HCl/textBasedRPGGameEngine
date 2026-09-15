import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { AttrDefs, ContentTagsDef } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import type { GameDefinition } from '@game/engine';
import { checkHostWiring } from '../../src/app/wiring-check.js';
import { createGameHost } from '../../src/app/game-host.js';

/**
 * 宿主接线自检（develop.md 约束 8「宿主接线完整性」；2026-09-15 新增）。
 *
 * 背景：引擎能力多为「可选注入、缺省静默」——包内有 `data/events.yaml`、宿主却
 * 未配 `eventEval` 时，引擎不报错、测试不红、加载诊断干净，但功能整块失效
 * （M1 收尾实测：10 条事件零触发，见 `docs/retros/content-integrity-postmortem.md`）。
 *
 * 本文件钉死自检的**双向**语义：
 * 1. 包内有数据 + 未接线 → 报缺口（不漏报）；
 * 2. 包内无数据 + 未接线 → 不报（不误报——不是「所有能力都必须接线」）；
 * 3. 宿主装配后 `wiringWarnings()` 可读（调试面板与 E2E 的断言面）。
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
const ALL_WIRED = {
  eventEval: true,
  statusTick: true,
  npcSchedule: true,
  questDeadline: true,
  bodyRevert: true,
} as const;

async function loadDef(): Promise<GameDefinition> {
  return loadGamePackage(new InMemoryPackageSource(files));
}

describe('宿主接线自检（约束 8）', () => {
  it('包内有事件但未接 eventEval → 报缺口（含事件数）', async () => {
    const definition = await loadDef();
    const warnings = checkHostWiring(definition, { ...ALL_WIRED, eventEval: false });
    const gap = warnings.find((w) => w.capability === 'eventEval');
    expect(gap).toBeDefined();
    expect(gap?.code).toBe('host-wiring-gap');
    expect(gap?.dataDomain).toBe('events');
    expect(gap?.detail).toContain(String(definition.events.length));
  });

  it('包内有带日程的 NPC 但未接 npcSchedule → 报缺口', async () => {
    const definition = await loadDef();
    const warnings = checkHostWiring(definition, { ...ALL_WIRED, npcSchedule: false });
    expect(warnings.some((w) => w.capability === 'npcSchedule')).toBe(true);
  });

  it('包内有带 failWhen 的任务但未接 questDeadline → 报缺口', async () => {
    const definition = await loadDef();
    const warnings = checkHostWiring(definition, { ...ALL_WIRED, questDeadline: false });
    expect(warnings.some((w) => w.capability === 'questDeadline')).toBe(true);
  });

  it('无事件的包 + 未接 eventEval → 不报（不误报：不是「能力必须全接」）', async () => {
    const definition = await loadDef();
    const noEvents = { ...definition, events: [] };
    const warnings = checkHostWiring(noEvents, { ...ALL_WIRED, eventEval: false });
    expect(warnings.some((w) => w.capability === 'eventEval')).toBe(false);
  });

  it('全部接线（除 bodyRevert）→ 无缺口（夹具与宿主能力匹配）', async () => {
    const definition = await loadDef();
    const warnings = checkHostWiring(definition, ALL_WIRED);
    expect(warnings).toEqual([]);
  });

  it('宿主装配后 wiringWarnings() 可读且为空（当前夹具已全接）', async () => {
    const definition = await loadDef();
    const attrDefs = parse(files['data/attrs.yaml'] as string) as AttrDefs;
    const contentTags = parse(files['data/content-tags.yaml'] as string) as ContentTagsDef;
    const host = createGameHost({ definition, attrDefs, contentTags, seed: 2026 });
    host.start();
    expect(host.wiringWarnings()).toEqual([]);
  });
});
