import { effectParamSchemas } from '@game/shared';
import { z } from 'zod';
import type { BuiltinDefContext, EffectRegistryOptions } from '../types.js';
import { eraseDef } from '../types.js';
import type { EffectInstructionDef, ErasedEffectDef, TouchReport } from '../types.js';
import type { MediaIntent } from '../../runtime/index.js';
import { advanceClock } from '../../time/clock.js';
import { evalLenientParam, evalNumberParam, instructionError } from './util.js';

/**
 * 系统类内置指令（设计 §3.3；call 于 05 任务 A3 登记，advance_time / quest /
 * unlock / notify / media 于 05 任务 B5 登记）。
 */

/** 作者扩展命名空间形态（DD-08）：x.<script>.<name>，段为 GameId 形态 */
const X_NAMESPACE_PATTERN = /^x\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** notify 参数（02 号 notifyParams 推断；vars 值为宽松字面量/表达式） */
type NotifyParams = z.output<typeof effectParamSchemas.notify>;

/** unlock 参数（02 号 unlockParams 推断：kind 判别联合） */
type UnlockParams = z.output<typeof effectParamSchemas.unlock>;

/** media 参数（02 号 mediaParams 推断：DD-05 媒体意图判别联合） */
type MediaParams = z.output<typeof effectParamSchemas.media>;

/**
 * `call` 指令（§3.3 / DD-08 / FR-SCR-04 / FR-SCR-05）：调用作者扩展指令。
 *
 * - 仅做存在性校验后转发：fn 必须 `x.<script>.<name>`（内置指令不经 call），
 *   目标须已注册（脚本宿主在加载期注入后注册表冻结）；缺失即 EFFECT_FAILED
 *   （显性化，不静默跳过）；
 * - 转发沿用目标定义的参数 schema（`with` 载荷）、静态跳转声明与 touch 声明
 *   （FR-SCR-05：作者指令自行声明存档触碰，call 层委托查询；目标缺失时回退
 *   空声明）；
 * - 嵌套上下文：目标与 call 共享同一 EffectExecuteContext（draft/emit/child/
 *   emitJump），子效果失败沿调用栈上抛使整批事务回滚。
 */
export function createCallDef(ctx: BuiltinDefContext): ErasedEffectDef {
  const def: EffectInstructionDef<{ fn: string; with?: Record<string, unknown> }> = {
    id: 'call',
    schema: effectParamSchemas.call,
    touch: (arg) => {
      const target = ctx.lookup(arg.fn);
      return target !== undefined ? target.touch(arg.with as never) : { reads: [], writes: [] };
    },
    execute: (arg, ectx) => {
      if (!X_NAMESPACE_PATTERN.test(arg.fn)) {
        throw instructionError(
          'call',
          `call.fn 必须 'x.<script>.<name>'（DD-08），实际 '${arg.fn}'`,
          { fn: arg.fn },
        );
      }
      const target = ctx.lookup(arg.fn);
      if (target === undefined) {
        throw instructionError('call', `作者扩展指令 '${arg.fn}' 未注册（FR-SCR-04）`, {
          fn: arg.fn,
        });
      }
      const parsed = target.schema.safeParse(arg.with ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw instructionError(
          'call',
          `作者扩展指令 '${arg.fn}' 参数校验失败：${issue !== undefined ? issue.message : '未知问题'}`,
          { fn: arg.fn },
        );
      }
      const childArg = parsed.data as never;
      target.execute(childArg, ectx);
      if (target.jumps !== undefined) {
        for (const jump of target.jumps(childArg)) {
          ectx.emitJump(jump);
        }
      }
    },
  };
  return eraseDef(def);
}

/**
 * 系统类指令全集（id 固定，§3.3 表格；call 除外——它需要注册表 lookup）。
 *
 * - `advance_time`（§4.3 / FR-TIME）：把「推进 N 个时段」的跳转型意图放入
 *   ExecOutcome.jumps（JumpTarget.advanceTime）。**真正的时段推进管线归 09
 *   号**：钩子编排、日刷新、时效 tick 都在那边按固定次序执行——本指令只负责
 *   意图声明，不改任何状态（cost 为 0 时连意图也不产）；
 * - `quest`（§4.5 / FR-QUEST）：accept/advance/complete/fail 子操作写入
 *   `quests` 状态域。阶段序与缺省「下一阶段」由任务目录（QuestDef.stages）
 *   推导；**效果钩子与 completeWhen 驱动的状态机评估归 11 号**——本模块只做
 *   最简状态写入与阶段合法性校验；
 * - `unlock`（FR-GAL-01/03 / FR-XTRA-06）：gallery（场景回想）/cg/endings/codex
 *   写入 `seen` 域（幂等：已存在不重复写入），achievement 入 Profile（引擎不持有
 *   Profile，D7，宿主经 unlock 事件路由）；事件恒发（订阅面与状态面解耦）；
 * - `media`（DD-05）：仅产出 MediaIntent 事件，engine 不接触音频/图像；
 * - `notify`（FR-UI-07）：文本键 + 插值变量（宽松求值：字符串先按表达式，
 *   编译失败回退字面量，02 号语义）。
 */
export function createSystemDefs(options: EffectRegistryOptions): ErasedEffectDef[] {
  const advanceTimeDef: EffectInstructionDef<{ cost: string | number }> = {
    id: 'advance_time',
    schema: effectParamSchemas.advance_time,
    touch: (): TouchReport => ({ reads: [], writes: [] }),
    execute: (arg, ectx) => {
      const slots = evalNumberParam(ectx, 'advance_time', 'cost', arg.cost);
      if (!Number.isInteger(slots) || slots < 0) {
        throw instructionError('advance_time', `cost 须为非负整数时段数，实际 ${String(slots)}`, {
          sourceExpr: typeof arg.cost === 'string' ? arg.cost : String(arg.cost),
        });
      }
      if (slots > 0) {
        ectx.emitJump({ type: 'advanceTime', slots });
      }
    },
  };

  const questDef: EffectInstructionDef<{
    id: string;
    action: 'accept' | 'advance' | 'complete' | 'fail';
    stage?: string;
  }> = {
    id: 'quest',
    schema: effectParamSchemas.quest,
    touch: (): TouchReport => ({ reads: [], writes: ['quests'] }),
    execute: (arg, ectx) => {
      const quests = ectx.draft.quests;
      const def = options.quests?.get(arg.id);
      const current = quests[arg.id];
      const requireStage = (op: string, stage: string | undefined, questId: string): void => {
        if (stage !== undefined && def !== undefined && !def.stages.some((s) => s.id === stage)) {
          throw instructionError(op, `任务 '${questId}' 不存在阶段 '${stage}'`, {
            quest: questId,
            stage,
          });
        }
      };
      switch (arg.action) {
        case 'accept': {
          if (
            current !== undefined &&
            current.state !== 'undiscovered' &&
            current.state !== 'available'
          ) {
            throw instructionError(
              'quest',
              `任务 '${arg.id}' 当前状态 ${current.state}，不可接取`,
              { quest: arg.id, action: 'accept' },
            );
          }
          requireStage('quest', arg.stage, arg.id);
          const stage = arg.stage ?? def?.stages[0]?.id;
          quests[arg.id] = {
            state: 'active',
            objectives: {},
            startedDay: ectx.draft.world.time.day,
            ...(stage !== undefined ? { stage } : {}),
          };
          return;
        }
        case 'advance': {
          if (current === undefined) {
            throw instructionError('quest', `任务 '${arg.id}' 尚未存在，不可推进`, {
              quest: arg.id,
              action: 'advance',
            });
          }
          if (current.state !== 'active') {
            throw instructionError(
              'quest',
              `任务 '${arg.id}' 当前状态 ${current.state}，仅 active 可推进`,
              { quest: arg.id, action: 'advance' },
            );
          }
          requireStage('quest', arg.stage, arg.id);
          let target = arg.stage;
          if (target === undefined) {
            const stages = def?.stages;
            if (stages === undefined) {
              throw instructionError(
                'quest',
                `缺省「下一阶段」需要任务目录（QuestDef）；未注入时必须显式给出 stage`,
                { quest: arg.id, action: 'advance' },
              );
            }
            const index = stages.findIndex((s) => s.id === current.stage);
            if (index < 0) {
              target = stages[0]?.id; // 尚无阶段 → 取首阶段
            } else if (index === stages.length - 1) {
              throw instructionError(
                'quest',
                `任务 '${arg.id}' 已在最终阶段（提交就绪归 11 号 completeWhen 评估）`,
                { quest: arg.id, action: 'advance' },
              );
            } else {
              target = stages[index + 1]?.id;
            }
          }
          quests[arg.id] = { ...current, ...(target !== undefined ? { stage: target } : {}) };
          return;
        }
        case 'complete': {
          if (
            current === undefined ||
            (current.state !== 'active' && current.state !== 'ready_to_submit')
          ) {
            throw instructionError(
              'quest',
              `任务 '${arg.id}' 当前状态 ${current?.state ?? '不存在'}，不可完成`,
              { quest: arg.id, action: 'complete' },
            );
          }
          quests[arg.id] = { ...current, state: 'done' };
          return;
        }
        default: {
          if (
            current === undefined ||
            (current.state !== 'active' && current.state !== 'ready_to_submit')
          ) {
            throw instructionError(
              'quest',
              `任务 '${arg.id}' 当前状态 ${current?.state ?? '不存在'}，不可失败`,
              { quest: arg.id, action: 'fail' },
            );
          }
          quests[arg.id] = { ...current, state: 'failed' };
          return;
        }
      }
    },
  };

  const unlockDef: EffectInstructionDef<UnlockParams> = {
    id: 'unlock',
    schema: effectParamSchemas.unlock,
    touch: (arg): TouchReport => {
      switch (arg.kind) {
        case 'gallery':
          return { reads: [], writes: ['seen.gallery'] };
        case 'cg':
          return { reads: [], writes: ['seen.cg'] };
        case 'ending':
          return { reads: [], writes: ['seen.endings'] };
        case 'codex':
          return { reads: [], writes: ['seen.codex'] };
        default:
          return { reads: [], writes: [] }; // achievement → Profile（宿主路由，D7）
      }
    },
    execute: (arg, ectx) => {
      if (arg.kind !== 'achievement') {
        const list = ectx.draft.seen[arg.kind === 'ending' ? 'endings' : arg.kind];
        if (!list.includes(arg.id)) list.push(arg.id);
      }
      ectx.emit({ type: 'unlock', kind: arg.kind, id: arg.id });
    },
  };

  const mediaDef: EffectInstructionDef<MediaParams> = {
    id: 'media',
    schema: effectParamSchemas.media,
    touch: (): TouchReport => ({ reads: [], writes: [] }),
    execute: (arg, ectx) => {
      const intent: MediaIntent =
        arg.type === 'bgm'
          ? { type: 'bgm', assetId: arg.assetId, loop: true }
          : arg.type === 'sfx'
            ? { type: 'sfx', assetId: arg.assetId }
            : {
                type: arg.type,
                assetId: arg.assetId,
                ...(arg.transition !== undefined ? { transition: arg.transition } : {}),
              };
      ectx.emit({ type: 'media', intent });
    },
  };

  const notifyDef: EffectInstructionDef<NotifyParams> = {
    id: 'notify',
    schema: effectParamSchemas.notify,
    touch: (): TouchReport => ({ reads: [], writes: [] }),
    execute: (arg, ectx) => {
      const vars =
        arg.vars === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(arg.vars).map(([key, value]) => [
                key,
                evalLenientParam(ectx, 'notify', `vars.${key}`, value),
              ]),
            );
      ectx.emit({
        type: 'notify',
        textKey: arg.textKey,
        ...(vars !== undefined ? { vars } : {}),
      });
    },
  };

  return [
    eraseDef(advanceTimeDef),
    eraseDef(questDef),
    eraseDef(unlockDef),
    eraseDef(mediaDef),
    eraseDef(notifyDef),
    eraseDef(timeAdvanceDef(options)),
  ];
}

/**
 * `__time.advance` 内部指令（§4.3 步骤 1 时钟写入的载体，09 任务 3）。
 *
 * **引擎内部面，不面向作者**：推进管线把时钟变更与各步骤效果合并为同一事务
 * （一次推进 = 一个 undo 点），时钟写入本身也要原子——故以指令形态进入事务，
 * 由 TimePipeline 编排；作者包内书写 `__time.advance` 会被 effectDataSchema
 * 的加载期校验拒绝（未知指令键），运行期仅管线可达。
 *
 * - 需要 EffectRegistryOptions.timeConfig（时间管线装配时注入）；缺省 =
 *   EFFECT_FAILED（显性化：时间管线未装配时不做任何时钟写入）；
 * - 模前 slotIndex 回绕与 week/month 推导统一走 advanceClock 纯函数。
 */
function timeAdvanceDef(options: EffectRegistryOptions): ErasedEffectDef {
  const def: EffectInstructionDef<{ slots: number }> = {
    id: '__time.advance',
    schema: z.strictObject({ slots: z.number().int().min(0) }),
    touch: (): TouchReport => ({ reads: [], writes: ['world.time'] }),
    execute: (arg, ectx) => {
      const config = options.timeConfig;
      if (config === undefined) {
        throw instructionError('__time.advance', '未注入 TimeConfig（时间管线未装配）', {});
      }
      ectx.draft.world.time = advanceClock(ectx.draft.world.time, config, arg.slots).clock;
    },
  };
  return eraseDef(def);
}
