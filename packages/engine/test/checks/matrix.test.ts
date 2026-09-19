import { describe, expect, it } from 'vitest';
import type { Rng } from '@game/shared';
import { cocRule } from '../../src/checks/coc.js';
import { makeBuiltinRuntime, makeCtx } from '../effects/fixtures.js';

/**
 * 边界矩阵（15 号完成定义）：skill ∈ {1,49,50,90,95,100} × roll 端点全等级断言。
 *
 * 期望值是**从 §5.1 阈值表手抄的独立真值表**（不调用被测实现推导，避免同义反复）：
 * 每档 skill 列出 roll 端点（1 / 各阈值线 / 各阈值线 +1 / 95 / 96 / 99 / 100）的
 * 等级；outcome = 等级属成功档（critical/hard/normal）即 success（普通难度）。
 * 随机面用队列 Rng 桩精确投出目标 roll（d100 分解：100 → (0,0)，其余 → 十位/个位）。
 */

/** 手抄真值表：skill → 部分 roll 端点 → 等级（§5.1 表格） */
const MATRIX: ReadonlyArray<{ skill: number; points: ReadonlyArray<[number, string]> }> = [
  {
    skill: 1,
    points: [
      [1, 'critical'],
      [2, 'fail'],
      [95, 'fail'],
      [96, 'fumble'],
      [99, 'fumble'],
      [100, 'fumble'],
    ],
  },
  {
    skill: 49,
    // critical = extreme = ⌊49/5⌋ = 9；hard = ⌊49/2⌋ = 24
    points: [
      [1, 'critical'],
      [9, 'critical'],
      [10, 'hard'],
      [24, 'hard'],
      [25, 'normal'],
      [49, 'normal'],
      [50, 'fail'],
      [95, 'fail'],
      [96, 'fumble'],
      [100, 'fumble'],
    ],
  },
  {
    skill: 50,
    // critical = extreme = 10；hard = 25；skill ≥ 50 → 大失败仅 roll = 100
    points: [
      [1, 'critical'],
      [10, 'critical'],
      [11, 'hard'],
      [25, 'hard'],
      [26, 'normal'],
      [50, 'normal'],
      [51, 'fail'],
      [96, 'fail'],
      [99, 'fail'],
      [100, 'fumble'],
    ],
  },
  {
    skill: 90,
    // critical = extreme = 18；hard = 45
    points: [
      [1, 'critical'],
      [18, 'critical'],
      [19, 'hard'],
      [45, 'hard'],
      [46, 'normal'],
      [90, 'normal'],
      [91, 'fail'],
      [100, 'fumble'],
    ],
  },
  {
    skill: 95,
    // critical = extreme = 19；hard = 47
    points: [
      [1, 'critical'],
      [19, 'critical'],
      [20, 'hard'],
      [47, 'hard'],
      [48, 'normal'],
      [95, 'normal'],
      [96, 'fail'],
      [100, 'fumble'],
    ],
  },
  {
    skill: 100,
    // critical = extreme = 20；hard = 50；roll 100 仍是大失败（=100 无条件）
    points: [
      [1, 'critical'],
      [20, 'critical'],
      [21, 'hard'],
      [50, 'hard'],
      [51, 'normal'],
      [99, 'normal'],
      [100, 'fumble'],
    ],
  },
];

/** 把目标 roll 分解为队列 Rng 的 d100 骰序 [十位, 个位]（100 → [0, 0]） */
function toDice(roll: number): [number, number] {
  if (roll === 100) return [0, 0];
  return [Math.floor(roll / 10), roll % 10];
}

function resolveRoll(roll: number, skill: number) {
  return cocRule.resolve({ rule: 'coc', value: skill }, queueRng(toDice(roll)));
}

function queueRng(intResults: number[]): Rng {
  const queue = [...intResults];
  return {
    next: () => {
      throw new Error('矩阵用例只应经 int() 投骰');
    },
    int: (minIncl) => {
      const value = queue.shift();
      if (value === undefined) throw new Error('队列 Rng 已耗尽');
      if (value < minIncl || value > 9) throw new Error(`预设骰值 ${value} 越界`);
      return value;
    },
    pick: () => {
      throw new Error('不应调用 pick');
    },
    weighted: () => {
      throw new Error('不应调用 weighted');
    },
    chance: () => {
      throw new Error('不应调用 chance');
    },
    getState: () => 0,
    setState: () => {},
    fork: () => queueRng(queue),
  } as Rng;
}

describe('coc 边界矩阵：skill × roll 端点全等级断言（15 号 commit 7）', () => {
  for (const { skill, points } of MATRIX) {
    it(`skill = ${skill}`, () => {
      for (const [roll, expectedLevel] of points) {
        const result = resolveRoll(roll, skill);
        expect(result.level, `skill=${skill} roll=${roll}`).toBe(expectedLevel);
        expect(result.outcome, `skill=${skill} roll=${roll}`).toBe(
          expectedLevel === 'critical' || expectedLevel === 'hard' || expectedLevel === 'normal'
            ? 'success'
            : 'fail',
        );
      }
    });
  }
});

describe('真实 coc 规则经 check 指令路由（§5.1 结果路由 × 15 号规则联动）', () => {
  it('critical 等级路由 onCritical；fumble 路由 onFumble', () => {
    // roll 10 = ⌊50/5⌋ → critical：onCritical 生效、onSuccess 被跳过
    const { rt } = makeBuiltinRuntime({
      registryOptions: { checkResolver: { resolve: () => cocRule } },
    });
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
      makeCtx({ rng: queueRng([1, 0]) }), // roll 10
    );
    expect(rt.state.world.flags['via_critical']).toBe(true);
    expect(rt.state.world.flags['via_success']).toBeUndefined();

    // roll 100 → fumble：onFumble 生效、onFail 被跳过
    const { rt: rt2 } = makeBuiltinRuntime({
      registryOptions: { checkResolver: { resolve: () => cocRule } },
    });
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
      makeCtx({ rng: queueRng([0, 0]) }), // roll 100
    );
    expect(rt2.state.world.flags['via_fumble']).toBe(true);
    expect(rt2.state.world.flags['via_fail']).toBeUndefined();
  });

  it('check_result 事件携带真实骰值与阈值明细（表现层数据契约）', () => {
    const { rt } = makeBuiltinRuntime({
      registryOptions: { checkResolver: { resolve: () => cocRule } },
    });
    const outcome = rt.exec([{ check: { value: '50' } }], makeCtx({ rng: queueRng([3, 7]) })); // roll 37
    const event = outcome.events[0];
    expect(event).toMatchObject({
      type: 'check_result',
      rule: 'coc',
      rolls: [37],
      level: 'normal',
      outcome: 'success',
      detail: {
        skill: 50,
        roll: 37,
        required: 50,
        thresholds: { hard: 25, extreme: 10, critical: 10 },
      },
    });
  });
});
