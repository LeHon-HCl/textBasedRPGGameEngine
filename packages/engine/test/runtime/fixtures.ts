import { createRng } from '@game/shared';
import type { EffectData, Rng } from '@game/shared';
import { compileExpr, createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { newGameState } from '../../src/state/new-game.js';
import type { AttrDefs } from '@game/shared';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import type {
  EffectContext,
  EffectExecutor,
  ExecContext,
  ExecOutcome,
} from '../../src/runtime/exec-context.js';

/**
 * runtime 测试夹具（04 任务 B/C 共用）：
 * - `stubExecutor`：测试专用 EffectExecutor——解释少量 EffectData 形态驱动
 *   真实事务管线（效果注册表本体是 05 号的事），可注入失败点与产出记录；
 * - `makeRuntime` / `makeCtx`：固定种子 Rng + 最小新档状态（DD-09 / §1.3）。
 */

/** 新档版本三元组（测试基线） */
export const BASE_VERSIONS = { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' };

/** 内置函数注册表（表达式用例共用） */
export const REGISTRY = createBuiltinFunctionRegistry();

/** 桩执行器规格：failOn 指定抛错键；record 逐指令捕获 EffectContext */
export interface StubSpec {
  failOn?: string;
  record?: EffectContext[];
  childOutcomes?: ExecOutcome[];
}

/** 构造测试专用 EffectExecutor：解释少量 EffectData 形态 + 可配置失败 */
export function stubExecutor(spec: StubSpec = {}): EffectExecutor {
  const record = spec.record ?? [];
  const childOutcomes = spec.childOutcomes ?? [];
  return {
    resolve(instruction: EffectData) {
      const key = Object.keys(instruction)[0] as string;
      if (key === spec.failOn) {
        return {
          execute() {
            throw new Error(`stub failure: ${key}`);
          },
        };
      }
      return {
        ...(key === 'goto'
          ? { jumps: [{ type: 'scene', scene: (instruction as { goto: string }).goto }] as const }
          : key === 'ending'
            ? {
                jumps: [
                  { type: 'ending', ending: (instruction as { ending: string }).ending },
                ] as const,
              }
            : {}),
        execute(ctx: EffectContext) {
          record.push(ctx);
          applyStub(key, instruction, ctx, childOutcomes);
        },
      };
    },
  };
}

function applyStub(
  key: string,
  instruction: EffectData,
  ctx: EffectContext,
  childOutcomes: ExecOutcome[],
): void {
  switch (key) {
    case 'flag': {
      const arg = (instruction as { flag: { name: string; value?: boolean } }).flag;
      ctx.draft.world.flags[arg.name] = arg.value ?? true;
      return;
    }
    case 'set': {
      const arg = (instruction as { set: { key: string; value: string | number | boolean } }).set;
      if (arg.key.startsWith('attr.')) {
        ctx.draft.player.attrs[arg.key.slice(5)] = Number(arg.value);
      } else if (arg.key.startsWith('flag.')) {
        ctx.draft.world.flags[arg.key.slice(5)] = arg.value;
      } else {
        throw new Error(`stub set unsupported key: ${arg.key}`);
      }
      return;
    }
    case 'money': {
      const arg = (instruction as { money: Record<string, string | number> }).money;
      for (const [currency, amount] of Object.entries(arg)) {
        ctx.draft.player.wallet[currency] =
          (ctx.draft.player.wallet[currency] ?? 0) + Number(amount);
      }
      return;
    }
    case 'equip': {
      const arg = (instruction as { equip: { item: string } }).equip;
      ctx.draft.player.equip['weapon'] = arg.item;
      return;
    }
    case 'set_body': {
      const arg = (instruction as { set_body: { part: string; value: string } }).set_body;
      ctx.draft.player.body[arg.part] = arg.value;
      return;
    }
    case 'notify': {
      const arg = (instruction as { notify: { textKey: string; vars?: Record<string, unknown> } })
        .notify;
      ctx.emit({ type: 'notify', textKey: arg.textKey, vars: arg.vars });
      return;
    }
    case 'goto':
    case 'ending':
      return; // 跳转类：目标已在 resolve 的静态 jumps 声明，execute 不改状态
    case 'call': {
      const arg = (instruction as { call: { fn: string; with?: Record<string, unknown> } }).call;
      if (arg.fn === 'test.push_status') {
        ctx.draft.player.statuses.push({ id: 'rage' });
        return;
      }
      if (arg.fn === 'test.child') {
        const outcome = ctx.child(
          [{ notify: { textKey: 'ui.child' } }, { flag: { name: 'child_flag', value: true } }],
          { source: 'script', where: { scene: 'scene_child' }, rng: ctx.rng },
        );
        childOutcomes.push(outcome);
        return;
      }
      if (arg.fn === 'test.child_boom') {
        ctx.child([{ call: { fn: 'test.sub_boom' } }], {
          source: 'script',
          where: { scene: 'scene_child' },
          rng: ctx.rng,
        });
        return;
      }
      if (arg.fn === 'test.eval_hp') {
        const value = ctx.evalExpr(compile('attr.hp + 1'));
        ctx.draft.world.flags['hp_seen'] = String(value);
        return;
      }
      if (arg.fn === 'test.eval_max_hp') {
        const value = ctx.evalExpr(compile('attr.max_hp'));
        ctx.draft.world.flags['max_hp_seen'] = String(value);
        return;
      }
      throw new Error(`stub failure: ${arg.fn}`);
    }
    default:
      throw new Error(`stub unsupported instruction: ${key}`);
  }
}

/** 测试用表达式编译（内置注册表） */
export function compile(source: string) {
  return compileExpr(source, REGISTRY);
}

/** 派生属性定义（attr 域触碰重算用例共用） */
export const MAX_HP_ATTR_DEFS: AttrDefs = {
  numeric: {},
  level: {},
  derived: { max_hp: { formula: '10 + attr.con * 3' } },
};

/** 构造运行时（缺省桩执行器 + 固定种子 Rng） */
export function makeRuntime(init?: {
  bootstrap?: Parameters<typeof newGameState>[0];
  attrDefs?: AttrDefs;
  executor?: EffectExecutor;
  rng?: Rng;
}): GameRuntime {
  const state = newGameState(
    init?.bootstrap ?? { versions: BASE_VERSIONS, attrs: { hp: 30, con: 2 } },
    createRng(42),
  );
  return new GameRuntime({
    state,
    rng: init?.rng ?? createRng(1),
    attrDefs: init?.attrDefs,
    effectExecutor: init?.executor ?? stubExecutor(),
  });
}

/** 构造事务上下文（choice 来源 + 固定种子 Rng + 场景定位） */
export function makeCtx(overrides?: Partial<ExecContext>): ExecContext {
  return { source: 'choice', where: { scene: 'scene_tavern' }, rng: createRng(42), ...overrides };
}
