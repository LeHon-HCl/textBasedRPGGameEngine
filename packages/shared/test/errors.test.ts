import { describe, expect, expectTypeOf, it } from 'vitest';
import { EngineError, isEngineError, serializeError } from '../src/index.js';
import type { ErrCode } from '../src/index.js';

/** 设计 §2.2 的错误码全集（顺序即设计文档声明顺序，编译期锁定） */
const ALL_ERR_CODES: readonly ErrCode[] = [
  'SCHEMA_INVALID',
  'DUP_ID',
  'DANGLING_REF',
  'EXPR_COMPILE',
  'EVAL_ERROR',
  'EFFECT_FAILED',
  'MIGRATION_FAILED',
  'VERSION_UNSUPPORTED',
  'SAVE_CORRUPT',
  'MEDIA_MISSING',
  'SCRIPT_CONTRACT',
  'INTERNAL',
];

describe('ErrCode 全集（设计 §2.2）', () => {
  it('类型层：与设计 §2.2 的 12 值联合完全一致', () => {
    expectTypeOf<ErrCode>().toEqualTypeOf<
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
      | 'INTERNAL'
    >();
  });

  it('运行期：每个错误码都能构造 EngineError 并原样保留', () => {
    for (const code of ALL_ERR_CODES) {
      const error = new EngineError({ code, messageKey: 'error.test.probe' });
      expect(error.code).toBe(code);
      expect(error.messageKey).toBe('error.test.probe');
    }
  });
});

describe('EngineError 三元组构造器（设计 §2.2，NFR-23）', () => {
  it('保留 code / where / messageKey，且是普通 Error 实例', () => {
    const error = new EngineError({
      code: 'DANGLING_REF',
      where: { scene: 'forest_entrance', field: 'goto' },
      messageKey: 'error.danglingRef',
    });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EngineError);
    expect(error.name).toBe('EngineError');
    expect(error.code).toBe('DANGLING_REF');
    expect(error.where).toEqual({ scene: 'forest_entrance', field: 'goto' });
    expect(error.messageKey).toBe('error.danglingRef');
  });

  it('where 缺省时为空对象', () => {
    const error = new EngineError({ code: 'INTERNAL', messageKey: 'error.internal' });
    expect(error.where).toEqual({});
  });

  it('message 为确定性格式：无 where 时为 [CODE] messageKey', () => {
    const error = new EngineError({ code: 'EVAL_ERROR', messageKey: 'error.eval.divByZero' });
    expect(error.message).toBe('[EVAL_ERROR] error.eval.divByZero');
  });

  it('message 为确定性格式：有 where 时追加 (k=v, ...) 片段', () => {
    const error = new EngineError({
      code: 'EXPR_COMPILE',
      where: { scene: 'market', index: '3', expr: 'gold + ' },
      messageKey: 'error.expr.compile',
    });
    expect(error.message).toBe(
      '[EXPR_COMPILE] error.expr.compile (scene=market, index=3, expr=gold + )',
    );
  });

  it('where 是冻结副本：改动构造入参与实例属性均不影响已捕获的定位信息', () => {
    const where = { scene: 'forest' };
    const error = new EngineError({ code: 'DUP_ID', where, messageKey: 'error.dupId' });
    where.scene = 'cave';
    expect(error.where).toEqual({ scene: 'forest' });
    expect(Object.isFrozen(error.where)).toBe(true);
    expect(() => {
      error.where.scene = 'cave';
    }).toThrow(TypeError);
  });

  it('cause 透传给底层 Error，保留原始原因链', () => {
    const cause = new TypeError('unexpected token');
    const error = new EngineError({
      code: 'SAVE_CORRUPT',
      messageKey: 'error.save.corrupt',
      cause,
    });
    expect(error.cause).toBe(cause);
  });

  it('未提供 cause 时不应产生 cause 属性语义（undefined）', () => {
    const error = new EngineError({ code: 'MEDIA_MISSING', messageKey: 'error.media.missing' });
    expect(error.cause).toBeUndefined();
  });
});

describe('isEngineError 判定', () => {
  it('EngineError 判定为 true（鸭子结构成立）', () => {
    const error = new EngineError({ code: 'DUP_ID', messageKey: 'error.dupId' });
    expect(isEngineError(error)).toBe(true);
    if (isEngineError(error)) {
      expect(error.code).toBe('DUP_ID');
    }
  });

  it.each([
    ['null', null],
    ['字符串', 'DUP_ID'],
    ['普通对象', { code: 'DUP_ID', messageKey: 'error.dupId', where: {} }],
    ['plain Error（无三元组）', new Error('boom')],
  ])('非 EngineError 判定为 false：%s', (_label, value) => {
    expect(isEngineError(value)).toBe(false);
  });

  it('带 code 但缺 messageKey 的 Error 判定为 false', () => {
    const partial = Object.assign(new Error('boom'), { code: 'DUP_ID' });
    expect(isEngineError(partial)).toBe(false);
  });

  it('where 不是字符串记录（数组 / 含非字符串值）判定为 false', () => {
    const withArrayWhere = Object.assign(new Error('boom'), {
      code: 'DUP_ID',
      messageKey: 'error.dupId',
      where: ['scene'],
    });
    const withBadValue = Object.assign(new Error('boom'), {
      code: 'DUP_ID',
      messageKey: 'error.dupId',
      where: { scene: 42 },
    });
    expect(isEngineError(withArrayWhere)).toBe(false);
    expect(isEngineError(withBadValue)).toBe(false);
  });
});

describe('serializeError 诊断序列化（设计 §10.2）', () => {
  it('EngineError 输出白名单字段：name/message/code/where/messageKey/stack/cause', () => {
    const cause = new TypeError('bad json');
    const error = new EngineError({
      code: 'SAVE_CORRUPT',
      where: { slot: 'auto-01' },
      messageKey: 'error.save.corrupt',
      cause,
    });
    const serialized = serializeError(error);
    expect(Object.keys(serialized).sort()).toEqual([
      'cause',
      'code',
      'message',
      'messageKey',
      'name',
      'stack',
      'where',
    ]);
    expect(serialized.name).toBe('EngineError');
    expect(serialized.code).toBe('SAVE_CORRUPT');
    expect(serialized.where).toEqual({ slot: 'auto-01' });
    expect(serialized.messageKey).toBe('error.save.corrupt');
    expect(serialized.message).toBe(error.message);
    expect(typeof serialized.stack).toBe('string');
  });

  it('脱敏：Error 上附加的任意属性（如状态快照）不进入序列化结果', () => {
    const error = new EngineError({ code: 'INTERNAL', messageKey: 'error.internal' });
    (error as unknown as { saveState?: unknown }).saveState = {
      gold: 999,
      flags: { secret: true },
    };
    const serialized = serializeError(error);
    expect(serialized).not.toHaveProperty('saveState');
  });

  it('plain Error 不携带 code/where/messageKey 字段', () => {
    const error = new RangeError('out of range');
    const serialized = serializeError(error);
    expect(Object.keys(serialized).sort()).toEqual(['message', 'name', 'stack']);
    expect(serialized.name).toBe('RangeError');
    expect(serialized.message).toBe('out of range');
  });

  it.each([
    ['字符串', 'boom', 'boom'],
    ['数字', 42, '42'],
    ['null', null, 'null'],
    ['普通对象', { evil: 'payload' }, '[object Object]'],
  ])('非 Error 抛出值兜底为 UnknownError：%s', (_label, value, expectedMessage) => {
    expect(serializeError(value)).toEqual({ name: 'UnknownError', message: expectedMessage });
  });

  it('Symbol.toPrimitive 抛异常的值也能安全兜底（不向诊断导出传播异常）', () => {
    const hostile = {
      [Symbol.toPrimitive]: () => {
        throw new Error('hostile valueOf');
      },
    };
    expect(serializeError(hostile)).toEqual({ name: 'UnknownError', message: 'UnknownError' });
  });

  it('cause 链按白名单递归序列化（保留 code/where/messageKey）', () => {
    const root = new EngineError({
      code: 'SCHEMA_INVALID',
      where: { file: 'manifest.yaml' },
      messageKey: 'error.schema.invalid',
    });
    const error = new EngineError({
      code: 'MIGRATION_FAILED',
      messageKey: 'error.migration.failed',
      cause: root,
    });
    const serialized = serializeError(error);
    expect(serialized.cause?.code).toBe('SCHEMA_INVALID');
    expect(serialized.cause?.where).toEqual({ file: 'manifest.yaml' });
    expect(serialized.cause?.messageKey).toBe('error.schema.invalid');
  });

  it('循环 cause 引用按深度封顶 5 层安全终止（不悬挂、不溢出）', () => {
    const a = new EngineError({ code: 'INTERNAL', messageKey: 'error.test.a' });
    const b = new EngineError({ code: 'INTERNAL', messageKey: 'error.test.b', cause: a });
    a.cause = b; // a → b → a 循环
    let depth = 0;
    let node = serializeError(a);
    while (node.cause !== undefined) {
      node = node.cause;
      depth += 1;
      expect(depth).toBeLessThanOrEqual(5);
    }
    // 精确等于封顶值：脱敏契约要求诊断导出体积有界
    expect(depth).toBe(5);
  });

  it('stack 缺失（undefined）时不产生 stack 值', () => {
    const error = new Error('no stack');
    error.stack = undefined;
    const serialized = serializeError(error);
    expect(serialized.stack).toBeUndefined();
  });

  it('stack 截断至前 10 行，限制诊断导出体积与路径暴露面', () => {
    const error = new Error('deep');
    error.stack = [
      'Error: deep',
      ...Array.from({ length: 40 }, (_, i) => `at f${i} (a.js:1:1)`),
    ].join('\n');
    const serialized = serializeError(error);
    const stackLines = serialized.stack?.split('\n') ?? [];
    expect(stackLines).toHaveLength(10);
    expect(stackLines[0]).toBe('Error: deep');
    expect(stackLines[9]).toBe('at f8 (a.js:1:1)');
  });
});
