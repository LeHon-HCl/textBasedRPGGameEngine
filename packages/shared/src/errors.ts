import type { TextKey } from './ids.js';

/**
 * 错误体系（设计 §2.2，NFR-23）。
 *
 * 原则：所有错误必须携带 `code + where + messageKey` 三元组；
 * 禁止裸 `throw new Error()`（lint no-restricted-syntax 强制，见根 eslint.config.js）。
 * 诊断显示与日志规范见设计 §10.2：场景/指令级 catch → 错误卡片
 * （code/where/messageKey/继续与回退按钮）。
 */

/**
 * 错误码全集（设计 §2.2）。
 * - 加载期：SCHEMA_INVALID / DUP_ID / DANGLING_REF / EXPR_COMPILE / VERSION_UNSUPPORTED
 * - 运行期：EVAL_ERROR / EFFECT_FAILED / MEDIA_MISSING / SCRIPT_CONTRACT
 * - 存档与迁移：MIGRATION_FAILED / SAVE_CORRUPT
 * - 兜底：INTERNAL
 */
export type ErrCode =
  | 'SCHEMA_INVALID'
  | 'DUP_ID'
  | 'DANGLING_REF'
  | 'EXPR_COMPILE'
  | 'EVAL_ERROR'
  | 'EFFECT_FAILED'
  | 'MIGRATION_FAILED'
  | 'VERSION_UNSUPPORTED'
  | 'SAVE_CORRUPT'
  | 'MEDIA_MISSING'
  | 'SCRIPT_CONTRACT'
  | 'INTERNAL';

/** EngineError 构造参数（三元组 + 可选 cause） */
export interface EngineErrorInit {
  code: ErrCode;
  /** 定位信息：场景/文件/指令序号/表达式原文等（值为字符串，诊断导出用） */
  where?: Record<string, string>;
  /** 用户可读诊断（i18n 键），UI 显示用（设计 §2.2） */
  messageKey: TextKey;
  /** 底层原因（可选），诊断导出时按深度封顶序列化 */
  cause?: unknown;
}

/**
 * 引擎错误（设计 §2.2）。
 *
 * 以 class 实现 `interface EngineError extends Error` 的设计签名：
 * `EngineError` 既是构造器也是类型，UI 错误边界可用 `instanceof` /
 * {@link isEngineError} 识别。message 为确定性格式（便于日志检索），
 * 玩家可读文案由 messageKey 经 i18n 解析（D4：数据与文本分离）。
 */
export class EngineError extends Error {
  readonly code: ErrCode;
  /** 定位信息（冻结副本：构造后不可变，诊断序列化期间不被外部改动） */
  readonly where: Record<string, string>;
  readonly messageKey: TextKey;

  constructor(init: EngineErrorInit) {
    super(
      formatEngineMessage(init.code, init.messageKey, init.where),
      init.cause !== undefined ? { cause: init.cause } : undefined,
    );
    this.name = 'EngineError';
    this.code = init.code;
    this.where = Object.freeze({ ...init.where });
    this.messageKey = init.messageKey;
  }
}

/** message 的确定性格式：`[CODE] messageKey` 或 `[CODE] messageKey (k=v, ...)` */
function formatEngineMessage(
  code: ErrCode,
  messageKey: TextKey,
  where?: Record<string, string>,
): string {
  const entries = Object.entries(where ?? {});
  if (entries.length === 0) return `[${code}] ${messageKey}`;
  const whereText = entries.map(([key, value]) => `${key}=${value}`).join(', ');
  return `[${code}] ${messageKey} (${whereText})`;
}

/**
 * 判定未知值是否为 EngineError（含结构化鸭子判定：Error + code/messageKey/where）。
 * 供 UI 错误边界（§10.2）与日志层在 catch 后安全收敛类型。
 */
export function isEngineError(value: unknown): value is EngineError {
  if (!(value instanceof Error)) return false;
  const candidate = value as Partial<EngineError>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.messageKey === 'string' &&
    isRecordOfStrings(candidate.where)
  );
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'string');
}

/** cause 链最大递归深度（封顶防止循环引用悬挂，同时限制诊断体积） */
const MAX_CAUSE_DEPTH = 5;
/** stack 最大保留行数（限制诊断导出体积与路径暴露面，§10.2「脱敏 JSON（…栈）」） */
const MAX_STACK_LINES = 10;

/**
 * 错误序列化产物：JSON 安全、字段白名单（设计 §10.2 诊断导出的错误级构建块）。
 *
 * 脱敏契约：
 * - 仅输出白名单字段，Error 上附加的任意属性（如状态/存档快照）一律不透传；
 * - cause 链按同一白名单递归，深度封顶 {@link MAX_CAUSE_DEPTH}，循环引用安全终止；
 * - stack 截断至前 {@link MAX_STACK_LINES} 行；不含存档内容。
 */
export interface SerializedEngineError {
  name: string;
  message: string;
  /** 仅 EngineError 携带 */
  code?: ErrCode;
  /** 仅 EngineError 携带 */
  where?: Record<string, string>;
  /** 仅 EngineError 携带 */
  messageKey?: TextKey;
  stack?: string;
  cause?: SerializedEngineError;
}

/**
 * 将未知抛出值序列化为诊断用 JSON 安全对象（设计 §10.2：诊断导出 = 脱敏 JSON）。
 * EngineError 输出三元组（code/where/messageKey）；其他 Error 仅输出
 * name/message/stack；非 Error 抛出值兜底为 UnknownError。
 */
export function serializeError(error: unknown): SerializedEngineError {
  return serializeErrorAt(error, 0);
}

function serializeErrorAt(error: unknown, depth: number): SerializedEngineError {
  const result: SerializedEngineError = {
    name: 'UnknownError',
    message: describeThrownValue(error),
  };
  if (error instanceof Error) {
    result.name = error.name;
    result.message = error.message;
    result.stack = truncateStack(error.stack);
    if (isEngineError(error)) {
      result.code = error.code;
      result.where = { ...error.where };
      result.messageKey = error.messageKey;
    }
  }
  if (depth < MAX_CAUSE_DEPTH && error instanceof Error && error.cause !== undefined) {
    result.cause = serializeErrorAt(error.cause, depth + 1);
  }
  return result;
}

/** 非 Error 抛出值的字符串描述；String() 自身抛异常时安全兜底 */
function describeThrownValue(value: unknown): string {
  try {
    return String(value);
  } catch {
    return 'UnknownError';
  }
}

function truncateStack(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;
  return stack.split('\n').slice(0, MAX_STACK_LINES).join('\n');
}
