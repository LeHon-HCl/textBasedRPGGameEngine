import { EngineError } from '@game/shared';

/**
 * 内置指令共用辅助（05 任务 A/B 组）：错误构造与参数求值。
 * 全部指令失败面统一为 EFFECT_FAILED（op = 指令 id + 定位字段 + detail），
 * 由 04 号运行时包装后附 instruction 序号定位（§3.3 错误定位）。
 */

/** 指令级失败（EFFECT_FAILED）：op = 指令 id，extra 携带参数级定位字段 */
export function instructionError(
  op: string,
  detail: string,
  extra?: Record<string, string>,
): EngineError {
  return new EngineError({
    code: 'EFFECT_FAILED',
    where: { op, ...extra, detail },
    messageKey: 'error.effects.instructionFailed',
  });
}
