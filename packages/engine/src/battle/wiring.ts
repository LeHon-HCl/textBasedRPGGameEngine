import type { EffectData, EncounterDef, GameId, Rng } from '@game/shared';
import { EngineError } from '@game/shared';
import type { GameDefinition } from '../loader/types.js';
import type { ExecContext, GameRuntime } from '../runtime/index.js';
import { compileExpr, evalExpr, truthy } from '../expr-eval/index.js';
import { buildExprScope } from '../state/index.js';
import { createAiResolver } from './ai.js';
import { createDefaultDamageFn } from './damage.js';
import type { DamagePresetResolver } from './damage.js';
import type { DamageFn } from './types.js';
import { buildOutcomeEffects, type OutcomeBranches } from './outcome.js';
import { createEffectExecutor } from './resolution.js';
import { BattleSession } from './session.js';
import type { AiActionSpec, BattleUnit, SkillRef } from './types.js';
import { instantiateEncounter, playerUnitFromState } from './units.js';

/**
 * battle 指令接线层（detail-design §5.2 / DD-11，16 号 W2 子任务 8 收口）。
 *
 * scene-runner 对 battle jump 的口径是「留待宿主消费」（`#consumeJumps` default
 * 分支）——本文件就是宿主（25 号 game-host / 26 号编辑器试玩）消费 battle jump
 * 的标准装配：EncounterDef 查表 → 遭遇实例化 → 会话创建（结算/AI/附加效果缝
 * 全部接通）→ 终局后 {@link BattleController.pollOutcome} 一次性执行路由效果
 * （rewards + on_victory/on_defeat/on_escape，child 事务，source='battle'）。
 *
 * 边界（DD-11）：引擎侧不驱动玩家输入、不读叙事栈；宿主驱动 session.playerAction
 * 并在每次行动后 pollOutcome。
 */

export interface BattleWiringInput {
  definition: GameDefinition;
  runtime: GameRuntime;
  /** battle 指令引用的遭遇 id（加载期 refId 已核对存在性，此处防御性再查） */
  encounterId: GameId;
  /** on_victory / on_defeat / on_escape 分支（battle 指令参数面） */
  branches: OutcomeBranches;
  /** 玩家参战技能表（W6 遭遇数据或宿主装配；FR-CMBT-07 玩家侧技能声明面） */
  playerSkills: SkillRef[];
  /** 会话随机源（宿主传入；与叙事随机是否同源由宿主裁定，DD-09） */
  rng: Rng;
  /** 表达式求值缝（AI when 条件；战斗内作用域的表达式桥接归 W6/25B，缺省恒真） */
  evalCondition?: (source: string) => boolean;
  /**
   * 伤害预设解析器（16 号 W4 留的口子，23 号 C 线打通）：注入后按名取公式；
   * 缺省用内置默认公式（`atk*mult − def`，defend 减半）。
   * 作者脚本经 `ScriptSetupApi.registerEffect` 无法注册预设——
   * 脚本注册面见 {@link damagePresetName}（脚本模块 setup 期经宿主收集）。
   */
  readonly damagePresets?: DamagePresetResolver;
  /** 本场战斗使用的伤害预设名（缺省 'default'；未知名 → 显性化报错） */
  readonly damagePresetName?: string;
  /** 事务定位（EFFECT_FAILED 错误卡片） */
  where?: { scene: GameId };
}

export interface BattleOutcome {
  outcome: 'victory' | 'defeat' | 'escaped';
  /** 已执行的终局效果序列（rewards + 对应分支；表现层展示用） */
  effects: readonly EffectData[];
  /**
   * 路由效果产出的流程跳转（goto/back/ending…）：宿主**必须**注回叙事会话
   * （runner.applyFlowJumps）——on_victory 的场景跳转由此回流（FR-CMBT-11）。
   */
  jumps: readonly import('../runtime/index.js').JumpTarget[];
}

export interface BattleController {
  readonly session: BattleSession;
  readonly encounter: EncounterDef;
  /**
   * 终局消费（幂等）：会话未终局返回 null；终局后**首次**调用执行路由效果
   * （一批 child 事务，source='battle'）并返回结局。
   */
  pollOutcome(): BattleOutcome | null;
}

export function createBattleController(input: BattleWiringInput): BattleController {
  const encounter = input.definition.encounters.get(input.encounterId);
  if (encounter === undefined) {
    throw new EngineError({
      code: 'DANGLING_REF',
      where: {
        op: 'battle',
        encounter: input.encounterId,
        detail: `battle 指令引用不存在的遭遇（加载期 crossRef 应已拦截，此处防御性再报）`,
      },
      messageKey: 'error.loader.danglingRef',
    });
  }
  const baseCtx = (rng: Rng): ExecContext => ({
    source: 'battle',
    where: { scene: input.where?.scene ?? 'battle', battle: input.encounterId },
    rng,
  });

  const executor = createEffectExecutor({
    // 伤害公式：B 线默认预设（`atk*mult − def`）；命名预设切换随宿主装配扩展
    damageFn: resolveDamageFn(input),
    // 附加效果缝：SkillRef.effects 经 runtime child 事务执行（DD-11 缝）
    applyEffects: (effects, _actor, ectx) => {
      input.runtime.exec(effects, baseCtx(ectx.rng));
    },
  });
  // —— AI when 条件的战斗表达式域（16 号偏差③，battle.* v1 清单已获人类确认）——
  // 行动者上下文经「行动前登记」传递（aiResolve 与 when 求值在同一同步调用链内）；
  // 求值作用域 = 叙事基座（供 x.* 脚本函数取参）+ battle 视图覆盖。
  const compiledCache = new Map<string, ReturnType<typeof compileExpr>>();
  let currentActor: BattleUnit | undefined;
  const battleEvalCondition = (source: string): boolean => {
    const actor = currentActor;
    if (actor === undefined) {
      throw new EngineError({
        code: 'EFFECT_FAILED',
        where: { op: 'battle.ai', detail: 'when 求值时无行动者上下文（装配缺陷）' },
        messageKey: 'error.effects.instructionFailed',
      });
    }
    let compiled = compiledCache.get(source);
    if (compiled === undefined) {
      compiled = compileExpr(source, input.definition.functionRegistry);
      compiledCache.set(source, compiled);
    }
    const units = session.units();
    const opposing: ReadonlyArray<BattleUnit['side']> =
      actor.side === 'enemy' ? ['player', 'ally'] : ['enemy'];
    const allies: ReadonlyArray<BattleUnit['side']> =
      actor.side === 'enemy' ? ['enemy'] : ['player', 'ally'];
    const scope = {
      ...buildExprScope(input.runtime.state),
      battle: {
        self: { hp: actor.hp, maxHp: actor.maxHp, attrs: actor.attrs },
        enemiesAlive: units.filter((u) => u.hp > 0 && opposing.includes(u.side)).length,
        alliesAlive: units.filter((u) => u.hp > 0 && allies.includes(u.side)).length,
        round: session.round(),
      },
    };
    return truthy(
      evalExpr(compiled, {
        state: scope,
        rng: input.rng,
        registry: input.definition.functionRegistry,
      }),
    );
  };
  const aiResolve = createAiResolver({
    rng: input.rng,
    evalCondition: input.evalCondition ?? battleEvalCondition,
  });
  const resolveWithActor = (unit: BattleUnit): AiActionSpec => {
    currentActor = unit;
    return aiResolve(unit);
  };

  const player = playerUnitFromState(input.runtime.state, { skills: input.playerSkills });
  const session = new BattleSession(
    instantiateEncounter(encounter, input.definition.enemies, player),
    {
      rng: input.rng,
      aiResolve: resolveWithActor,
      executeAction: executor,
    },
  );

  let settled = false;
  return {
    session,
    encounter,
    pollOutcome(): BattleOutcome | null {
      const result = session.result();
      if (result === null || settled) return null;
      settled = true;
      const effects = buildOutcomeEffects(result, encounter, input.branches);
      let jumps: readonly import('../runtime/index.js').JumpTarget[] = [];
      if (effects.length > 0) {
        // 一批 child 事务（原子）：奖励入账/flag/跳转意图一次提交，失败整体回滚
        const outcome = input.runtime.exec(effects, baseCtx(input.rng));
        jumps = outcome.jumps;
      }
      return { outcome: result.outcome, effects, jumps };
    },
  };
}

/**
 * 解析本场战斗的伤害公式（16 号 W4 的「可插拔预设」在 23 号打通）。
 *
 * 优先级：声明的预设名（经解析器）→ 内置默认公式。
 * 预设名未注册 → **ERROR（不静默回落）**——公式被悄悄换掉是调试黑洞
 * （与 damage.ts 的 register 重复检测同一立场）。
 */
function resolveDamageFn(input: BattleWiringInput): DamageFn {
  const name = input.damagePresetName;
  if (name === undefined || name === 'default') return createDefaultDamageFn();
  const presets = input.damagePresets;
  if (presets === undefined) {
    throw new EngineError({
      code: 'EFFECT_FAILED',
      where: {
        op: 'battle.damage',
        preset: name,
        detail: `声明了伤害预设 '${name}' 但未注入解析器（宿主装配缺陷）`,
      },
      messageKey: 'error.effects.instructionFailed',
    });
  }
  const fn = presets.resolve(name);
  if (fn === null) {
    throw new EngineError({
      code: 'EFFECT_FAILED',
      where: {
        op: 'battle.damage',
        preset: name,
        detail: `伤害预设 '${name}' 未注册（脚本未加载或名称拼写错误）`,
      },
      messageKey: 'error.effects.instructionFailed',
    });
  }
  return fn;
}
