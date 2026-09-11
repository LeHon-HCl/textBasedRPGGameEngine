import { describe, expect, it } from 'vitest';
import { EngineError, createRng } from '@game/shared';
import type { AttrDefs, ExprFunctionRegistry } from '@game/shared';
import { recomputeDerived } from '../../src/state/derived.js';
import { DERIVED_TRIGGER_DOMAINS } from '../../src/state/derived.js';
import { newGameState } from '../../src/state/new-game.js';
import type { GameState } from '../../src/state/game-state.js';

/**
 * recomputeDerived 单测（04 任务 A3，设计 §3.1 派生属性策略 / FR-STAT-05）。
 *
 * - 触碰域门控：仅 attr/equip/outfit/body/statuses 被触碰才重算；
 * - 公式经 03 号 compileExpr + 作用域注入求值（严格语义，DD-01）；
 * - 拓扑序：派生间依赖按 refs 排序，循环依赖防御性 EXPR_COMPILE；
 * - options 注入：rng（DD-09 序列消耗）/ registry / timeView / meta。
 */

const ATTR_DEFS: AttrDefs = {
  numeric: {},
  level: {},
  derived: {
    max_hp: { formula: '10 + attr.con * 3' },
    heavy_blow: { formula: 'has("greatsword") ? 15 : 5' },
    mood_bonus: { formula: 'npc.raven.favor >= 5 ? 3 : 0' },
  },
};

/** 构造带派生定义的最小状态（derived 初值由调用方场景决定） */
function makeState(init: {
  attrs?: Record<string, number>;
  bag?: { itemId: string; count: number }[];
  npcs?: Record<string, { favor: number; met: boolean; flags: Record<string, never> }>;
}): GameState {
  return newGameState(
    {
      versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' },
      attrs: init.attrs,
      bag: init.bag,
      npcs: init.npcs,
    },
    createRng(42),
  );
}

describe('04-A3 recomputeDerived：触碰域门控（§3.1 仅五域触发）', () => {
  it('DERIVED_TRIGGER_DOMAINS 恰为 attr/equip/outfit/body/statuses', () => {
    expect([...DERIVED_TRIGGER_DOMAINS].sort()).toEqual(
      ['attr', 'body', 'equip', 'outfit', 'statuses'].sort(),
    );
  });

  it('五个触发域逐一命中重算', () => {
    for (const root of DERIVED_TRIGGER_DOMAINS) {
      const state = makeState({ attrs: { con: 2 } });
      state.player.derived.max_hp = 0;
      recomputeDerived(state, [root], {
        numeric: {},
        level: {},
        derived: { max_hp: { formula: '10 + attr.con * 3' } },
      });
      expect(state.player.derived.max_hp).toBe(16);
    }
  });

  it('非触发域（wallet/flags 等）不重算——病态公式也不求值（短路证明）', () => {
    const state = makeState({ attrs: { con: 2 } });
    state.player.derived.max_hp = 7;
    const broken: AttrDefs = {
      numeric: {},
      level: {},
      derived: { max_hp: { formula: 'attr.missing_key + 1' } },
    };
    expect(() => recomputeDerived(state, ['wallet', 'world'], broken)).not.toThrow();
    expect(state.player.derived.max_hp).toBe(7);
  });

  it('touchedRoots 为空时不重算', () => {
    const state = makeState({ attrs: { con: 2 } });
    recomputeDerived(state, [], ATTR_DEFS);
    expect(state.player.derived).toEqual({});
  });

  it('无派生定义时为无操作（即使触碰域命中）', () => {
    const state = makeState({ attrs: { con: 2 } });
    expect(() =>
      recomputeDerived(state, ['attr'], { numeric: {}, level: {}, derived: {} }),
    ).not.toThrow();
    expect(state.player.derived).toEqual({});
  });
});

describe('04-A3 recomputeDerived：作用域注入求值（§2.3 白名单域）', () => {
  it('attr / item（bag 计数）/ npc 域读取', () => {
    const state = makeState({
      attrs: { con: 2 },
      bag: [{ itemId: 'greatsword', count: 1 }],
      npcs: { raven: { favor: 7, met: true, flags: {} } },
    });
    recomputeDerived(state, ['attr'], ATTR_DEFS);
    expect(state.player.derived.max_hp).toBe(16);
    expect(state.player.derived.heavy_blow).toBe(15);
    expect(state.player.derived.mood_bonus).toBe(3);
  });

  it('渐进域缺席语义：未持有物品 → 0、未登场 NPC 经 favor() → 0（路径形式封闭域严格）', () => {
    const state = makeState({ attrs: { con: 2 } });
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: {
        heavy_blow: { formula: 'has("greatsword") ? 15 : 5' },
        mood_bonus: { formula: 'favor("raven") >= 5 ? 3 : 0' },
      },
    };
    recomputeDerived(state, ['attr'], defs);
    expect(state.player.derived.heavy_blow).toBe(5);
    expect(state.player.derived.mood_bonus).toBe(0);
    // 路径形式 npc.<id>.favor 为封闭域：未知 NPC 严格报错（eval.ts 缺席语义）
    const pathDefs: AttrDefs = {
      numeric: {},
      level: {},
      derived: { strict: { formula: 'npc.raven.favor >= 5 ? 3 : 0' } },
    };
    expect(() => recomputeDerived(state, ['attr'], pathDefs)).toThrowError(/EVAL_ERROR/);
  });

  it('body / faction / wallet 域读取', () => {
    const state = makeState({ attrs: {} });
    state.player.body.build = 'sturdy';
    state.factions['mages'] = 12;
    state.player.wallet.gold = 50;
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: {
        guard: { formula: 'body.build == "sturdy" ? 5 : 1' },
        discount: { formula: 'faction.mages >= 10 ? 2 : 0' },
        purse: { formula: 'wallet.gold / 10' },
      },
    };
    recomputeDerived(state, ['body'], defs);
    expect(state.player.derived.guard).toBe(5);
    expect(state.player.derived.discount).toBe(2);
    expect(state.player.derived.purse).toBe(5);
  });

  it('封闭域缺 key 严格报 EVAL_ERROR（DD-01 无静默默认值）', () => {
    const state = makeState({ attrs: { con: 2 } });
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: { broken: { formula: 'attr.not_defined + 1' } },
    };
    expect(() => recomputeDerived(state, ['attr'], defs)).toThrowError(EngineError);
    try {
      recomputeDerived(state, ['attr'], defs);
    } catch (err) {
      expect((err as EngineError).code).toBe('EVAL_ERROR');
    }
  });

  it('非数值 / 非有限结果抛 EVAL_ERROR（派生缓存只收有限 number）', () => {
    const state = makeState({ attrs: {} });
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: { texty: { formula: '"abc"' } },
    };
    expect(() => recomputeDerived(state, ['attr'], defs)).toThrowError(/EVAL_ERROR/);

    const nanDefs: AttrDefs = {
      numeric: {},
      level: {},
      derived: { nan: { formula: '0 / 0' } },
    };
    expect(() => recomputeDerived(state, ['attr'], nanDefs)).toThrowError(/EVAL_ERROR/);
  });

  it('公式编译失败抛 EXPR_COMPILE（未知 root，加载期本应拦截）', () => {
    const state = makeState({});
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: { bad: { formula: 'unknown_root.x + 1' } },
    };
    expect(() => recomputeDerived(state, ['attr'], defs)).toThrowError(/EXPR_COMPILE/);
  });
});

describe('04-A3 recomputeDerived：派生间依赖（拓扑序 + 循环防御）', () => {
  it('三条链倒置声明仍按依赖序求值', () => {
    const state = makeState({ attrs: { con: 2 } });
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: {
        third: { formula: 'attr.second + 1' },
        second: { formula: 'attr.first + 1' },
        first: { formula: 'attr.con + 1' },
      },
    };
    recomputeDerived(state, ['attr'], defs);
    expect(state.player.derived.first).toBe(3);
    expect(state.player.derived.second).toBe(4);
    expect(state.player.derived.third).toBe(5);
  });

  it('菱形依赖（A→B、A→C、B+C→D）只求值一次序满足', () => {
    const state = makeState({ attrs: { base: 2 } });
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: {
        d: { formula: 'attr.b + attr.c' },
        b: { formula: 'attr.a + 1' },
        a: { formula: 'attr.base * 2' },
        c: { formula: 'attr.a + 2' },
      },
    };
    recomputeDerived(state, ['attr'], defs);
    expect(state.player.derived.a).toBe(4);
    expect(state.player.derived.b).toBe(5);
    expect(state.player.derived.c).toBe(6);
    expect(state.player.derived.d).toBe(11);
  });

  it('派生属性并入 attr 视图：同名覆盖 + 后继公式读派生值', () => {
    const state = makeState({ attrs: { hp: 1, con: 5 } });
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: {
        hp: { formula: 'attr.con * 2' },
        double_hp: { formula: 'attr.hp * 2' },
      },
    };
    recomputeDerived(state, ['attr'], defs);
    // 派生 hp 覆盖同名基础属性；double_hp 读到派生后的 hp = 10
    expect(state.player.derived.hp).toBe(10);
    expect(state.player.derived.double_hp).toBe(20);
  });

  it('循环依赖抛 EXPR_COMPILE（FR-STAT-05 加载期排除的运行期防御）', () => {
    const state = makeState({ attrs: {} });
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: {
        a: { formula: 'attr.b + 1' },
        b: { formula: 'attr.a + 1' },
      },
    };
    expect(() => recomputeDerived(state, ['attr'], defs)).toThrowError(/EXPR_COMPILE/);
    try {
      recomputeDerived(state, ['attr'], defs);
    } catch (err) {
      expect((err as EngineError).code).toBe('EXPR_COMPILE');
    }
  });

  it('自引用公式同样判为循环', () => {
    const state = makeState({ attrs: {} });
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: { loop_self: { formula: 'attr.loop_self + 1' } },
    };
    expect(() => recomputeDerived(state, ['attr'], defs)).toThrowError(/EXPR_COMPILE/);
  });
});

describe('04-A3 recomputeDerived：求值环境注入（options）', () => {
  it('rng 注入：公式消耗传入 Rng 序列（DD-09 同实例推进可断言）', () => {
    const state = makeState({});
    const rng = createRng(42);
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: { roll: { formula: 'randInt(1, 100)' } },
    };
    recomputeDerived(state, ['attr'], defs, { rng });
    expect(state.player.derived.roll).toBe(createRng(42).int(1, 100));
    expect(rng.getState()).not.toBe(createRng(42).getState());
  });

  it('registry 注入：注册表函数参与公式求值（§3.2 合并面；点分 x.* 调用面归 23 号）', () => {
    const state = makeState({ attrs: { base: 7 } });
    const registry: ExprFunctionRegistry = new Map([
      [
        'x_mod_double',
        {
          name: 'x_mod_double',
          arity: [1, 1],
          pure: true,
          fn: (args: unknown[]) => {
            const [value] = args as [number];
            return typeof value === 'number' ? value * 2 : 0;
          },
        },
      ],
    ]);
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: { doubled: { formula: 'x_mod_double(attr.base)' } },
    };
    recomputeDerived(state, ['attr'], defs, { registry });
    expect(state.player.derived.doubled).toBe(14);
  });

  it('timeView 注入：覆盖默认 day/weekday/slot 投影（09 号 TimeConfig 校准缝）', () => {
    const state = makeState({});
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: {
        cal: { formula: 'day() == 9 && weekday() == "market" ? 1 : 0' },
      },
    };
    recomputeDerived(state, ['attr'], defs, {
      timeView: { day: 9, weekday: 'market', slot: 'dusk' },
    });
    expect(state.player.derived.cal).toBe(1);
  });

  it('meta 注入：Profile 投影可读（points，§2.3 meta 白名单行）', () => {
    const state = makeState({});
    const defs: AttrDefs = {
      numeric: {},
      level: {},
      derived: { perk_power: { formula: 'points() >= 10 ? 2 : 1' } },
    };
    recomputeDerived(state, ['attr'], defs, {
      meta: { points: 15, purchasedPerks: [{ id: 'iron_will', at: 0 }] },
    });
    expect(state.player.derived.perk_power).toBe(2);
  });

  it('就地重算普通对象状态（事务内 draft 路径由 B 组 exec 用例覆盖）', () => {
    const state = makeState({ attrs: { con: 2 } });
    recomputeDerived(state, ['attr'], {
      numeric: {},
      level: {},
      derived: { max_hp: { formula: '10 + attr.con * 3' } },
    });
    expect(state.player.derived.max_hp).toBe(16);
  });
});
