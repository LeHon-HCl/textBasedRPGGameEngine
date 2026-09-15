import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { InMemoryPackageSource } from '../../src/loader/source-memory.js';
import { loadGamePackage } from '../../src/loader/pipeline.js';
import { EngineError } from '@game/shared';

/**
 * 加载期指令参数语义校验（develop.md 约束 8；设计 §7.7 `invalid-instruction-arg`）。
 *
 * 背景：`set { key: 'npc.ferryman.met' }` 这类非法 key 形态此前只在运行期
 * （指令 execute）校验——包加载零诊断通过、玩家点到该选项才抛 EFFECT_FAILED
 * （M1 收尾实测：渡口搭话选项卡死，见 `docs/retros/content-integrity-postmortem.md`）。
 *
 * 本步骤（管线 6.5）在 scripts 之后、freeze 之前跑各指令的 `validateArg` 钩子，
 * 把该判定前移到**加载期**。本文件钉死：
 * 1. 非法 key 形态 → 加载失败（SCHEMA_INVALID，where.rule = invalid-instruction-arg）；
 * 2. 合法形态（含 npc.<id>.flags.<名>）→ 加载通过；
 * 3. 诊断带数据路径定位（编辑器可跳转）。
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

/** 在镇口场景注入一条自定义效果（用于构造非法/合法 key 两种包） */
function withInjectedEffect(effectYaml: string): Record<string, string> {
  const clone = { ...files };
  const path = 'data/scenes/old_town/town_gate.yaml';
  const scene = clone[path] as string;
  const injected = scene.replace(
    "      - add: { key: 'attr.insight', amount: 2 }",
    `      - ${effectYaml}`,
  );
  if (injected === scene) throw new Error('注入锚点未命中（夹具已变，需同步测试）');
  clone[path] = injected;
  return clone;
}

describe('加载期指令参数语义校验（约束 8）', () => {
  it('非法 key 形态（npc.<id>.met）→ 加载失败且诊断为 invalid-instruction-arg', async () => {
    const source = new InMemoryPackageSource(
      withInjectedEffect("set: { key: 'npc.ferryman.met', value: true }"),
    );
    let caught: unknown;
    try {
      await loadGamePackage(source);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EngineError);
    const engineError = caught as EngineError;
    expect(engineError.code).toBe('SCHEMA_INVALID');
    // 规则 id 与数据路径定位（编辑器诊断列表可直接跳转）
    expect(engineError.where['rule']).toBe('invalid-instruction-arg');
    expect(engineError.where['instruction']).toBe('set');
    expect(engineError.where['from']).toContain('scenes[town_gate]');
  });

  it('合法形态 npc.<id>.flags.<名> → 加载通过（校验不过度收紧）', async () => {
    const source = new InMemoryPackageSource(
      withInjectedEffect("set: { key: 'npc.ferryman.flags.greeted', value: true }"),
    );
    const definition = await loadGamePackage(source);
    expect(definition.manifest.gameId).toBe('mini_game');
  });

  it('合法形态 attr/flag/counter → 加载通过', async () => {
    for (const key of ['attr.insight', 'flag.some_flag', 'counter.some_count']) {
      const source = new InMemoryPackageSource(
        withInjectedEffect(`set: { key: '${key}', value: 1 }`),
      );
      const definition = await loadGamePackage(source);
      expect(definition.manifest.gameId).toBe('mini_game');
    }
  });

  it('未知 key 域（world.foo）→ 加载失败（同一规则）', async () => {
    const source = new InMemoryPackageSource(
      withInjectedEffect("set: { key: 'world.rent_due', value: 1 }"),
    );
    await expect(loadGamePackage(source)).rejects.toThrow(EngineError);
  });
});
