import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import { loadFixture, makeFixtureSource } from './fixtures.js';
import { loadGamePackage } from '../../src/loader/pipeline.js';
import { runScriptStep } from '../../src/loader/scripts.js';
import type { PackageInventory } from '../../src/loader/walk.js';
import type { PackageDomains, ScriptModule } from '../../src/loader/types.js';
import type { CheckRule } from '../../src/effects/index.js';

/**
 * scripts 步骤用例（06 任务 B3，设计 §3.4 步骤 6 / §5.9 / FR-SCR-04 / DD-08）。
 *
 * 断言口径：宿主注入 ScriptModule[] 在管线步骤 6 注册——效果指令走 05 号
 * 注册表（x.* 命名空间 + DUP_ID 裁决）、表达式函数入最终注册表、判定规则
 * 进解析器；注册完成后执行 x.* 悬空校验（call 指令与表达式函数 →
 * SCRIPT_CONTRACT；非纯函数入事件 require → EXPR_COMPILE），随后注册表
 * 冻结（注册窗口关闭）。缺省无脚本 = 注册表仅含内置且冻结。
 */

/** 注册一个效果指令（x.* 命名空间）与一个纯表达式函数的脚本模块 */
function festivalModule(): ScriptModule {
  return {
    id: 'festival',
    setup(api) {
      api.registerEffect({
        id: 'x.festival.calendar',
        schema: {
          parse: (value: unknown) => value,
          safeParse: (value: unknown) => ({ success: true, data: value }),
        } as never,
        touch: () => ({ reads: [], writes: [] }),
        execute: () => undefined,
      });
      api.registerFunction({
        name: 'x.festival.charge',
        arity: [0, 0],
        pure: true,
        fn: () => 42,
      });
    },
  };
}

/** runScriptStep 直测用的空域基座（注册/解析器语义不依赖包内容） */
const EMPTY_DOMAINS: PackageDomains = {
  manifest: undefined,
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
};

const EMPTY_INVENTORY: PackageInventory = { refs: [], exprs: [], calls: [], effects: [] };

describe('scripts 步骤（管线步骤 6，06 任务 B3）', () => {
  it('缺省无脚本：functionRegistry 仅含内置 20 函数，效果注册表冻结', async () => {
    const definition = await loadFixture();
    // 内置函数冻结清单（DD-01：20 个）
    expect(definition.functionRegistry.size).toBe(20);
    expect(definition.functionRegistry.has('rand')).toBe(true);
    expect(definition.functionRegistry.has('points')).toBe(true);
    expect(definition.effectRegistry.frozen).toBe(true);
    expect(definition.effectRegistry.ids()).toContain('set');
  });

  it('ScriptModule 注册效果指令与函数：x.* 进注册表，加载全绿', async () => {
    const definition = await loadFixture(undefined, { scripts: [festivalModule()] });
    expect(definition.effectRegistry.lookup('x.festival.calendar')).toBeDefined();
    expect(definition.functionRegistry.get('x.festival.charge')?.fn([], undefined as never)).toBe(
      42,
    );
    // 内置指令与函数未被脚本破坏
    expect(definition.effectRegistry.ids()).toContain('goto');
    expect(definition.functionRegistry.size).toBe(21);
  });

  it('数据表达式调用已注册的脚本函数：x.* 引用经步骤 5 登记、步骤 6 核对后全绿', async () => {
    const definition = await loadFixture(
      (files) => {
        const scene = files['data/scenes/old_town/arrival.yaml'] ?? '';
        files['data/scenes/old_town/arrival.yaml'] = scene.replace(
          'showIf: "attr.stamina > 0"',
          'showIf: "x.festival.charge() > 0"',
        );
      },
      { scripts: [festivalModule()] },
    );
    expect(definition.exprCache.has('x.festival.charge() > 0')).toBe(true);
  });

  it('两个脚本模块注册同名效果指令 → DUP_ID（05 号注册表裁决）', async () => {
    const makeModule = (id: string): ScriptModule => ({
      id,
      setup(api) {
        api.registerEffect({
          id: 'x.twin.op',
          schema: {} as never,
          touch: () => ({ reads: [], writes: [] }),
          execute: () => undefined,
        });
      },
    });
    const error = await loadFixture(undefined, {
      scripts: [makeModule('a'), makeModule('b')],
    }).then(
      (definition) => definition,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EngineError);
    if (!(error instanceof EngineError)) return;
    expect(error.code).toBe('DUP_ID');
    expect(error.where['id']).toBe('x.twin.op');
  });

  it('注册表冻结：步骤 6 之后 register 一律 SCRIPT_CONTRACT（注册窗口关闭）', async () => {
    const error = await loadFixture(undefined, { scripts: [festivalModule()] }).then(
      (definition) => {
        try {
          definition.effectRegistry.register({
            id: 'x.late.move',
            schema: {} as never,
            touch: () => ({ reads: [], writes: [] }),
            execute: () => undefined,
          });
          return null;
        } catch (e) {
          return e;
        }
      },
    );
    expect(error).toBeInstanceOf(EngineError);
    if (!(error instanceof EngineError)) return;
    expect(error.code).toBe('SCRIPT_CONTRACT');
    expect(error.where['detail']).toContain('冻结');
  });

  it('数据 call 引用未注册的 x.* 指令 → SCRIPT_CONTRACT（FR-SCR-04 悬空）', async () => {
    const error = await loadFixture(
      (files) => {
        const scene = files['data/scenes/old_town/arrival.yaml'] ?? '';
        files['data/scenes/old_town/arrival.yaml'] = scene.replace(
          '    goto: market_street',
          '    effects:\n      - call: {fn: "x.ghost.op"}\n    goto: market_street',
        );
      },
      { scripts: [festivalModule()] },
    ).then(
      (definition) => definition,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EngineError);
    if (!(error instanceof EngineError)) return;
    expect(error.code).toBe('SCRIPT_CONTRACT');
    expect(error.where['fn']).toBe('x.ghost.op');
    expect(error.where['from']).toContain('scenes[arrival]');
  });

  it('数据表达式引用未注册的 x.* 函数 → SCRIPT_CONTRACT（compile 期登记，步骤 6 核对）', async () => {
    const error = await loadFixture(
      (files) => {
        const scene = files['data/scenes/old_town/arrival.yaml'] ?? '';
        files['data/scenes/old_town/arrival.yaml'] = scene.replace(
          'showIf: "attr.stamina > 0"',
          'showIf: "x.ghost.charge() > 0"',
        );
      },
      { scripts: [festivalModule()] },
    ).then(
      (definition) => definition,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EngineError);
    if (!(error instanceof EngineError)) return;
    expect(error.code).toBe('SCRIPT_CONTRACT');
    expect(error.where['fn']).toBe('x.ghost.charge');
  });

  it('非纯脚本函数出现在事件 require（缓存敏感位置）→ EXPR_COMPILE（DD-01）', async () => {
    const impureModule: ScriptModule = {
      id: 'chaos',
      setup(api) {
        api.registerFunction({
          name: 'x.chaos.roll',
          arity: [0, 0],
          pure: false,
          fn: () => 1,
        });
      },
    };
    const error = await loadFixture(
      (files) => {
        const events = files['data/events.yaml'] ?? '';
        files['data/events.yaml'] = events.replace(
          'require: "flag.wall_seen && npc.guard.met"',
          'require: "x.chaos.roll() > 0"',
        );
      },
      { scripts: [impureModule] },
    ).then(
      (definition) => definition,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EngineError);
    if (!(error instanceof EngineError)) return;
    expect(error.code).toBe('EXPR_COMPILE');
  });

  it('非纯脚本函数在非缓存敏感位置（choice showIf）可用', async () => {
    const impureModule: ScriptModule = {
      id: 'chaos',
      setup(api) {
        api.registerFunction({
          name: 'x.chaos.roll',
          arity: [0, 0],
          pure: false,
          fn: () => 1,
        });
      },
    };
    const definition = await loadFixture(
      (files) => {
        const scene = files['data/scenes/old_town/arrival.yaml'] ?? '';
        files['data/scenes/old_town/arrival.yaml'] = scene.replace(
          'showIf: "attr.stamina > 0"',
          'showIf: "x.chaos.roll() > 0"',
        );
      },
      { scripts: [impureModule] },
    );
    expect(definition.exprCache.has('x.chaos.roll() > 0')).toBe(true);
  });

  it('脚本函数名不带 x.* 命名空间 → SCRIPT_CONTRACT（DD-08）', async () => {
    const badModule: ScriptModule = {
      id: 'bad',
      setup(api) {
        api.registerFunction({ name: 'shadow_rand', arity: [0, 0], pure: true, fn: () => 1 });
      },
    };
    const error = await loadFixture(undefined, { scripts: [badModule] }).then(
      (definition) => definition,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EngineError);
    if (!(error instanceof EngineError)) return;
    expect(error.code).toBe('SCRIPT_CONTRACT');
    expect(error.where['fn']).toBe('shadow_rand');
  });

  it('脚本效果指令 id 不带 x.* 命名空间 → SCRIPT_CONTRACT（05 号注册表裁决）', async () => {
    const badModule: ScriptModule = {
      id: 'bad',
      setup(api) {
        api.registerEffect({
          id: 'goto_clone',
          schema: {} as never,
          touch: () => ({ reads: [], writes: [] }),
          execute: () => undefined,
        });
      },
    };
    const error = await loadFixture(undefined, { scripts: [badModule] }).then(
      (definition) => definition,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EngineError);
    if (!(error instanceof EngineError)) return;
    expect(error.code).toBe('SCRIPT_CONTRACT');
  });

  it('两个脚本模块注册同名函数 → DUP_ID', async () => {
    const moduleA: ScriptModule = {
      id: 'a',
      setup(api) {
        api.registerFunction({ name: 'x.a.value', arity: [0, 0], pure: true, fn: () => 1 });
      },
    };
    const moduleB: ScriptModule = {
      id: 'b',
      setup(api) {
        api.registerFunction({ name: 'x.a.value', arity: [0, 0], pure: true, fn: () => 2 });
      },
    };
    const error = await loadFixture(undefined, { scripts: [moduleA, moduleB] }).then(
      (definition) => definition,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EngineError);
    if (!(error instanceof EngineError)) return;
    expect(error.code).toBe('DUP_ID');
  });

  it('脚本判定规则进解析链：脚本规则优先，宿主级解析器次之（§5.1，15 号）', () => {
    const customRule: CheckRule = {
      id: 'x.rules.custom',
      resolve: () => ({ rolls: [1], level: 'normal', outcome: 'success', detail: {} }),
    };
    const hostCoc: CheckRule = {
      id: 'coc',
      resolve: () => ({ rolls: [2], level: 'normal', outcome: 'fail', detail: {} }),
    };
    const result = runScriptStep({
      domains: EMPTY_DOMAINS,
      deferredXRefs: [],
      inventory: EMPTY_INVENTORY,
      options: {
        scripts: [
          {
            id: 'rules',
            setup(api) {
              api.registerCheckRule(customRule);
            },
          },
        ],
        checkResolver: { resolve: (ruleId) => (ruleId === 'coc' ? hostCoc : undefined) },
      },
    });
    expect(result.checkResolver.resolve('x.rules.custom')).toBe(customRule);
    // 宿主权威：宿主对 'coc' 的实现覆盖内置 coc（解析链中段）
    expect(result.checkResolver.resolve('coc')).toBe(hostCoc);
    // 15 号 commit 1 时内置仅有 coc，generic 尚未落地 → 全链未命中返回 undefined
    expect(result.checkResolver.resolve('generic')).toBeUndefined();
    expect(result.effectRegistry.frozen).toBe(true);
  });

  it('脚本与宿主皆缺省：解析链仍可用（内置 coc 兜底，15 号），未知 id 返回 undefined', () => {
    const result = runScriptStep({
      domains: EMPTY_DOMAINS,
      deferredXRefs: [],
      inventory: EMPTY_INVENTORY,
      options: {},
    });
    expect(result.checkResolver.resolve('coc')).toBeDefined();
    expect(result.checkResolver.resolve('x.nobody.registered')).toBeUndefined();
    expect(result.effectRegistry.frozen).toBe(true);
  });

  it('无脚本的 call x.* 引用同样被检出（默认注入 = 空数组）', async () => {
    const source = makeFixtureSource((files) => {
      const scene = files['data/scenes/old_town/arrival.yaml'] ?? '';
      files['data/scenes/old_town/arrival.yaml'] = scene.replace(
        '    goto: market_street',
        '    effects:\n      - call: {fn: "x.lone.op"}\n    goto: market_street',
      );
    });
    const error = await loadGamePackage(source).then(
      (definition) => definition,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EngineError);
    if (!(error instanceof EngineError)) return;
    expect(error.code).toBe('SCRIPT_CONTRACT');
  });
});
