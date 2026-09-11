import { EngineError } from '@game/shared';
import type { EffectExecuteContext } from '../types.js';

/**
 * 内置指令共用辅助（05 任务 A/B 组）：错误构造与参数求值。
 * 全部指令失败面统一为 EFFECT_FAILED（op = 指令 id + 定位字段 + detail），
 * 由 04 号运行时包装后附 instruction 序号定位（§3.3 错误定位）；参数级失败
 * 附 sourceExpr（02 号表达式原文），运行时提升到外层 where 供诊断卡片展示。
 */

/** 指令级失败（EFFECT_FAILED）：op = 指令 id，extra 携带参数级定位字段，cause 保留底层错误链 */
export function instructionError(
  op: string,
  detail: string,
  extra?: Record<string, string>,
  cause?: unknown,
): EngineError {
  return new EngineError({
    code: 'EFFECT_FAILED',
    where: { op, ...extra, detail },
    messageKey: 'error.effects.instructionFailed',
    cause,
  });
}

/** 诊断值描述（describeValue：求值器 / 派生重算同口径） */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  return Array.isArray(value) ? 'array' : typeof value;
}

/**
 * 数值参数求值（exprOrNumberSchema 字段）：数值字面量直通，字符串经
 * ectx.evalSource 严格求值——结果必须为有限 number，否则 EFFECT_FAILED。
 * 编译 / 求值错误统一包装为指令归因失败（op + param + sourceExpr，原错误挂
 * cause），运行时再把 sourceExpr 提升到外层 EFFECT_FAILED.where（§3.3 定位）。
 */
export function evalNumberParam(
  ectx: EffectExecuteContext,
  op: string,
  param: string,
  value: string | number,
): number {
  const sourceExpr = typeof value === 'number' ? String(value) : value;
  let raw: unknown;
  try {
    raw = typeof value === 'number' ? value : ectx.evalSource(value);
  } catch (err) {
    throw instructionError(
      op,
      `参数 ${param} 求值失败：${err instanceof Error ? err.message : describeValue(err)}`,
      { param, sourceExpr },
      err,
    );
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw instructionError(
      op,
      `参数 ${param} 求值结果须为有限 number，实际为 ${describeValue(raw)}`,
      { param, sourceExpr },
    );
  }
  return raw;
}

/**
 * 宽松值参数（02 号 exprOrLiteralSchema「宽松语义」）：boolean / number 字面量
 * 直通；字符串先按表达式求值，EXPR_COMPILE（语法 / 白名单不符）时回退为
 * 字面量字符串——同时承接「表达式原文」与「字符串字面量」两种书写。求值期
 * 错误（EVAL_ERROR）不回退，包装为指令归因失败后照常抛出（DD-01 运行期严格）。
 */
export function evalLenientParam(
  ectx: EffectExecuteContext,
  op: string,
  param: string,
  value: string | number | boolean,
): unknown {
  if (typeof value !== 'string') return value;
  try {
    return ectx.evalSource(value);
  } catch (err) {
    if (err instanceof EngineError && err.code === 'EXPR_COMPILE') return value;
    throw instructionError(
      op,
      `参数 ${param} 求值失败：${err instanceof Error ? err.message : describeValue(err)}`,
      { param, sourceExpr: value },
      err,
    );
  }
}
