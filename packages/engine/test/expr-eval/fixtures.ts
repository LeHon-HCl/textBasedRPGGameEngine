import { createRng } from '@game/shared';
import type { EvalContext, ExprFunctionDef, ExprFunctionRegistry, ExprScope } from '@game/shared';

/**
 * expr-eval 测试夹具（03 任务 B/C 共用）：
 * - `makeScope`：覆盖 §2.3 白名单全部 13 个 root 的最小求值作用域；
 * - `makeCtx`：注入固定种子 Rng（DD-09 确定性）与注册表；
 * - `def`：构造注册表条目的便捷函数。
 */

/** 覆盖全部 root 的基础作用域；测试用 overrides 覆盖任意顶层切片 */
export function makeScope(overrides: Partial<ExprScope> = {}): ExprScope {
  const base: ExprScope = {
    player: {
      attrs: { hp: 30, mp: 10, strength: 7 },
      skills: { stealth: { value: 3, exp: 40 }, sword: { value: 5, exp: 10 } },
      // 层键：数值层（'1'/'2'，worn(part, layer) 用）+ 命名层（路径段须为标识符）
      outfit: { torso: { '1': 'leather_armor', '2': 'cloak', cloth: 'robe' }, head: {} },
      body: { race: 'human', build: 'slim' },
      wallet: { gold: 100, gems: 2 },
    },
    world: {
      flags: { door_opened: true, chapter: 2, title: 'novice' },
      time: { day: 5, weekday: 'sat', slot: 'morning' },
    },
    bagCounts: { potion: 3, key: 1, herb: 0 },
    npcs: {
      raven: { favor: 7, stage: 'warm', met: true, flags: { mood: 'calm' } },
      sela: { favor: 0, met: false, flags: {} },
    },
    factions: { mages: 12, thieves: -3 },
    quests: {
      main: { state: 'active', stage: 's1', objectives: {}, startedDay: 1 },
      side_fishing: { state: 'done', objectives: {} },
    },
    loop: 2,
    meta: { points: 15, purchasedPerks: [{ id: 'iron_will', at: 0 }] },
  };
  return { ...base, ...overrides };
}

/** 求值上下文：默认固定种子 42 的 mulberry32 + 空注册表 */
export function makeCtx(
  state: ExprScope = makeScope(),
  rng = createRng(42),
  registry: ExprFunctionRegistry = new Map(),
): EvalContext {
  return { state, rng, registry };
}

/** 注册表条目便捷构造 */
export function def(
  name: string,
  arity: [number, number],
  pure: boolean,
  fn: (args: unknown[], ctx: EvalContext) => unknown,
): [string, ExprFunctionDef] {
  return [name, { name, arity, pure, fn }];
}
