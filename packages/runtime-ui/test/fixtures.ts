import { createRng } from '@game/shared';
import type { EffectData, Rng } from '@game/shared';
import { GameRuntime, newGameState } from '@game/engine';
import type { EffectContext, EffectExecutor, EngineEvent, ExecOutcome } from '@game/engine';

/**
 * runtime-ui 测试夹具（25 号 A 组共用）。
 *
 * 组件测试的运行时桩：只解释本模块用例真正会驱动的指令形态
 * （notify / set / add / emit），其余抛错——保证测试不隐式依赖效果指令系统
 * （05 号）的完整实现，符合设计 §1.3「每个模块的测试不得依赖其他运行中模块」。
 */

/** 新档版本三元组（与 engine 测试基线同口径） */
export const BASE_VERSIONS = {
  gameVersion: '1.0.0',
  schemaVersion: 1,
  minEngineVersion: '0.0.1',
} as const;

/**
 * 桩执行器：支持四种指令形态。
 * - `notify`：发 NotifyEvent（FR-UI-07 Toast 数据面）；
 * - `set` / `add`：写 `attr.*` 并让运行时按补丁派生 stat_changed（FR-STAT-04）；
 * - `__test.emit`：直接发一条 EngineEvent（见 {@link emitEvent}）——正式指令集
 *   没有「发任意事件」的通用入口（DD-06 事件由业务指令 emit），此形态仅存在于
 *   测试桩，不会进入产品代码。
 */
export function stubExecutor(): EffectExecutor {
  return {
    resolve(instruction: EffectData) {
      const key = Object.keys(instruction)[0] as string;
      switch (key) {
        case 'notify': {
          const arg = (
            instruction as { notify: { textKey: string; vars?: Record<string, unknown> } }
          ).notify;
          return {
            execute(ctx: EffectContext) {
              ctx.emit({
                type: 'notify',
                textKey: arg.textKey,
                ...(arg.vars !== undefined ? { vars: arg.vars } : {}),
              });
            },
          };
        }
        case 'set': {
          const arg = (instruction as { set: { key: string; value: number } }).set;
          return {
            execute(ctx: EffectContext) {
              const name = arg.key.startsWith('attr.') ? arg.key.slice('attr.'.length) : arg.key;
              ctx.draft.player.attrs[name] = arg.value;
            },
          };
        }
        case 'add': {
          const arg = (instruction as { add: { key: string; amount: number } }).add;
          return {
            execute(ctx: EffectContext) {
              const name = arg.key.startsWith('attr.') ? arg.key.slice('attr.'.length) : arg.key;
              ctx.draft.player.attrs[name] = (ctx.draft.player.attrs[name] ?? 0) + arg.amount;
            },
          };
        }
        case '__test.emit': {
          const arg = (instruction as unknown as { '__test.emit': { event: EngineEvent } })[
            '__test.emit'
          ];
          return {
            execute(ctx: EffectContext) {
              ctx.emit(arg.event);
            },
          };
        }
        default:
          return {
            execute() {
              throw new Error(`stub executor 不支持指令 '${key}'`);
            },
          };
      }
    },
  };
}

/**
 * 把任意 EngineEvent 包装成测试桩可解释的指令（仅测试使用）。
 * 事件桥用例需要「运行时发出某事件」而非走真实业务指令，正式指令集里没有
 * 这种通用入口（DD-06 事件由业务指令 emit），故以桩形态提供。
 */
export function emitEvent(event: EngineEvent): EffectData {
  return { '__test.emit': { event } } as unknown as EffectData;
}

/** 构造测试运行时（固定种子 + 桩执行器 + 最小新档） */
export function makeRuntime(init?: { attrs?: Record<string, number>; rng?: Rng }): GameRuntime {
  const rng = init?.rng ?? createRng(7);
  const state = newGameState(
    { versions: { ...BASE_VERSIONS }, attrs: { hp: 10, insight: 0, ...init?.attrs } },
    rng,
  );
  return new GameRuntime({ state, rng, effectExecutor: stubExecutor() });
}

/** 事务上下文（source=choice + 固定种子，与 engine 测试同口径） */
export function makeCtx(): { source: 'choice'; where: { scene: string }; rng: Rng } {
  return { source: 'choice', where: { scene: 'arrival' }, rng: createRng(11) };
}

/** 执行一批指令并返回产出（测试里省去每处 import 断言面） */
export function exec(runtime: GameRuntime, effects: readonly EffectData[]): ExecOutcome {
  return runtime.exec(effects, makeCtx());
}
