import { effectParamSchemas } from '@game/shared';
import type { FlagValue } from '@game/shared';
import { eraseDef } from '../types.js';
import type { EffectInstructionDef, ErasedEffectDef, TouchReport } from '../types.js';
import { describeValue, evalLenientParam, evalNumberParam, instructionError } from './util.js';

/**
 * 状态类内置指令（设计 §3.3「set/add | 变量/属性/flag 计数 | 支持表达式值」；
 * 05 任务 B1）。
 *
 * - `set` / `add` 的 key 语法：`attr.<id>`（player.attrs，数值域）/
 *   `flag.<name>`（world.flags，FlagValue 开放域）/ `counter.<name>`
 *   （world.counters，数值域）；未知域或空名称即 EFFECT_FAILED；
 * - 表达式值（02 号宽松语义）：字符串先按表达式求值（ectx.evalSource），
 *   编译失败回退为字面量字符串；数值域写入前强制有限 number 校验
 *   （DD-01 严格语义——宽松只放宽「字面量书写」，不放宽类型）；
 * - `add` 缺席语义：counter / flag 渐进域按 0 起算；attr 封闭域缺 key 即
 *   EFFECT_FAILED（与求值器缺席语义同口径，eval.ts）；
 * - `money`（FR-ECON-01）：多货币增减，金额可为负（支出）——结果余额 < 0
 *   报 EFFECT_FAILED（§3.3「可负值校验」），余额不为负的增减自由进行。
 */

/** set/add 支持的 key 域（§3.3「变量/属性/flag 计数」） */
const STATE_KEY_DOMAINS: readonly string[] = ['attr', 'flag', 'counter'];

/** key → touch 写域前缀（元数据面：无法解析的 key 返回空集——execute 会显性失败） */
export function stateKeyWritePrefix(key: string): readonly string[] {
  const dot = key.indexOf('.');
  if (dot <= 0) return [];
  const name = key.slice(dot + 1);
  if (name === '') return [];
  switch (key.slice(0, dot)) {
    case 'attr':
      return ['player.attrs'];
    case 'flag':
      return ['world.flags'];
    case 'counter':
      return ['world.counters'];
    default:
      return [];
  }
}

/** 拆分 '<域>.<名称>' key（execute 严格校验） */
function parseStateKey(key: string, op: string): { domain: string; name: string } {
  const dot = key.indexOf('.');
  const domain = dot > 0 ? key.slice(0, dot) : '';
  const name = dot > 0 ? key.slice(dot + 1) : '';
  if (domain === '' || name === '' || !STATE_KEY_DOMAINS.includes(domain)) {
    throw instructionError(
      op,
      `key 需为 '${STATE_KEY_DOMAINS.join('/')}.<名称>' 形态，实际 '${key}'`,
      { key },
    );
  }
  return { domain, name };
}

/** flag 值域守卫（world.flags：boolean | number | string） */
function asFlagValue(value: unknown, op: string, sourceExpr: string): FlagValue {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  throw instructionError(
    op,
    `flag 值须为 boolean | number | string，实际为 ${describeValue(value)}`,
    { sourceExpr },
  );
}

/** 状态类指令全集（id 固定，§3.3 表格） */
export function createStateDefs(): ErasedEffectDef[] {
  const setDef: EffectInstructionDef<{ key: string; value: string | number | boolean }> = {
    id: 'set',
    schema: effectParamSchemas.set,
    touch: (arg): TouchReport => ({ reads: [], writes: stateKeyWritePrefix(arg.key) }),
    execute: (arg, ectx) => {
      const { domain, name } = parseStateKey(arg.key, 'set');
      const raw = evalLenientParam(ectx, 'set', 'value', arg.value);
      const sourceExpr = typeof arg.value === 'string' ? arg.value : String(arg.value);
      switch (domain) {
        case 'attr': {
          if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            throw instructionError('set', `属性须写入有限 number，实际为 ${describeValue(raw)}`, {
              key: arg.key,
              sourceExpr,
            });
          }
          ectx.draft.player.attrs[name] = raw;
          return;
        }
        case 'flag': {
          ectx.draft.world.flags[name] = asFlagValue(raw, 'set', sourceExpr);
          return;
        }
        default: {
          if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            throw instructionError('set', `计数器须写入有限 number，实际为 ${describeValue(raw)}`, {
              key: arg.key,
              sourceExpr,
            });
          }
          ectx.draft.world.counters[name] = raw;
          return;
        }
      }
    },
  };

  const addDef: EffectInstructionDef<{ key: string; amount: string | number }> = {
    id: 'add',
    schema: effectParamSchemas.add,
    touch: (arg): TouchReport => ({ reads: [], writes: stateKeyWritePrefix(arg.key) }),
    execute: (arg, ectx) => {
      const { domain, name } = parseStateKey(arg.key, 'add');
      const amount = evalNumberParam(ectx, 'add', 'amount', arg.amount);
      switch (domain) {
        case 'attr': {
          const current = ectx.draft.player.attrs[name];
          if (current === undefined) {
            throw instructionError(
              'add',
              `未知属性 '${arg.key}'（封闭域缺 key 视为状态完整性问题）`,
              { key: arg.key },
            );
          }
          const next = current + amount;
          if (!Number.isFinite(next)) {
            throw instructionError(
              'add',
              `属性累加结果非有限值：${String(current)} + ${String(amount)}`,
              {
                key: arg.key,
              },
            );
          }
          ectx.draft.player.attrs[name] = next;
          return;
        }
        case 'flag': {
          const current = ectx.draft.world.flags[name];
          if (current !== undefined && typeof current !== 'number') {
            throw instructionError(
              'add',
              `flag '${name}' 当前值非 number（${describeValue(current)}），不可累加`,
              { key: arg.key },
            );
          }
          ectx.draft.world.flags[name] = (typeof current === 'number' ? current : 0) + amount;
          return;
        }
        default: {
          const current = ectx.draft.world.counters[name] ?? 0;
          ectx.draft.world.counters[name] = current + amount;
          return;
        }
      }
    },
  };

  const flagDef: EffectInstructionDef<{ name: string; value?: boolean }> = {
    id: 'flag',
    schema: effectParamSchemas.flag,
    touch: (): TouchReport => ({ reads: [], writes: ['world.flags'] }),
    execute: (arg, ectx) => {
      ectx.draft.world.flags[arg.name] = arg.value ?? true;
    },
  };

  const moneyDef: EffectInstructionDef<Record<string, string | number>> = {
    id: 'money',
    schema: effectParamSchemas.money,
    touch: (): TouchReport => ({ reads: [], writes: ['player.wallet'] }),
    execute: (arg, ectx) => {
      for (const [currency, amountSpec] of Object.entries(arg)) {
        const amount = evalNumberParam(ectx, 'money', currency, amountSpec);
        const current = ectx.draft.player.wallet[currency] ?? 0;
        const next = current + amount;
        if (next < 0) {
          throw instructionError(
            'money',
            `货币 '${currency}' 余额不足：当前 ${String(current)}，变动 ${String(amount)}，结果 ${String(next)} < 0`,
            { currency },
          );
        }
        ectx.draft.player.wallet[currency] = next;
      }
    },
  };

  return [eraseDef(setDef), eraseDef(addDef), eraseDef(flagDef), eraseDef(moneyDef)];
}
