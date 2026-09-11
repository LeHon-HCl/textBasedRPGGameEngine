import { z } from 'zod';
import { createRng } from '@game/shared';
import type { EffectData, Rng } from '@game/shared';
import { compileExpr, createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { newGameState } from '../../src/state/new-game.js';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import type { ExecContext } from '../../src/runtime/exec-context.js';
import { EffectRegistry } from '../../src/effects/registry.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import type { EffectInstructionDef, EffectRegistryOptions } from '../../src/effects/types.js';

/**
 * effects 测试夹具（05 号任务共用）：
 * - `makeRegistry` / `makeEffectRuntime`：注册表与 GameRuntime 的正式接线
 *   （EffectExecutor 面），固定种子 Rng + 最小新档状态（DD-09 / §1.3）；
 * - `makeCtx`：choice 来源 + 场景定位的事务上下文；
 * - 目录夹具（ITEMS / NPCS / FACTIONS / BODY_DEFS / QUESTS）随 B 组子任务补充。
 */

/** 新档版本三元组（测试基线，与 runtime 夹具一致） */
export const BASE_VERSIONS = { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' };

/** 内置函数注册表（表达式用例共用） */
export const FX_FN_REGISTRY = createBuiltinFunctionRegistry();

/** 测试用表达式编译（内置注册表） */
export function fxCompile(source: string) {
  return compileExpr(source, FX_FN_REGISTRY);
}

/** 构造注册表（可选内置指令集与选项；A1 机制用例传自定义指令） */
export function makeRegistry(
  builtins: readonly EffectInstructionDef<unknown>[] = [],
  options: EffectRegistryOptions = {},
): EffectRegistry {
  return new EffectRegistry(options, builtins);
}

/** 效果运行时初始化项 */
export interface EffectRuntimeInit {
  /** 预构建注册表（如 createBuiltinEffectRegistry 产物；优先于 builtins/options） */
  registry?: EffectRegistry;
  /** 注册表选项（目录 / 容量 / 判定解析器等） */
  registryOptions?: EffectRegistryOptions;
  /** 内置指令集（B 组用例由 createBuiltinEffectRegistry 提供） */
  builtins?: readonly EffectInstructionDef<unknown>[];
  /** 新档 bootstrap 投影 */
  bootstrap?: Parameters<typeof newGameState>[0];
  /** 运行时 Rng（缺省固定种子 1） */
  rng?: Rng;
}

/** 构造 GameRuntime + EffectRegistry 正式接线（05 号 EffectExecutor 接线缝） */
export function makeEffectRuntime(init: EffectRuntimeInit = {}): {
  rt: GameRuntime;
  registry: EffectRegistry;
} {
  const registry = init.registry ?? makeRegistry(init.builtins ?? [], init.registryOptions);
  const state = newGameState(
    init.bootstrap ?? { versions: BASE_VERSIONS, attrs: { hp: 30, con: 2 } },
    createRng(42),
  );
  const rt = new GameRuntime({
    state,
    rng: init.rng ?? createRng(1),
    effectExecutor: registry,
  });
  return { rt, registry };
}

/** 构造装配全量内置指令的运行时（B 组用例；registryOptions 注入目录与配置） */
export function makeBuiltinRuntime(
  init: Omit<EffectRuntimeInit, 'registry' | 'builtins'> = {},
): ReturnType<typeof makeEffectRuntime> {
  return makeEffectRuntime({
    ...init,
    registry: createBuiltinEffectRegistry(init.registryOptions),
  });
}

/** 构造事务上下文（choice 来源 + 固定种子 Rng + 场景定位） */
export function makeCtx(overrides?: Partial<ExecContext>): ExecContext {
  return {
    source: 'choice',
    where: { scene: 'scene_tavern' },
    rng: createRng(42),
    ...overrides,
  };
}

/**
 * 构造作者扩展指令（DD-08 命名空间）：记录解析后的参数与收到的上下文，
 * 供注册表机制 / 生命周期用例断言。writes 声明默认 world.flags（与写入一致）。
 */
export function makeEchoDef(init?: {
  id?: string;
  writes?: readonly string[];
  onExecute?: (
    arg: { msg: string },
    ectx: Parameters<EffectInstructionDef<{ msg: string }>['execute']>[1],
  ) => void;
}): EffectInstructionDef<{ msg: string }> {
  const onExecute = init?.onExecute;
  return {
    id: init?.id ?? 'x.test.echo',
    schema: z.strictObject({ msg: z.string() }),
    touch: () => ({ reads: [], writes: init?.writes ?? ['world.flags'] }),
    execute: (arg, ectx) => {
      if (onExecute) {
        onExecute(arg, ectx);
        return;
      }
      ectx.draft.world.flags['echo'] = arg.msg;
    },
  };
}

/** 测试指令装配（EffectData 联合之外的作者扩展指令需经此宽松装配） */
export function asEffectData(instruction: object): EffectData {
  return instruction as unknown as EffectData;
}
