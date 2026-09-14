import { effectParamSchemas } from '@game/shared';
import { z } from 'zod';
import type { EffectRegistryOptions } from '../types.js';
import { eraseDef } from '../types.js';
import type {
  EffectExecuteContext,
  EffectInstructionDef,
  ErasedEffectDef,
  TouchReport,
} from '../types.js';
import type { JumpTarget } from '../../runtime/index.js';
import { evalNumberParam, instructionError } from './util.js';

/**
 * 对抗类与身体内置指令（设计 §3.3 check / battle / set_body；05 任务 B6）。
 *
 * - `check`（§5.1 / FR-CMBT）：判定路由骨架——调用注入的 CheckRuleResolver
 *   （接口定义于本模块 types.ts，15 号实现 coc/generic 与脚本扩展规则），把
 *   结果 emit 为 `check_result` 事件，并按 outcome/level 选择作者声明的子效果
 *   批经 `child` 原子执行（critical → onCritical ?? onSuccess，fumble →
 *   onFumble ?? onFail，其余按 outcome 回退）。未注入解析器或规则缺失即
 *   EFFECT_FAILED（显性化）；本指令自身不改状态（分支子效果是独立指令）；
 * - `battle`（§5.2 / DD-11）：jump 类——只产 `{type: 'battle', encounter}`
 *   跳转；胜负逃子效果（onVictory/onDefeat/onEscape）由战斗会话（16 号）
 *   结算后经 child 原子批执行，本模块不执行、不路由；
 * - `set_body`（§4.8 / FR-BODY-01）：part/value 值域 ∈ BodyDef 校验（目录
 *   由 options.bodyDefs 注入，未注入时不校验值域）；revertAfter（临时变身
 *   回退，§4.8）为**预留字段**——本模块仅做形态校验（slots/days 至少其一、
 *   数值须为正整数或表达式），回退执行与 BodyReverted 事件归 14 号管线。
 */

type CheckParams = z.output<typeof effectParamSchemas.check>;
type BattleParams = z.output<typeof effectParamSchemas.battle>;
type SetBodyParams = z.output<typeof effectParamSchemas.set_body>;

/** check 参数 schema：02 号 checkParams + 奖惩骰非负整数细化（表达式交运行期求值） */
const checkSchema = effectParamSchemas.check;

/**
 * set_body 参数 schema：02 号 setBodyParams 的兼容细化——revertAfter 存在时
 * slots/days 至少其一，数值须为正整数（字符串按表达式留给 14 号求值）。
 */
const setBodySchema = effectParamSchemas.set_body.refine(
  (val) => {
    const revert = val.revertAfter;
    if (revert === undefined) return true;
    const durations = [revert.slots, revert.days];
    const present = durations.filter((d) => d !== undefined);
    if (present.length === 0) return false;
    return present.every((d) => typeof d === 'string' || (Number.isInteger(d) && d > 0));
  },
  { message: 'revertAfter 需要 slots/days 之一，数值须为正整数（§4.8）' },
);

/** 非负整数参数求值（奖惩骰数量等） */
function evalNonNegativeIntParam(
  ectx: EffectExecuteContext,
  op: string,
  param: string,
  value: string | number,
): number {
  const result = evalNumberParam(ectx, op, param, value);
  if (!Number.isInteger(result) || result < 0) {
    throw instructionError(op, `参数 ${param} 须为非负整数，实际 ${String(result)}`, {
      param,
      sourceExpr: typeof value === 'string' ? value : String(value),
    });
  }
  return result;
}

/** 对抗类与身体指令全集（id 固定，§3.3 表格） */
export function createAdversarialDefs(options: EffectRegistryOptions): ErasedEffectDef[] {
  const checkDef: EffectInstructionDef<CheckParams> = {
    id: 'check',
    schema: checkSchema,
    touch: (): TouchReport => ({ reads: [], writes: [] }),
    execute: (arg, ectx) => {
      const resolver = options.checkResolver;
      if (resolver === undefined) {
        throw instructionError(
          'check',
          '未注入判定规则解析器（CheckRuleResolver，15 号实现 coc/generic）',
          { rule: arg.rule ?? 'coc' },
        );
      }
      const ruleId = arg.rule ?? 'coc';
      const rule = resolver.resolve(ruleId);
      if (rule === undefined) {
        throw instructionError('check', `未知判定规则 '${ruleId}'`, { rule: ruleId });
      }
      const value = evalNumberParam(ectx, 'check', 'value', arg.value);
      const bonusDice =
        arg.bonusDice !== undefined
          ? evalNonNegativeIntParam(ectx, 'check', 'bonusDice', arg.bonusDice)
          : undefined;
      const penaltyDice =
        arg.penaltyDice !== undefined
          ? evalNonNegativeIntParam(ectx, 'check', 'penaltyDice', arg.penaltyDice)
          : undefined;
      const opposedValue =
        arg.opposedValue !== undefined
          ? evalNumberParam(ectx, 'check', 'opposedValue', arg.opposedValue)
          : undefined;
      const result = rule.resolve(
        {
          rule: ruleId,
          value,
          ...(arg.difficulty !== undefined ? { difficulty: arg.difficulty } : {}),
          ...(bonusDice !== undefined ? { bonusDice } : {}),
          ...(penaltyDice !== undefined ? { penaltyDice } : {}),
          ...(opposedValue !== undefined ? { opposedValue } : {}),
        },
        ectx.rng,
      );
      ectx.emit({
        type: 'check_result',
        rule: ruleId,
        outcome: result.outcome,
        level: result.level,
        rolls: result.rolls,
        detail: result.detail,
      });
      const branch =
        result.level === 'critical'
          ? (arg.onCritical ?? arg.onSuccess)
          : result.level === 'fumble'
            ? (arg.onFumble ?? arg.onFail)
            : result.outcome === 'success'
              ? arg.onSuccess
              : arg.onFail;
      if (branch !== undefined && branch.length > 0) {
        ectx.child(branch, { source: 'hook', where: { ...ectx.where }, rng: ectx.rng });
      }
    },
  };

  const battleDef: EffectInstructionDef<BattleParams> = {
    id: 'battle',
    schema: effectParamSchemas.battle,
    touch: (): TouchReport => ({ reads: [], writes: [] }),
    execute: () => {},
    jumps: (arg): readonly JumpTarget[] => [{ type: 'battle', battle: arg.encounter }],
  };

  const setBodyDef: EffectInstructionDef<SetBodyParams> = {
    id: 'set_body',
    schema: setBodySchema,
    touch: (): TouchReport => ({
      reads: [],
      writes: ['player.body', 'player.bodyProgress', 'player.bodyTemp'],
    }),
    execute: (arg, ectx) => {
      const parts = options.bodyDefs?.parts;
      if (parts !== undefined) {
        const part = parts[arg.part];
        if (part === undefined) {
          throw instructionError('set_body', `未知身体部位 '${arg.part}'（BodyDef）`, {
            part: arg.part,
          });
        }
        if (!part.values.includes(arg.value)) {
          throw instructionError(
            'set_body',
            `部位 '${arg.part}' 不存在取值 '${arg.value}'（值域 ∈ BodyDef）`,
            { part: arg.part, value: arg.value },
          );
        }
      }
      const previousValue = ectx.draft.player.body[arg.part];
      ectx.draft.player.body[arg.part] = arg.value;
      // 渐进变身进度（FR-BODY-05 P2 预留）：省略 = 键级保留；0..100 由 schema 校验
      if (arg.progress !== undefined) {
        ectx.draft.player.bodyProgress[arg.part] = arg.progress;
      }
      if (arg.revertAfter !== undefined) {
        // 临时变身登记（FR-BODY-02，14 号）：剩余时段直存（days 按当日时段数
        // 换算）；同部位重复登记保留首次的 original（避免中间态被固化）
        const remainingSlots = evalRevertSlots(ectx, arg.revertAfter, options);
        const existing = ectx.draft.player.bodyTemp[arg.part];
        // 原值取首次登记前的值；部位此前不存在时以 BodyDef 默认值兜底
        //（无 BodyDef 时回退空串——还原为「未设置」，不阻塞事务）
        const original = existing?.original ?? previousValue ?? parts?.[arg.part]?.default ?? '';
        ectx.draft.player.bodyTemp[arg.part] = { original, remainingSlots };
      }
    },
  };

  return [eraseDef(checkDef), eraseDef(battleDef), eraseDef(setBodyDef), bodyRevertDef()];
}

/**
 * revertAfter 时长求值（slots 优先；days 按当日时段数换算）。
 * TimeConfig 未注入时按每日 1 时段兜底？——不：缺 Config 无法换算，显性报错。
 */
function evalRevertSlots(
  ectx: EffectExecuteContext,
  revert: { slots?: string | number; days?: string | number },
  options: EffectRegistryOptions,
): number {
  const slots = revert.slots;
  const days = revert.days;
  if (slots !== undefined) {
    return evalPositiveIntParam(ectx, 'set_body', 'revertAfter.slots', slots);
  }
  if (days === undefined) {
    throw instructionError('set_body', 'revertAfter 需要 slots 或 days 之一', {});
  }
  const dayCount = evalPositiveIntParam(ectx, 'set_body', 'revertAfter.days', days);
  const slotsPerDay = options.timeConfig?.slots.length;
  if (slotsPerDay === undefined) {
    throw instructionError(
      'set_body',
      'revertAfter.days 需要 TimeConfig（每日时段数）换算；未注入时请改用 slots',
      {},
    );
  }
  return dayCount * slotsPerDay;
}

/** 正整数参数求值（revertAfter 时长；0/负数/小数拒绝） */
function evalPositiveIntParam(
  ectx: EffectExecuteContext,
  op: string,
  param: string,
  value: string | number,
): number {
  const resolved = evalNonNegativeIntParam(ectx, op, param, value);
  if (resolved < 1) {
    throw instructionError(op, `参数 ${param} 须为正整数，实际 ${String(resolved)}`, {
      param,
      sourceExpr: typeof value === 'string' ? value : String(value),
    });
  }
  return resolved;
}

/**
 * `__body.revert` 内部指令（FR-BODY-02，§4.3 步骤 3，14 号）。
 * **引擎内部面，不面向作者**——由时间管线经 createBodyRevertProvider 挂载。
 *
 * 递减全部临时项剩余时段；归零者还原原值 + emit body_reverted + 清除登记。
 */
function bodyRevertDef(): ErasedEffectDef {
  const def: EffectInstructionDef<{ elapsedSlots: number }> = {
    id: '__body.revert',
    schema: z.strictObject({ elapsedSlots: z.number().int().min(0) }),
    touch: (): TouchReport => ({ reads: [], writes: ['player.body', 'player.bodyTemp'] }),
    execute: (arg, ectx) => {
      const temp = ectx.draft.player.bodyTemp;
      for (const [part, entry] of Object.entries(temp)) {
        entry.remainingSlots -= arg.elapsedSlots;
        if (entry.remainingSlots > 0) continue;
        ectx.draft.player.body[part] = entry.original;
        ectx.emit({ type: 'body_reverted', part, restored: entry.original });
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete temp[part];
      }
    },
  };
  return eraseDef(def);
}
