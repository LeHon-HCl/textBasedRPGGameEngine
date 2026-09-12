import { createRng } from '@game/shared';
import type { EvalContext, ExprScope, Lang } from '@game/shared';
import type { LocalePack, LocaleValue } from '../../src/loader/index.js';
import { createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import type { TextResolverWarn } from '../../src/i18n/text-resolver.js';

/**
 * i18n 用例共享夹具：手构语言包、告警记录器与最小求值作用域
 * （§4.1「独立测试」：纯函数 + 词典夹具，不依赖运行时其他模块）。
 */

/** 手构语言包：键值表 → LocalePack */
export function pack(lang: Lang, entries: Record<string, LocaleValue>): LocalePack {
  return { lang, keys: new Map(Object.entries(entries)) };
}

/** 告警记录器：注入 resolver 并收集调用（message + where） */
export function recordWarn(): {
  calls: Array<{ message: string; where: Record<string, string> }>;
  warn: TextResolverWarn;
} {
  const calls: Array<{ message: string; where: Record<string, string> }> = [];
  const warn: TextResolverWarn = (message, where) => calls.push({ message, where: { ...where } });
  return { calls, warn };
}

/** select 求值作用域夹具（§2.3 ExprScope 最小形态） */
export function makeScope(overrides: Partial<ExprScope> = {}): ExprScope {
  const base: ExprScope = {
    player: {
      attrs: { stamina: 5 },
      skills: {},
      outfit: {},
      body: {},
      wallet: { gold: 10 },
    },
    world: {
      flags: { mood: 'friendly' },
      time: { day: 1, weekday: '1', slot: '0' },
    },
    bagCounts: { warm_bun: 2 },
    npcs: { hawker: { favor: 7, met: true, flags: {} } },
    factions: {},
    quests: {},
    loop: 1,
    meta: { points: 0, purchasedPerks: [] },
  };
  return { ...base, ...overrides };
}

/** select 求值上下文夹具（注入固定种子 Rng 与内置函数注册表） */
export function makeEvalContext(scope: ExprScope = makeScope()): EvalContext {
  return {
    state: scope,
    rng: createRng(1),
    registry: createBuiltinFunctionRegistry(),
  };
}
