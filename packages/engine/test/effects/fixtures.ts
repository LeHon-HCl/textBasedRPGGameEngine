import { z } from 'zod';
import { createRng } from '@game/shared';
import type { BodyDef, EffectData, FactionDef, ItemDef, NpcDef, QuestDef, Rng } from '@game/shared';
import { compileExpr, createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { newGameState } from '../../src/state/new-game.js';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import type { ExecContext } from '../../src/runtime/exec-context.js';
import { EffectRegistry } from '../../src/effects/registry.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import type { CheckRule } from '../../src/effects/types.js';
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

/** 物品目录夹具（B2 用例：equip / garment / normal 三类覆盖） */
export const ITEMS: ReadonlyMap<string, ItemDef> = new Map(
  (
    [
      { id: 'item_sword', nameKey: 'item.sword', type: 'equip', equipSlot: 'weapon' },
      { id: 'item_ring', nameKey: 'item.ring', type: 'equip', equipSlot: 'finger' },
      {
        id: 'item_cotton_shirt',
        nameKey: 'item.cotton_shirt',
        type: 'garment',
        garment: { part: 'chest', layer: 1 },
      },
      {
        id: 'item_wool_coat',
        nameKey: 'item.wool_coat',
        type: 'garment',
        garment: { part: 'chest', layer: 2 },
      },
      { id: 'item_herb', nameKey: 'item.herb', type: 'normal', stack: 9 },
      { id: 'item_herb_green', nameKey: 'item.herb_green', type: 'normal', stack: 9 },
    ] as ItemDef[]
  ).map((def) => [def.id, def]),
);

/** NPC 目录夹具（B3 用例：好感区间 + 阶段阈值；mira 无好感系统） */
export const NPCS: ReadonlyMap<string, NpcDef> = new Map(
  (
    [
      {
        id: 'npc_raven',
        nameKey: 'npc.raven.name',
        favor: {
          min: -100,
          max: 100,
          stages: [
            { id: 'stage_stranger', at: -100, nameKey: 'npc.raven.stage.stranger' },
            { id: 'stage_friendly', at: 30, nameKey: 'npc.raven.stage.friendly' },
            { id: 'stage_bonded', at: 70, nameKey: 'npc.raven.stage.bonded' },
          ],
        },
      },
      {
        id: 'npc_wren',
        nameKey: 'npc.wren.name',
        favor: {
          min: -100,
          max: 100,
          stages: [{ id: 'stage_active', at: 0, nameKey: 'npc.wren.stage.active' }],
        },
      },
      { id: 'npc_mira', nameKey: 'npc.mira.name' },
    ] as NpcDef[]
  ).map((def) => [def.id, def]),
);

/** 阵营目录夹具（B3 用例：波段阈值；guild 无阈值表） */
export const FACTIONS: ReadonlyMap<string, FactionDef> = new Map(
  (
    [
      {
        id: 'faction_town',
        nameKey: 'faction.town.name',
        init: 0,
        thresholds: [
          { id: 'band_hostile', at: -50, nameKey: 'faction.town.band.hostile' },
          { id: 'band_neutral', at: 0, nameKey: 'faction.town.band.neutral' },
          { id: 'band_honored', at: 50, nameKey: 'faction.town.band.honored' },
        ],
      },
      { id: 'faction_guild', nameKey: 'faction.guild.name', init: 10 },
    ] as FactionDef[]
  ).map((def) => [def.id, def]),
);

/** 任务目录夹具（B5 用例：三阶段任务，阶段序驱动 advance 缺省推导） */
export const QUESTS: ReadonlyMap<string, QuestDef> = new Map(
  (
    [
      {
        id: 'quest_delivery',
        giver: 'npc_raven',
        stages: [
          {
            id: 'stage_pickup',
            objectiveKey: 'quest.delivery.pickup',
            completeWhen: 'flag("pkg")',
          },
          {
            id: 'stage_deliver',
            objectiveKey: 'quest.delivery.deliver',
            completeWhen: 'flag("delivered")',
          },
          {
            id: 'stage_report',
            objectiveKey: 'quest.delivery.report',
            completeWhen: 'flag("reported")',
          },
        ],
      },
    ] as QuestDef[]
  ).map((def) => [def.id, def]),
);

/** 身体定义夹具（B6 用例：set_body 值域校验，FR-BODY-01） */
export const BODY_DEFS: BodyDef = {
  parts: {
    build: { values: ['slender', 'sturdy'], default: 'slender' },
    hair: { values: ['short', 'long'], default: 'short' },
  },
};

/**
 * 判定规则测试桩（§5.1 CheckRule 契约）：返回脚本化结果——真正的 coc/generic
 * 规则实现属 15 号；rolls 记录经注入 rng 消耗一次随机（DD-09 确定性）。
 */
export function scriptedCheckRule(result: {
  outcome: 'success' | 'fail';
  level: 'critical' | 'extreme' | 'hard' | 'normal' | 'fail' | 'fumble';
}): CheckRule {
  return {
    id: 'test_scripted',
    resolve: (req, rng) => {
      const roll = rng.int(1, 100);
      return {
        rolls: [roll],
        level: result.level,
        outcome: result.outcome,
        detail: { requested: req.value },
      };
    },
  };
}

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
