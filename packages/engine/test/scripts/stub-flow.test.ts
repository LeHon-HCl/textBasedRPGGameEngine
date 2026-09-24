import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRng } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '../../src/loader/index.js';
import { newGameState } from '../../src/state/index.js';
import { GameRuntime } from '../../src/runtime/index.js';
import { createScriptHost, HookRegistry, hookRegistrarFor } from '../../src/scripts/host.js';
import { createScriptTimeHooks, fireLoadComplete } from '../../src/scripts/hooks.js';
import { auditTouchDomains } from '../../src/scripts/touch-audit.js';
import type { ScriptModule, ScriptSetupApi } from '../../src/scripts/types.js';
import type { DamageInput } from '../../src/battle/types.js';
import type { EffectExecuteContext as ScriptExecuteContext } from '../../src/effects/types.js';

/**
 * S3 桩全流程测试（23 号子任务 9；完成定义）：
 * **注册 → 数据调用 → 事务生效 → 回滚一致** 的端到端闭环。
 *
 * 用**手工构造的 ScriptModule 桩**（不是真实脚本编译产物）覆盖全链路：
 * 1. 注册四类扩展点（effect / function / checkRule / hook）+ 伤害预设；
 * 2. 数据包经 `call` 指令调用脚本指令（走真实加载管线）；
 * 3. 脚本指令在事务中生效（状态真实改变）；
 * 4. 失败时整批回滚（与游戏内置指令同款原子性）；
 * 5. 域校验抓出未知写域。
 */

/** 桩脚本模块：注册一个效果指令 + 一个函数 + 一个钩子 + 一个伤害预设 */
function makeStubModule(): ScriptModule {
  return {
    id: 'x.stub',
    setup(api: ScriptSetupApi): void {
      api.registerEffect({
        id: 'x.stub.bless',
        // call 指令经 target.schema.safeParse 校验参数（真实 zod schema）
        schema: z.strictObject({ amount: z.number().int().optional() }),
        touch: () => ({ reads: [], writes: ['player.attrs'] }),
        execute: (arg: { amount?: number }, ectx: ScriptExecuteContext) => {
          const amount = arg.amount ?? 1;
          ectx.draft.player.attrs['insight'] =
            (ectx.draft.player.attrs['insight'] ?? 0) + amount;
        },
      } as never);
      api.registerFunction({
        name: 'x.stub.double',
        arity: [1, 1],
        pure: true,
        fn: (args: readonly unknown[]) => Number(args[0]) * 2,
      } as never);
      api.registerCheckRule({
        id: 'x.stub.always_pass',
        resolve: () => ({ rolls: [1], level: 'critical', outcome: 'success', detail: {} }),
      } as never);
      api.onHook('slot_advance', (host) => [
        // 钩子经 host.transaction 改状态（脚本唯一状态入口）
        ...(host === undefined ? [] : []),
        { add: { key: 'attr.insight', amount: 1 } },
      ]);
      api.registerDamagePreset('x.stub.fixed_hit', ((input: DamageInput) => ({
        amount: input.mult * 10,
      })) as never);
    },
  };
}

const PACKAGE_FILES: Record<string, string> = {
  'manifest.yaml': [
    'gameId: stub_script_test',
    'entryScene: arrival',
    'mainLang: zh-CN',
    'langs:',
    '  - zh-CN',
    'contentTags: []',
    'gameVersion: 1.0.0',
    'schemaVersion: 1',
    'minEngineVersion: 0.1.0',
    'redirects: {}',
    'credits: 桩测试包。',
  ].join('\n'),
  'data/attrs.yaml': [
    'numeric:',
    '  hp: { min: 0, max: 100, init: 30, show: true }',
    '  insight: { min: 0, max: 20, init: 0, show: true }',
    'level: {}',
    'derived: {}',
  ].join('\n'),
  'data/areas/meadow.yaml': ['id: meadow', 'nameKey: areas.meadow.name', 'locations: {}'].join('\n'),
  'data/scenes/arrival.yaml': [
    'id: arrival',
    'area: meadow',
    'segments:',
    '  - key: scenes.arrival.desc',
    'choices:',
    '  # 数据调用脚本指令（call 指令 → x.stub.bless）',
    '  - id: pray',
    '    textKey: scenes.arrival.pray',
    '    effects:',
    '      - call: { fn: x.stub.bless, with: { amount: 3 } }',
    '  # 数据调用脚本函数（表达式 x.stub.double）',
    '  - id: study',
    '    textKey: scenes.arrival.study',
    '    effects:',
    '      - set: { key: "attr.insight", value: "x.stub.double(2)" }',
    '  - id: back',
    '    textKey: scenes.arrival.back',
    '    goto: arrival',
  ].join('\n'),
  'locales/zh-CN/locales.yaml': 't.title: 桩测试',
};

async function makeWorld() {
  const module = makeStubModule();
  const definition = await loadGamePackage(new InMemoryPackageSource(PACKAGE_FILES), {
    scripts: [module],
  });
  const runtime = new GameRuntime({
    state: newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
        attrs: { hp: 30, insight: 0 },
      },
      createRng(1),
    ),
    rng: createRng(7),
    effectExecutor: definition.effectRegistry,
    // **关键装配**：表达式求值的作用域必须用加载期冻结的函数注册表
    // （含脚本 x.* 函数）——缺省会回落内置表，脚本函数在表达式里不可见
    functionRegistry: definition.functionRegistry,
  });
  return { definition, runtime, module };
}

describe('23-S3 桩全流程：注册 → 数据调用 → 事务生效', () => {
  it('脚本指令经数据 call 调用：状态真实改变（全链路）', async () => {
    const { runtime } = await makeWorld();
    // 数据里的 effects（call x.stub.bless amount=3）——经真实加载管线的注册表执行
    const scene = (await makeWorld()).definition.scenes.get('arrival');
    const pray = scene?.def.choices.find((choice) => choice.id === 'pray');
    runtime.exec(pray?.effects ?? [], {
      source: 'choice',
      where: { scene: 'arrival' },
      rng: createRng(1),
    });
    expect(runtime.state.player.attrs['insight']).toBe(3);
  });

  it('脚本函数经表达式调用：x.stub.double(2) → 4', async () => {
    const { runtime, definition } = await makeWorld();
    const scene = definition.scenes.get('arrival');
    const study = scene?.def.choices.find((choice) => choice.id === 'study');
    runtime.exec(study?.effects ?? [], {
      source: 'choice',
      where: { scene: 'arrival' },
      rng: createRng(1),
    });
    expect(runtime.state.player.attrs['insight']).toBe(4);
  });

  it('脚本判定规则接入解析链：x.stub.always_pass 可解析且返回 critical', async () => {
    // 判定规则解析链在加载步骤 6 合成（loader/scripts.ts 的 checkResolver）——
    // 经 runScriptStep 直接驱动验证（GameDefinition 不发布解析器本身）
    const { runScriptStep } = await import('../../src/loader/scripts.js');
    const module = makeStubModule();
    const result = runScriptStep({
      domains: {
        manifest: undefined,
        areas: new Map(),
        scenes: new Map(),
        items: new Map(),
        npcs: new Map(),
        factions: new Map(),
        quests: new Map(),
        shops: new Map(),
        enemies: new Map(),
        encounters: new Map(),
        achievements: new Map(),
        perks: new Map(),
        endings: new Map(),
        events: [],
        body: undefined,
        time: undefined,
      } as never,
      deferredXRefs: [],
      inventory: { texts: [], exprs: [], calls: [], media: [] } as never,
      options: { scripts: [module] },
    });
    const rule = result.checkResolver.resolve('x.stub.always_pass');
    expect(rule).toBeDefined();
    const resolved = rule?.resolve({ rule: 'x.stub.always_pass', value: 1 }, createRng(1));
    expect(resolved?.level).toBe('critical');
    expect(resolved?.outcome).toBe('success');
  });

  it('脚本钩子经 {hookRegistry, createScriptTimeHooks} 接入时间管线形态', async () => {
    const { definition, runtime } = await makeWorld();
    const host = createScriptHost({ runtime });
    const hooks = createScriptTimeHooks({
      fire: (hook, ctx) => definition.hookRegistry.collect(host, ctx),
    });
    const effects = hooks.slotAdvance({
      slots: 1,
      crossedDay: false,
      crossedWeek: false,
      crossedMonth: false,
    });
    expect(effects).toEqual([{ add: { key: 'attr.insight', amount: 1 } }]);
    // 形态验证：效果可直接交管线（管线合并进同一次事务）
    runtime.exec(effects, { source: 'hook', where: { pipeline: 'time' }, rng: createRng(1) });
    expect(runtime.state.player.attrs['insight']).toBe(1);
  });

  it('脚本伤害预设经加载期收集：解析器可解析', async () => {
    const { definition } = await makeWorld();
    const preset = definition.damagePresets.resolve('x.stub.fixed_hit');
    expect(preset).not.toBeNull();
    const result = preset?.({ attacker: { atk: 5 }, defender: {}, mult: 2 }, createRng(1));
    expect(result?.amount).toBe(20);
  });
});

describe('23-S3 桩全流程：回滚一致（脚本事务与游戏同款原子性）', () => {
  it('脚本指令与内置指令同批：任一失败 → 整批回滚（脚本改动一并撤销）', async () => {
    const { runtime, definition } = await makeWorld();
    const scene = definition.scenes.get('arrival');
    const pray = scene?.def.choices.find((choice) => choice.id === 'pray');
    expect(() =>
      runtime.exec(
        [
          ...(pray?.effects ?? []),
          { money: { town_silver: -999 } }, // 内置指令失败 → 整批回滚
        ],
        { source: 'choice', where: { scene: 'arrival' }, rng: createRng(1) },
      ),
    ).toThrowError();
    expect(runtime.state.player.attrs['insight']).toBe(0); // 脚本改动已回滚
  });

  it('回滚点还原：脚本事务与内置事务同粒度（FR-READ-03 一致性）', async () => {
    const { runtime, definition } = await makeWorld();
    const scene = definition.scenes.get('arrival');
    const pray = scene?.def.choices.find((choice) => choice.id === 'pray');
    runtime.checkpoint('before_pray');
    runtime.exec(pray?.effects ?? [], {
      source: 'choice',
      where: { scene: 'arrival' },
      rng: createRng(1),
    });
    expect(runtime.state.player.attrs['insight']).toBe(3);
    runtime.rollback(1);
    expect(runtime.state.player.attrs['insight']).toBe(0);
  });
});

describe('23-S3 域校验集成（FR-SCR-05）', () => {
  it('桩模块的效果指令声明已知域 → 无违规', async () => {
    const { module } = await makeWorld();
    const violations = auditTouchDomains([module], [
      {
        scriptId: 'x.stub',
        id: 'x.stub.bless',
        touch: { reads: [], writes: ['player.attrs'] },
      },
    ]);
    expect(violations).toEqual([]);
  });

  it('声明未知写域 → 违规（含定位）', () => {
    const violations = auditTouchDomains([], [
      {
        scriptId: 'x.stub',
        id: 'x.stub.bad',
        touch: { reads: [], writes: ['x.stub.custom_domain'] },
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.domain).toBe('x.stub.custom_domain');
  });
});

describe('23-S3 钩子装配面（hookRegistrarFor + HookRegistry 协作）', () => {
  it('多模块多钩子：注册序保持，各模块 id 归因正确', () => {
    const registry = new HookRegistry();
    const order: string[] = [];
    const moduleA = { id: 'x.a', setup: (api: { onHook: (h: never, fn: never) => void }) =>
      api.onHook('load_complete' as never, (() => order.push('a')) as never) };
    const moduleB = { id: 'x.b', setup: (api: { onHook: (h: never, fn: never) => void }) =>
      api.onHook('load_complete' as never, (() => order.push('b')) as never) };
    moduleA.setup({ onHook: hookRegistrarFor(registry, 'x.a') as never });
    moduleB.setup({ onHook: hookRegistrarFor(registry, 'x.b') as never });

    const runtime = new GameRuntime({
      state: newGameState(
        {
          versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
          attrs: { hp: 30 },
        },
        createRng(1),
      ),
      rng: createRng(7),
      effectExecutor: createBuiltinEffectRegistry(),
    });
    fireLoadComplete({ fire: (hook, ctx) => registry.collect(createScriptHost({ runtime }), ctx) });
    expect(order).toEqual(['a', 'b']);
  });
});

import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
