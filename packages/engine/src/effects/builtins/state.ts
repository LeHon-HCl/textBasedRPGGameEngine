import { effectParamSchemas } from '@game/shared';
import type { FlagValue, NpcState } from '@game/shared';
import type { WritableDraft } from 'immer';
import type { GameState } from '../../state/index.js';
import { eraseDef } from '../types.js';
import type {
  EffectArgDiagnostic,
  EffectInstructionDef,
  ErasedEffectDef,
  TouchReport,
} from '../types.js';
import { describeValue, evalLenientParam, evalNumberParam, instructionError } from './util.js';

/**
 * 状态类内置指令（设计 §3.3「set/add | 变量/属性/flag 计数 | 支持表达式值」；
 * 05 任务 B1，12 任务 4 扩 NPC 记忆命名空间）。
 *
 * - `set` / `add` 的 key 语法：`attr.<id>`（player.attrs，数值域）/
 *   `flag.<name>`（world.flags，FlagValue 开放域）/ `counter.<name>`
 *   （world.counters，数值域）/ `npc.<id>.flags.<名称>`（npcs[id].flags 独立
 *   命名空间，FR-NPCR-03：记录「见过某事件/说过某话」，供对话与事件条件引用；
 *   未知 NPC 自动建档）；未知域或空名称即 EFFECT_FAILED；
 * - 表达式值（02 号宽松语义）：字符串先按表达式求值（ectx.evalSource），
 *   编译失败回退为字面量字符串；数值域写入前强制有限 number 校验
 *   （DD-01 严格语义——宽松只放宽「字面量书写」，不放宽类型）；
 * - `add` 缺席语义：counter / flag 渐进域按 0 起算；attr 封闭域缺 key 即
 *   EFFECT_FAILED（与求值器缺席语义同口径，eval.ts）；
 * - `money`（FR-ECON-01）：多货币增减，金额可为负（支出）——结果余额 < 0
 *   报 EFFECT_FAILED（§3.3「可负值校验」），余额不为负的增减自由进行。
 */

/** set/add 支持的标量 key 域（§3.3「变量/属性/flag 计数」） */
const STATE_KEY_DOMAINS: readonly string[] = ['attr', 'flag', 'counter'];

/** NPC 记忆 key 命名空间前缀（`npc.<id>.flags.<名称>`，FR-NPCR-03） */
const NPC_FLAGS_PREFIX = 'npc.';

/** 解析后的状态 key：标量域（attr/flag/counter）或 NPC 记忆命名空间 */
type StateKey =
  | { readonly domain: 'attr' | 'flag' | 'counter'; readonly name: string }
  | { readonly domain: 'npcFlag'; readonly npc: string; readonly name: string };

/** key → touch 写域前缀（元数据面：无法解析的 key 返回空集——execute 会显性失败） */
export function stateKeyWritePrefix(key: string): readonly string[] {
  if (key.startsWith(NPC_FLAGS_PREFIX)) {
    // NPC 记忆写入 npcs 域（与 favor 的 touch 粒度一致；形态校验留给 execute）
    return ['npcs'];
  }
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

/**
 * 拆分并严格校验 key（execute 严格校验；非法形态即 EFFECT_FAILED）。
 * NPC 记忆 key 恰为四段 `npc.<id>.flags.<名称>`（id/名称均非空）。
 */
function parseStateKey(key: string, op: string): StateKey {
  if (key.startsWith(NPC_FLAGS_PREFIX)) {
    const parts = key.split('.');
    if (parts.length === 4 && parts[1] !== '' && parts[2] === 'flags' && parts[3] !== '') {
      return { domain: 'npcFlag', npc: parts[1] as string, name: parts[3] as string };
    }
    throw instructionError(op, `NPC 记忆 key 需为 'npc.<id>.flags.<名称>' 形态，实际 '${key}'`, {
      key,
    });
  }
  const dot = key.indexOf('.');
  const domain = dot > 0 ? key.slice(0, dot) : '';
  const name = dot > 0 ? key.slice(dot + 1) : '';
  if (domain === '' || name === '' || !STATE_KEY_DOMAINS.includes(domain)) {
    throw instructionError(
      op,
      `key 需为 '${STATE_KEY_DOMAINS.join('/')}.<名称>' 或 'npc.<id>.flags.<名称>' 形态，实际 '${key}'`,
      { key },
    );
  }
  return { domain: domain as 'attr' | 'flag' | 'counter', name };
}

/** 取 NPC 记录，缺席即自动建档（favor 0 / met false / 空记忆，与 favor 指令同口径） */
function ensureNpcRecord(draft: WritableDraft<GameState>, npcId: string): WritableDraft<NpcState> {
  let record = draft.npcs[npcId];
  if (record === undefined) {
    record = { favor: 0, met: false, flags: {} };
    draft.npcs[npcId] = record;
  }
  return record;
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
    /**
     * key 形态的**加载期**校验（develop.md 约束 8；设计 §7.7 `invalid-instruction-arg`）。
     *
     * 此前 key 形态只在 `execute`（运行期）校验：`set { key: 'npc.x.met' }` 这类
     * 非法形态让包加载零诊断通过、玩家点到该选项才抛 EFFECT_FAILED
     * （M1 收尾实测：渡口搭话选项卡死，见内容完整性反思报告）。
     * 本钩子把同一套判定前移到加载期——`parseStateKey` 是唯一事实源，
     * 加载期与运行期共用，避免两处规则漂移。
     */
    validateArg: (arg): readonly EffectArgDiagnostic[] => {
      try {
        parseStateKey(arg.key, 'set');
        return [];
      } catch (error) {
        return [
          {
            code: 'invalid-instruction-arg',
            severity: 'error',
            detail: error instanceof Error ? error.message : String(error),
          },
        ];
      }
    },
    execute: (arg, ectx) => {
      const parsed = parseStateKey(arg.key, 'set');
      const raw = evalLenientParam(ectx, 'set', 'value', arg.value);
      const sourceExpr = typeof arg.value === 'string' ? arg.value : String(arg.value);
      switch (parsed.domain) {
        case 'attr': {
          if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            throw instructionError('set', `属性须写入有限 number，实际为 ${describeValue(raw)}`, {
              key: arg.key,
              sourceExpr,
            });
          }
          ectx.draft.player.attrs[parsed.name] = raw;
          return;
        }
        case 'flag': {
          ectx.draft.world.flags[parsed.name] = asFlagValue(raw, 'set', sourceExpr);
          return;
        }
        case 'counter': {
          if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            throw instructionError('set', `计数器须写入有限 number，实际为 ${describeValue(raw)}`, {
              key: arg.key,
              sourceExpr,
            });
          }
          ectx.draft.world.counters[parsed.name] = raw;
          return;
        }
        default: {
          // NPC 记忆：独立命名空间（值域同 FlagValue；未知 NPC 自动建档）
          const record = ensureNpcRecord(ectx.draft, parsed.npc);
          record.flags[parsed.name] = asFlagValue(raw, 'set', sourceExpr);
          return;
        }
      }
    },
  };

  const addDef: EffectInstructionDef<{ key: string; amount: string | number }> = {
    id: 'add',
    schema: effectParamSchemas.add,
    touch: (arg): TouchReport => ({ reads: [], writes: stateKeyWritePrefix(arg.key) }),
    /** key 形态加载期校验（与 set 同一规则；见 setDef.validateArg 说明） */
    validateArg: (arg): readonly EffectArgDiagnostic[] => {
      try {
        parseStateKey(arg.key, 'add');
        return [];
      } catch (error) {
        return [
          {
            code: 'invalid-instruction-arg',
            severity: 'error',
            detail: error instanceof Error ? error.message : String(error),
          },
        ];
      }
    },
    execute: (arg, ectx) => {
      const parsed = parseStateKey(arg.key, 'add');
      const amount = evalNumberParam(ectx, 'add', 'amount', arg.amount);
      switch (parsed.domain) {
        case 'attr': {
          const current = ectx.draft.player.attrs[parsed.name];
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
          ectx.draft.player.attrs[parsed.name] = next;
          return;
        }
        case 'flag': {
          const current = ectx.draft.world.flags[parsed.name];
          if (current !== undefined && typeof current !== 'number') {
            throw instructionError(
              'add',
              `flag '${parsed.name}' 当前值非 number（${describeValue(current)}），不可累加`,
              { key: arg.key },
            );
          }
          ectx.draft.world.flags[parsed.name] =
            (typeof current === 'number' ? current : 0) + amount;
          return;
        }
        case 'counter': {
          const current = ectx.draft.world.counters[parsed.name] ?? 0;
          ectx.draft.world.counters[parsed.name] = current + amount;
          return;
        }
        default: {
          // NPC 记忆计数：未设置按 0 起算；已有非 number 值即报错（不静默覆盖）
          const record = ensureNpcRecord(ectx.draft, parsed.npc);
          const current = record.flags[parsed.name];
          if (current !== undefined && typeof current !== 'number') {
            throw instructionError(
              'add',
              `NPC 记忆 '${arg.key}' 当前值非 number（${describeValue(current)}），不可累加`,
              { key: arg.key },
            );
          }
          record.flags[parsed.name] = (typeof current === 'number' ? current : 0) + amount;
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
