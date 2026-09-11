import { describe, expect, expectTypeOf, it } from 'vitest';
import { EngineError, isEngineError } from '../src/index.js';
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
