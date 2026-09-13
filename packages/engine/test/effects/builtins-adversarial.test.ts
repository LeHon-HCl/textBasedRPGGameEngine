import { describe, expect, it } from 'vitest';
import { EngineError, effectParamSchemas } from '@game/shared';
import {
  BODY_DEFS,
  BASE_VERSIONS,
  scriptedCheckRule,
  makeBuiltinRuntime,
  makeCtx,
} from './fixtures.js';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import type { CheckRuleResolver } from '../../src/effects/types.js';
import type { JumpTarget } from '../../src/runtime/exec-context.js';

/** 带身体定义与判定解析器的运行时（对抗类用例） */
function makeAdversarialRuntime(init?: { bodyDefs?: boolean; resolver?: CheckRuleResolver }) {
  return makeBuiltinRuntime({
    bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 30, con: 2 } },
    registryOptions: {
      ...(init?.bodyDefs === false ? {} : { bodyDefs: BODY_DEFS }),
      ...(init?.resolver !== undefined ? { checkResolver: init.resolver } : {}),
    },
  });
}

/** 成功解析器：脚本化返回固定等级 */
function resolverFor(
  outcome: 'success' | 'fail',
  level: 'critical' | 'extreme' | 'hard' | 'normal' | 'fail' | 'fumble',
): CheckRuleResolver {
  const rule = scriptedCheckRule({ outcome, level });
  // 测试桩对任意规则 id 返回同一脚本化规则（check 缺省 rule='coc' 亦可解析）
  return { resolve: () => rule };
}

describe('05-B6 内置指令矩阵：全量 25 个固定 id 注册（完成定义）', () => {
  it('作者可见指令 id 集合与 02 号 effectParamSchemas 键集一致；内部指令（__ 前缀）单列', () => {
    const registry = createBuiltinEffectRegistry();
    const ids = [...registry.ids()];
    // 作者可见指令 = effectParamSchemas 键集（加载期 effectDataSchema 的合法键）
    expect(Object.keys(effectParamSchemas).filter((k) => !ids.includes(k))).toEqual([]);
    // 内部指令（__ 前缀，不面向作者；09 号 __time.advance 为时钟写入载体）
    const internal = ids.filter((id) => id.startsWith('__'));
    expect(internal).toEqual(['__time.advance']);
    expect(ids).toHaveLength(26);
  });
});

describe('05-B6 check：判定路由骨架（§5.1，coc/generic 实现属 15 号）', () => {
  it('成功判定：emit check_result + 执行 on_success 子效果（child 原子批）', () => {
    const { rt } = makeAdversarialRuntime({ resolver: resolverFor('success', 'normal') });
    const outcome = rt.exec(
      [
        {
          check: {
            rule: 'test_scripted',
            value: 'attr.con * 10',
            onSuccess: [{ set: { key: 'flag.cleared', value: true } }],
          },
        },
      ],
      makeCtx(),
    );
    expect(rt.state.world.flags['cleared']).toBe(true);
    expect(outcome.events).toEqual([
      {
        type: 'check_result',
        rule: 'test_scripted',
        outcome: 'success',
        level: 'normal',
        rolls: [expect.any(Number)],
        detail: { requested: 20 },
      },
    ]);
  });

  it('critical 走 onCritical（未声明回退 onSuccess）；fumble 走 onFumble', () => {
    const { rt } = makeAdversarialRuntime({ resolver: resolverFor('success', 'critical') });
    rt.exec(
      [
        {
          check: {
            value: '50',
            onSuccess: [{ set: { key: 'flag.via_success', value: true } }],
            onCritical: [{ set: { key: 'flag.via_critical', value: true } }],
          },
        },
      ],
      makeCtx(),
    );
    expect(rt.state.world.flags['via_critical']).toBe(true);
    expect(rt.state.world.flags['via_success']).toBeUndefined();

    const { rt: rt2 } = makeAdversarialRuntime({ resolver: resolverFor('fail', 'fumble') });
    rt2.exec(
      [
        {
          check: {
            value: '50',
            onFail: [{ set: { key: 'flag.via_fail', value: true } }],
            onFumble: [{ set: { key: 'flag.via_fumble', value: true } }],
          },
        },
      ],
      makeCtx(),
    );
    expect(rt2.state.world.flags['via_fumble']).toBe(true);
    expect(rt2.state.world.flags['via_fail']).toBeUndefined();
  });

  it('fail 判定走 on_fail；extreme 等级按 outcome 走 on_success', () => {
    const { rt } = makeAdversarialRuntime({ resolver: resolverFor('fail', 'fail') });
    rt.exec(
      [{ check: { value: '10', onFail: [{ set: { key: 'flag.failed', value: true } }] } }],
      makeCtx(),
    );
    expect(rt.state.world.flags['failed']).toBe(true);

    const { rt: rt2 } = makeAdversarialRuntime({ resolver: resolverFor('success', 'extreme') });
    rt2.exec(
      [{ check: { value: '10', onSuccess: [{ set: { key: 'flag.extreme', value: true } }] } }],
      makeCtx(),
    );
    expect(rt2.state.world.flags['extreme']).toBe(true);
  });

  it('未声明分支档位不执行任何子效果；check 自身不改状态', () => {
    const { rt } = makeAdversarialRuntime({ resolver: resolverFor('success', 'normal') });
    const before = rt.state;
    const outcome = rt.exec([{ check: { value: '10' } }], makeCtx());
    expect(rt.state).toBe(before);
    expect(outcome.patches).toEqual([]);
    expect(outcome.events).toHaveLength(1);
  });

  it('未注入解析器 / 未知规则：EFFECT_FAILED；分支内失败整批回滚', () => {
    const { rt } = makeAdversarialRuntime({ resolver: undefined });
    expectFail(() => rt.exec([{ check: { value: '10' } }], makeCtx()), 'check', '解析器');

    const { rt: noRule } = makeAdversarialRuntime({ resolver: { resolve: () => undefined } });
    expectFail(() => noRule.exec([{ check: { value: '10' } }], makeCtx()), 'check', '未知判定规则');

    const { rt: boom } = makeAdversarialRuntime({ resolver: resolverFor('success', 'normal') });
    const before = boom.state;
    try {
      boom.exec(
        [
          {
            check: {
              value: '10',
              onSuccess: [{ set: { key: 'flag.half', value: true } }, { take: { item: 'nope' } }],
            },
          },
        ],
        makeCtx(),
      );
      expect.unreachable('分支失败应使整批事务失败');
    } catch (err) {
      const engineErr = err as EngineError;
      expect(engineErr.code).toBe('EFFECT_FAILED');
      expect(engineErr.where.instruction).toBe('0');
    }
    expect(boom.state).toBe(before);
    expect(boom.state.world.flags['half']).toBeUndefined();
  });

  it('奖惩骰须为非负整数（负数 / 小数失败）', () => {
    const { rt } = makeAdversarialRuntime({ resolver: resolverFor('success', 'normal') });
    expectFail(() => rt.exec([{ check: { value: '10', bonusDice: -1 } }], makeCtx()), 'check');
    expectFail(() => rt.exec([{ check: { value: '10', penaltyDice: 1.5 } }], makeCtx()), 'check');
  });
});

describe('05-B6 battle：jump 类（会话与胜负逃路由属 16 号）', () => {
  it('只产 {battle} 跳转；onVictory/onDefeat/onEscape 不在本指令执行', () => {
    const { rt } = makeAdversarialRuntime();
    const before = rt.state;
    const outcome = rt.exec(
      [
        {
          battle: {
            encounter: 'encounter_rat',
            onVictory: [{ set: { key: 'flag.won', value: true } }],
          },
        },
      ],
      makeCtx(),
    );
    expect(outcome.jumps).toEqual<JumpTarget[]>([{ type: 'battle', battle: 'encounter_rat' }]);
    expect(rt.state).toBe(before);
    expect(rt.state.world.flags['won']).toBeUndefined();
  });
});

describe('05-B6 set_body：值域校验 ∈ BodyDef（§4.8，回退管线属 14 号）', () => {
  it('合法 part/value 写入 player.body（部位变更可触发派生重算域）', () => {
    const { rt } = makeAdversarialRuntime();
    const outcome = rt.exec([{ set_body: { part: 'build', value: 'sturdy' } }], makeCtx());
    expect(rt.state.player.body['build']).toBe('sturdy');
    expect(outcome.patches.map((p) => p.path.slice(0, 2))).toContainEqual(['player', 'body']);
  });

  it('未知部位 / 值域外取值：EFFECT_FAILED，状态不变', () => {
    const { rt } = makeAdversarialRuntime();
    const before = rt.state;
    expectFail(
      () => rt.exec([{ set_body: { part: 'tail', value: 'fluffy' } }], makeCtx()),
      'set_body',
      '未知身体部位',
    );
    expectFail(
      () => rt.exec([{ set_body: { part: 'build', value: 'blob' } }], makeCtx()),
      'set_body',
      '值域',
    );
    expect(rt.state).toBe(before);
  });

  it('未注入 BodyDef 时直接写入（值域校验由宿主目录决定）', () => {
    const { rt } = makeAdversarialRuntime({ bodyDefs: false });
    rt.exec([{ set_body: { part: 'tail', value: 'fluffy' } }], makeCtx());
    expect(rt.state.player.body['tail']).toBe('fluffy');
  });

  it('revertAfter 形态校验：缺 slots/days 或非正整数被 schema 拒绝；表达式形态放行', () => {
    const { rt } = makeAdversarialRuntime();
    rt.exec(
      [{ set_body: { part: 'build', value: 'sturdy', revertAfter: { slots: '2 + 1' } } }],
      makeCtx(),
    );
    expect(rt.state.player.body['build']).toBe('sturdy');
    expectFail(
      () => rt.exec([{ set_body: { part: 'hair', value: 'long', revertAfter: {} } }], makeCtx()),
      'set_body',
    );
    expectFail(
      () =>
        rt.exec(
          [{ set_body: { part: 'hair', value: 'long', revertAfter: { slots: 0 } } }],
          makeCtx(),
        ),
      'set_body',
    );
  });
});

/** 与 items 测试同款的失败断言（op 归因 + 细节包含） */
function expectFail(run: () => unknown, op: string, contains?: string): void {
  try {
    run();
    expect.unreachable(`${op} 应当失败`);
  } catch (err) {
    const engineErr = err as EngineError;
    expect(engineErr.code).toBe('EFFECT_FAILED');
    const cause = engineErr.cause as EngineError;
    expect(cause.where.op).toBe(op);
    if (contains !== undefined) expect(cause.message).toContain(contains);
  }
}
