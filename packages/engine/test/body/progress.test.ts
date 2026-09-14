import { describe, expect, it } from 'vitest';
import type { BodyDef } from '@game/shared';
import { BASE_VERSIONS, makeBuiltinRuntime, makeCtx } from '../effects/fixtures.js';
import { compileExpr, createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';

/**
 * 14 任务 4/5：progress 字段预留（FR-BODY-05 P2）与描写组合验收（FR-BODY-03）。
 *
 * - progress：`player.bodyProgress[part]`（0..100），表达式可读，**不进冻结范围**
 *   ——P2 渐进变身的数据面，引擎只存取不解释（中立性）；
 * - 描写组合（FR-BODY-03）：引擎无专门机制，验收点是「body 值驱动的条件分支
 *   能走通」——即 `body.tail == 'fluffy'` 这类条件随 set_body 求值变化（与 03
 *   号表达式求值器的联测；08 号叙事宏走同一求值通道）。
 */

const BODY_DEFS: BodyDef = {
  parts: {
    build: { values: ['slender', 'sturdy'], default: 'slender' },
    tail: { values: ['none', 'fluffy'], default: 'none' },
  },
};

function makeBodyRuntime(init?: { body?: Record<string, string> }) {
  const { rt } = makeBuiltinRuntime({
    bootstrap: {
      versions: BASE_VERSIONS,
      attrs: { hp: 10 },
      ...(init?.body !== undefined ? { body: init.body } : {}),
    },
    registryOptions: { bodyDefs: BODY_DEFS },
  });
  return rt;
}

/** 条件编译（与运行时求值共用内置函数注册表） */
function compile(source: string) {
  return compileExpr(source, createBuiltinFunctionRegistry());
}

describe('14-4 progress 字段：存取与边界', () => {
  it('set_body 带 progress 写入 bodyProgress；0..100 之外或非整数拒绝', () => {
    const rt = makeBodyRuntime({ body: { tail: 'none' } });
    rt.exec([{ set_body: { part: 'tail', value: 'fluffy', progress: 60 } } as never], makeCtx());
    expect(rt.state.player.bodyProgress['tail']).toBe(60);
    for (const bad of [120, -5, 1.5]) {
      expect(() =>
        rt.exec(
          [{ set_body: { part: 'tail', value: 'fluffy', progress: bad } } as never],
          makeCtx(),
        ),
      ).toThrow();
    }
  });

  it('无 progress 参数的 set_body 不改动已有进度（键级保留）', () => {
    const rt = makeBodyRuntime({ body: { tail: 'none' } });
    rt.exec([{ set_body: { part: 'tail', value: 'fluffy', progress: 60 } } as never], makeCtx());
    rt.exec([{ set_body: { part: 'tail', value: 'none' } }], makeCtx());
    expect(rt.state.player.bodyProgress['tail']).toBe(60);
  });

  it('progress 经表达式可读（body 域投影，FR-BODY-05 表达式可读要求）', () => {
    const rt = makeBodyRuntime({ body: { tail: 'none' } });
    rt.exec([{ set_body: { part: 'tail', value: 'fluffy', progress: 30 } } as never], makeCtx());
    expect(rt.eval(compile('body.progress.tail'))).toBe(30);
  });
});

describe('14-5 描写组合验收：body 值驱动的条件分支（FR-BODY-03）', () => {
  it("条件 body.tail == 'fluffy' 随 set_body 求值变化（与 03 号表达式联测）", () => {
    const rt = makeBodyRuntime({ body: { tail: 'none' } });
    const condition = compile("body.tail == 'fluffy'");
    expect(rt.evalCondition(condition)).toBe(false);
    rt.exec([{ set_body: { part: 'tail', value: 'fluffy' } }], makeCtx());
    expect(rt.evalCondition(condition)).toBe(true);
    rt.exec([{ set_body: { part: 'tail', value: 'none' } }], makeCtx());
    expect(rt.evalCondition(condition)).toBe(false);
  });

  it('多部位组合条件（build 与 tail 同时判定）走通', () => {
    const rt = makeBodyRuntime({ body: { build: 'slender', tail: 'none' } });
    const condition = compile("body.tail == 'fluffy' && body.build == 'sturdy'");
    rt.exec([{ set_body: { part: 'tail', value: 'fluffy' } }], makeCtx());
    expect(rt.evalCondition(condition)).toBe(false);
    rt.exec([{ set_body: { part: 'build', value: 'sturdy' } }], makeCtx());
    expect(rt.evalCondition(condition)).toBe(true);
  });
});
