import { describe, expect, it } from 'vitest';
import type { EffectData } from '@game/shared';
import type { Patch } from 'immer';
import {
  BODY_DEFS,
  BASE_VERSIONS,
  FACTIONS,
  ITEMS,
  NPCS,
  QUESTS,
  makeBuiltinRuntime,
  scriptedCheckRule,
  makeCtx,
} from './fixtures.js';
import type { EffectRegistryOptions } from '../../src/effects/types.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';

/**
 * C1 touch 元数据三方复用验证（§3.3 touch 设计要点、FR-SCR-05、05 任务 C1）：
 * 1. **迁移登记**（21 号）：touch.writes 全部落在已知状态域清单内，迁移器可据
 *    此登记新增存档域（FR-MIGR）的登记校验；
 * 2. **调试监视**（FR-DEBG）：指令矩阵执行后的实际补丁写域与 touch.writes
 *    声明双向一致——变量监视高亮与迁移登记使用同一份元数据；
 * 3. **订阅触发**（§4.5/§5.4）：touched 前缀可直接作为任务/成就增量求值的
 *    订阅键（前缀形态与补丁路径的 dotted 前缀一致）。
 */

/** GameState 全部可写状态域前缀（迁移登记的白名单面） */
const KNOWN_WRITE_DOMAINS: readonly string[] = [
  'player.attrs',
  'player.skills',
  'player.statuses',
  'player.body',
  'player.bodyProgress',
  'player.bodyTemp',
  'player.equip',
  'player.outfit',
  'player.outfitPresets',
  'player.wornMeta',
  'player.bag',
  'player.wallet',
  'world.time',
  'world.unlockedAreas',
  'world.flags',
  'world.counters',
  'world.eventCooldowns',
  'world.npcLocationCache',
  'npcs',
  'factions',
  'quests',
  'seen.scenes',
  'seen.gallery',
  'seen.endings',
  'seen.codex',
  'readStats',
  'loop',
];

/** touch 全集（30 个内置指令 × 代表性参数）：id → touch 入参（02 号参数形态） */
const TOUCH_ARGS: Record<string, unknown> = {
  set: { key: 'flag.x', value: 1 },
  add: { key: 'counter.x', amount: 1 },
  flag: { name: 'x' },
  money: { gold: 1 },
  give: { item: 'item_x', count: 1 },
  take: { item: 'item_x', count: 1 },
  equip: { item: 'item_x' },
  unequip: { slot: 'weapon' },
  wear: { item: 'item_x' },
  remove: { item: 'item_x' },
  set_body: { part: 'build', value: 'sturdy' },
  favor: { npc: 'npc_x', amount: 1 },
  reputation: { faction: 'faction_x', amount: 1 },
  advance_time: { cost: 1 },
  quest: { id: 'quest_x', action: 'accept' },
  check: { value: '10' },
  battle: { encounter: 'encounter_x' },
  goto: 'scene_x',
  back: null,
  ending: 'ending_x',
  loop_transition: null,
  unlock: { kind: 'gallery', id: 'cg_x' },
  media: { type: 'sfx', assetId: 'sfx_x' },
  notify: { textKey: 'ui.x' },
  call: { fn: 'x.test.echo', with: {} }, // 未注册目标 → 委托回退空声明
  // 09 号内部指令（时钟写入载体；作者包内不可达，见 system.ts TSDoc）
  '__time.advance': { slots: 1 },
  // 12 号内部指令（日程缓存重建载体；作者包内不可达）
  '__npc.resolve': {},
};

interface MatrixEntry {
  readonly name: string;
  readonly instruction: EffectData;
  readonly setup?: readonly EffectData[];
  readonly options?: EffectRegistryOptions;
  readonly bootstrap?: Record<string, unknown>;
}

/** 指令矩阵：执行后产生实际写域的指令（Happy path；setup 先行建立前置状态） */
const EXEC_MATRIX: readonly MatrixEntry[] = [
  { name: 'set(attr)', instruction: { set: { key: 'attr.hp', value: 5 } } },
  { name: 'set(flag)', instruction: { set: { key: 'flag.door', value: true } } },
  { name: 'set(counter)', instruction: { set: { key: 'counter.chest', value: 2 } } },
  {
    name: 'set(npc记忆)',
    instruction: { set: { key: 'npc.npc_raven.flags.said_hi', value: true } },
  },
  { name: 'add(counter)', instruction: { add: { key: 'counter.chest', amount: 2 } } },
  { name: 'flag', instruction: { flag: { name: 'lit' } } },
  {
    name: 'money',
    instruction: { money: { gold: 5 } },
    bootstrap: { wallet: { gold: 10 } },
  },
  {
    name: 'give',
    instruction: { give: { item: 'item_herb', count: 2 } },
    options: { items: ITEMS },
  },
  {
    name: 'take',
    instruction: { take: { item: 'item_herb', count: 1 } },
    options: { items: ITEMS },
    bootstrap: { bag: [{ itemId: 'item_herb', count: 2 }] },
  },
  {
    name: 'equip',
    instruction: { equip: { item: 'item_sword' } },
    options: { items: ITEMS },
    bootstrap: { bag: [{ itemId: 'item_sword', count: 1 }] },
  },
  {
    name: 'unequip',
    instruction: { unequip: { slot: 'weapon' } },
    setup: [{ equip: { item: 'item_sword' } }],
    options: { items: ITEMS },
    bootstrap: { bag: [{ itemId: 'item_sword', count: 1 }] },
  },
  {
    name: 'wear',
    instruction: { wear: { item: 'item_cotton_shirt' } },
    options: { items: ITEMS },
    bootstrap: { bag: [{ itemId: 'item_cotton_shirt', count: 1 }] },
  },
  {
    name: 'remove',
    instruction: { remove: { item: 'item_cotton_shirt' } },
    setup: [{ wear: { item: 'item_cotton_shirt' } }],
    options: { items: ITEMS },
    bootstrap: { bag: [{ itemId: 'item_cotton_shirt', count: 1 }] },
  },
  {
    name: 'set_body',
    // 覆盖 touch 声明的全部域：body（值变更）+ bodyProgress（进度）+ bodyTemp（临时登记）
    instruction: {
      set_body: { part: 'build', value: 'sturdy', progress: 50, revertAfter: { slots: 2 } },
    },
    options: { bodyDefs: BODY_DEFS },
  },
  {
    name: 'favor',
    instruction: { favor: { npc: 'npc_raven', amount: 40 } },
    options: { npcs: NPCS },
    bootstrap: { npcs: { npc_raven: { favor: 0 } } },
  },
  {
    name: 'reputation',
    instruction: { reputation: { faction: 'faction_town', amount: 60 } },
    options: { factions: FACTIONS },
    bootstrap: { factions: { faction_town: 0 } },
  },
  {
    name: 'quest(accept)',
    instruction: { quest: { id: 'quest_delivery', action: 'accept' } },
    options: { quests: QUESTS },
  },
  { name: 'unlock(gallery)', instruction: { unlock: { kind: 'gallery', id: 'cg_x' } } },
  { name: 'unlock(ending)', instruction: { unlock: { kind: 'ending', id: 'ending_x' } } },
  { name: 'unlock(codex)', instruction: { unlock: { kind: 'codex', id: 'codex_x' } } },
];

/** 跳转/事件类指令：执行后零写域（touch 与实际同为空集） */
const NO_WRITE_MATRIX: readonly MatrixEntry[] = [
  { name: 'goto', instruction: { goto: 'scene_x' } },
  { name: 'back', instruction: { back: null } },
  { name: 'ending', instruction: { ending: 'ending_x' } },
  { name: 'loop_transition', instruction: { loop_transition: null } },
  { name: 'advance_time(0)', instruction: { advance_time: { cost: 0 } } },
  { name: 'media', instruction: { media: { type: 'sfx', assetId: 'sfx_x' } } },
  { name: 'notify', instruction: { notify: { textKey: 'ui.x' } } },
  {
    name: 'check(无分支)',
    instruction: { check: { value: '10' } },
    options: {
      checkResolver: { resolve: () => scriptedCheckRule({ outcome: 'success', level: 'normal' }) },
    },
  },
];

/** 补丁路径 → 状态域前缀（与 touch.writes 的声明粒度同口径） */
function domainOfPatchPath(path: readonly (string | number)[]): string {
  const head = String(path[0]);
  if (head === 'player' || head === 'world' || head === 'seen') {
    return `${head}.${String(path[1])}`;
  }
  return head;
}

function writtenDomains(patches: readonly Patch[]): Set<string> {
  return new Set(patches.map((patch) => domainOfPatchPath(patch.path)));
}

describe('05-C1 touch 声明（三方复用：迁移登记面）', () => {
  it('全部 32 个内置指令可产出 TouchReport，writes 落在已知状态域清单内', () => {
    const registry = createBuiltinEffectRegistry();
    expect(registry.ids().length).toBe(32);
    for (const id of registry.ids()) {
      const def = registry.lookup(id);
      expect(def, `指令 ${id} 应已注册`).toBeDefined();
      const report = def?.touch(TOUCH_ARGS[id] as never);
      expect(report).toBeDefined();
      for (const domain of [...(report?.writes ?? []), ...(report?.reads ?? [])]) {
        expect(KNOWN_WRITE_DOMAINS, `${id} 声明了未知状态域 '${domain}'`).toContain(domain);
      }
    }
  });

  it('check / battle / call / 跳转类指令声明零写域（不改状态或归下游）', () => {
    const registry = createBuiltinEffectRegistry();
    for (const id of [
      'check',
      'battle',
      'goto',
      'back',
      'ending',
      'loop_transition',
      'advance_time',
      'media',
      'notify',
    ]) {
      const report = registry.lookup(id)?.touch(TOUCH_ARGS[id] as never);
      expect(report?.writes).toEqual([]);
    }
  });

  it('set/add 的 touch 随 key 域变化；非法 key 声明为空集', () => {
    const registry = createBuiltinEffectRegistry();
    const setDef = registry.lookup('set');
    expect(setDef?.touch({ key: 'attr.hp', value: 1 } as never).writes).toEqual(['player.attrs']);
    expect(setDef?.touch({ key: 'flag.x', value: 1 } as never).writes).toEqual(['world.flags']);
    expect(setDef?.touch({ key: 'counter.x', value: 1 } as never).writes).toEqual([
      'world.counters',
    ]);
    expect(setDef?.touch({ key: 'npc.npc_raven.flags.x', value: 1 } as never).writes).toEqual([
      'npcs',
    ]);
    expect(setDef?.touch({ key: 'bogus', value: 1 } as never).writes).toEqual([]);
  });
});

describe('05-C1 touch 声明 vs 实际写域（调试监视面：抽查断言）', () => {
  it.each(EXEC_MATRIX.map((entry) => [entry.name, entry] as const))(
    '%s：touch.writes 与实际补丁写域一致（双向集合相等）',
    (_name, entry) => {
      const { rt, registry } = makeBuiltinRuntime({
        bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 30, con: 2 }, ...entry.bootstrap },
        registryOptions: { ...entry.options },
      });
      const instructionId = String(Object.keys(entry.instruction)[0]);
      const declared = new Set(
        registry.lookup(instructionId)?.touch(Object.values(entry.instruction)[0] as never)
          .writes ?? [],
      );
      if (entry.setup !== undefined) {
        rt.exec(entry.setup, makeCtx()); // 前置状态（equip/wear）不计入测量
      }
      const before = rt.state;
      const outcome = rt.exec([entry.instruction], makeCtx());
      const actual = writtenDomains(outcome.patches);
      // 双向一致：实际写域未被漏报（迁移/订阅安全），声明无误报（监视不噪声）
      for (const domain of actual) {
        expect(declared, `实际写域 '${domain}' 未在 ${entry.name} 的 touch 中声明`).toContain(
          domain,
        );
      }
      expect(actual).toEqual(declared);
      expect(rt.state).not.toBe(before);
    },
  );

  it.each(NO_WRITE_MATRIX.map((entry) => [entry.name, entry] as const))(
    '%s：声明零写域且实际零补丁',
    (_name, entry) => {
      const { rt } = makeBuiltinRuntime({
        registryOptions: { ...entry.options },
      });
      const outcome = rt.exec([entry.instruction], makeCtx());
      expect(outcome.patches).toEqual([]);
    },
  );
});

describe('05-C1 touch 前缀形态（订阅触发面）', () => {
  it('writes/read 前缀均为点分状态域路径，可直接作为订阅键', () => {
    const registry = createBuiltinEffectRegistry();
    // 域段允许 camelCase（与真实状态键一致：world.eventCooldowns / player.outfitPresets）
    const prefixPattern = /^[a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)*$/;
    for (const id of registry.ids()) {
      const report = registry.lookup(id)?.touch(TOUCH_ARGS[id] as never);
      for (const prefix of [...(report?.writes ?? []), ...(report?.reads ?? [])]) {
        expect(prefix, `${id} 的 touch 前缀 '${prefix}' 应为点分域路径`).toMatch(prefixPattern);
      }
    }
    // 订阅面示例：监听 player.bag 的任务/成就订阅可被 give 命中
    const giveWrites = registry.lookup('give')?.touch(TOUCH_ARGS['give'] as never).writes ?? [];
    expect(giveWrites).toContain('player.bag');
  });
});
