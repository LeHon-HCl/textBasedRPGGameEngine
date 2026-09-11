import { effectParamSchemas } from '@game/shared';
import type { BuiltinDefContext } from '../types.js';
import { eraseDef } from '../types.js';
import type { EffectInstructionDef, ErasedEffectDef } from '../types.js';
import { instructionError } from './util.js';

/**
 * 系统类内置指令（设计 §3.3；call 于 05 任务 A3 登记，advance_time / quest /
 * unlock / notify / media 于 05 任务 B5 登记）。
 */

/** 作者扩展命名空间形态（DD-08）：x.<script>.<name>，段为 GameId 形态 */
const X_NAMESPACE_PATTERN = /^x\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

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
