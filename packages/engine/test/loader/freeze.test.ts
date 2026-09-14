import { describe, expect, it } from 'vitest';
import { EngineError, manifestSchema } from '@game/shared';
import { createBuiltinEffectRegistry } from '../../src/effects/index.js';
import { buildGameDefinition, deepFreeze } from '../../src/loader/freeze.js';
import { loadFixture } from './fixtures.js';
import type { Diagnostic, GameDefinition } from '../../src/loader/types.js';
import type { CompiledArtifacts, ValidatedPackage } from '../../src/loader/types.js';
import type { ScriptStepResult } from '../../src/loader/scripts.js';

/**
 * freeze 步骤用例（06 任务 B4，设计 §3.4 步骤 7「GameDefinition 全部字段
 * Object.freeze（运行期不可变）」）。
 *
 * 断言口径：
 * - 加载产物从顶层字段到嵌套数据全部 Object.isFrozen（普通对象 / 数组 /
 *   Map / Set 的实例与内容）；
 * - 严格模式下对冻结普通对象 / 数组的变异尝试抛 TypeError——运行期
 *   （SceneRunner / 事件系统等）无法篡改包数据；
 * - Map / Set 实例冻结后 set/add 仍可调用是 JS 语义限制（freeze.ts TSDoc
 *   已声明），不可变性保证落在「实例冻结 + 内容数据冻结」；
 * - diagnostics 仅保留 warning 级（error 已在管线步骤边界阻断）。
 */

function expectAllFrozen(definition: GameDefinition): void {
  // —— 顶层字段 ——
  expect(Object.isFrozen(definition)).toBe(true);
  expect(Object.isFrozen(definition.manifest)).toBe(true);
  expect(Object.isFrozen(definition.scenes)).toBe(true);
  expect(Object.isFrozen(definition.areas)).toBe(true);
  expect(Object.isFrozen(definition.events)).toBe(true);
  expect(Object.isFrozen(definition.poolIndex)).toBe(true);
  expect(Object.isFrozen(definition.exprCache)).toBe(true);
  expect(Object.isFrozen(definition.functionRegistry)).toBe(true);
  expect(Object.isFrozen(definition.mediaCatalog)).toBe(true);
  expect(Object.isFrozen(definition.locales)).toBe(true);
  expect(Object.isFrozen(definition.redirects)).toBe(true);
  expect(Object.isFrozen(definition.diagnostics)).toBe(true);
  expect(definition.effectRegistry.frozen).toBe(true);

  // —— 场景（DD-02 聚合产物：CompiledScene + SceneDef + 段落/选项） ——
  for (const scene of definition.scenes.values()) {
    expect(Object.isFrozen(scene)).toBe(true);
    expect(Object.isFrozen(scene.def)).toBe(true);
    expect(Object.isFrozen(scene.def.segments)).toBe(true);
    expect(Object.isFrozen(scene.def.choices)).toBe(true);
    for (const segment of scene.def.segments) expect(Object.isFrozen(segment)).toBe(true);
    for (const choice of scene.def.choices) expect(Object.isFrozen(choice)).toBe(true);
  }

  // —— 区域（含 locations 记录与地点定义） ——
  for (const area of definition.areas.values()) {
    expect(Object.isFrozen(area)).toBe(true);
    expect(Object.isFrozen(area.locations)).toBe(true);
    for (const location of Object.values(area.locations)) {
      expect(Object.isFrozen(location)).toBe(true);
    }
  }

  // —— 事件池索引（byScope 桶 / 反查表 Set / 互斥组） ——
  const { byScope, dirtyMap, mutexGroups, questRefs, achievementRefs } = definition.poolIndex;
  for (const bucket of byScope.values()) {
    expect(Object.isFrozen(bucket)).toBe(true);
    for (const event of bucket) expect(Object.isFrozen(event)).toBe(true);
  }
  for (const set of dirtyMap.values()) expect(Object.isFrozen(set)).toBe(true);
  for (const set of questRefs.values()) expect(Object.isFrozen(set)).toBe(true);
  for (const set of achievementRefs.values()) expect(Object.isFrozen(set)).toBe(true);
  for (const members of mutexGroups.values()) expect(Object.isFrozen(members)).toBe(true);

  // —— 表达式缓存（CompiledExpr + AST 节点） ——
  for (const compiled of definition.exprCache.values()) {
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled.ast)).toBe(true);
  }

  // —— 函数注册表（内置 20 + 脚本扩展） ——
  for (const def of definition.functionRegistry.values()) {
    expect(Object.isFrozen(def)).toBe(true);
  }

  // —— 语言包（Record<Lang, LocalePack> + 键级 Map） ——
  for (const pack of Object.values(definition.locales)) {
    expect(Object.isFrozen(pack)).toBe(true);
    expect(Object.isFrozen(pack.keys)).toBe(true);
  }

  // —— 诊断条目 ——
  for (const diagnostic of definition.diagnostics) {
    expect(Object.isFrozen(diagnostic)).toBe(true);
  }
}

describe('freeze 步骤（管线步骤 7，06 任务 B4）', () => {
  it('加载产物全部字段与嵌套数据深冻结', async () => {
    const definition = await loadFixture();
    expectAllFrozen(definition);
  });

  it('运行期变异尝试一律 TypeError（严格模式，运行期不可变）', async () => {
    const definition = await loadFixture();
    const attempt = (mutate: () => void): unknown => {
      try {
        mutate();
      } catch (error) {
        return error;
      }
      return null;
    };
    expect(
      attempt(() => {
        (definition.manifest as { gameId: string }).gameId = 'hacked';
      }),
    ).toBeInstanceOf(TypeError);
    expect(
      attempt(() => {
        (definition.events as unknown[]).push(definition.events[0] as never);
      }),
    ).toBeInstanceOf(TypeError);
    expect(
      attempt(() => {
        (definition.events[0] as { id: string }).id = 'hacked';
      }),
    ).toBeInstanceOf(TypeError);
    const scene = [...definition.scenes.values()][0];
    if (scene === undefined) throw new Error('夹具应含场景');
    expect(
      attempt(() => {
        (scene.def.segments as unknown[]).push({});
      }),
    ).toBeInstanceOf(TypeError);
    expect(
      attempt(() => {
        (definition.diagnostics as unknown[]).push({} as never);
      }),
    ).toBeInstanceOf(TypeError);
    expect(
      attempt(() => {
        (definition.redirects as Record<string, string>)['legacy'] = 'arrival';
      }),
    ).toBeInstanceOf(TypeError);
    // 变异失败后数据保持原值
    expect(definition.manifest.gameId).not.toBe('hacked');
    expect(definition.events).toHaveLength(3);
  });

  it('同一 EventDef 在 events 与 poolIndex 共享引用，均冻结且无递归死循环', async () => {
    const definition = await loadFixture();
    const event = definition.events[0];
    if (event === undefined) throw new Error('夹具应含事件');
    const bucket = definition.poolIndex.byScope.get('old_town/gate');
    expect(bucket?.[0]).toBe(event); // 共享同一对象（seen 去重，深冻结一次即达）
    expect(Object.isFrozen(event)).toBe(true);
    expect(() => {
      (event as { id: string }).id = 'hacked';
    }).toThrow(TypeError);
  });

  it('deepFreeze：循环引用不无限递归，环上对象全部冻结', () => {
    const value: Record<string, unknown> = { name: 'a' };
    value['self'] = value;
    const returned = deepFreeze(value, new Set<object>());
    expect(returned).toBe(value);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value['self'] as object)).toBe(true);
  });

  it('buildGameDefinition：manifest 缺失 → INTERNAL（管线应在 validate 阻断）', () => {
    const call = (): unknown =>
      buildGameDefinition({
        validated: { domains: { manifest: undefined } } as unknown as ValidatedPackage,
        artifacts: minimalArtifacts(),
        scriptResult: minimalScriptResult(),
        warnings: [],
      });
    expect(call).toThrow(EngineError);
    let captured: unknown = null;
    try {
      call();
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(EngineError);
    if (!(captured instanceof EngineError)) return;
    expect(captured.code).toBe('INTERNAL');
  });

  it('buildGameDefinition：warnings 仅 warning 级进入 diagnostics（error 由管线阻断）', () => {
    const warning: Diagnostic = {
      severity: 'warning',
      code: 'DANGLING_REF',
      where: { kind: 'text', ref: 'scenes.missing.key', messageKey: 'error.loader.danglingRef' },
    };
    const errorDiag: Diagnostic = {
      severity: 'error',
      code: 'DUP_ID',
      where: { kind: 'scene', id: 'x', messageKey: 'error.loader.dupId' },
    };
    const definition = buildGameDefinition({
      validated: minimalValidated(),
      artifacts: minimalArtifacts(),
      scriptResult: minimalScriptResult(),
      warnings: [warning, errorDiag],
    });
    expect(definition.diagnostics).toEqual([warning]);
    expect(definition.redirects).toEqual({});
  });
});

// —— buildGameDefinition 直测的最小基座 -----------------------------------------

function minimalValidated(): ValidatedPackage {
  const manifest = manifestSchema.parse({
    gameId: 'freeze_test',
    entryScene: 'arrival',
    mainLang: 'zh-CN',
    langs: ['zh-CN'],
    contentTags: [],
    gameVersion: '1.0.0',
    schemaVersion: 1,
    minEngineVersion: '0.1.0',
    redirects: {},
    credits: 'freeze 步骤直测夹具',
  });
  return {
    parsed: {
      collected: {
        sceneFiles: [],
        sceneDocs: new Map(),
        dataFiles: [],
        assetFiles: [],
        mediaIds: [],
        localeFiles: new Map(),
        diagnostics: [],
      },
      docs: new Map(),
      diagnostics: [],
    },
    domains: {
      manifest,
      time: undefined,
      attrs: undefined,
      body: undefined,
      contentTags: undefined,
      statsPage: undefined,
      loop: undefined,
      areas: new Map(),
      scenes: new Map(),
      events: [],
      quests: new Map(),
      npcs: new Map(),
      items: new Map(),
      shops: new Map(),
      achievements: new Map(),
      perks: new Map(),
      endings: new Map(),
      factions: new Map(),
    },
    locales: new Map(),
    diagnostics: [],
  };
}

function minimalArtifacts(): CompiledArtifacts {
  return {
    exprCache: new Map(),
    poolIndex: {
      byScope: new Map(),
      dirtyMap: new Map(),
      mutexGroups: new Map(),
      questRefs: new Map(),
      achievementRefs: new Map(),
    },
    mediaCatalog: { resolve: () => null, size: 0 },
    xFunctionRefs: [],
  };
}

function minimalScriptResult(): ScriptStepResult {
  return {
    effectRegistry: createBuiltinEffectRegistry({
      items: new Map(),
      npcs: new Map(),
      factions: new Map(),
      quests: new Map(),
    }),
    functionRegistry: new Map(),
    checkResolver: undefined,
  };
}
