import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '../src/index.js';
import type { Rng, RngState, WeightedEntry } from '../src/index.js';

/**
 * canonical mulberry32（DD-09 默认算法）在种子 42 下的前 100 个输出值。
 * 由独立参考实现生成后钉死在此处：任何算法实现偏差都会被本序列逐位捕获。
 */
const MULBERRY32_SEED_42_FIRST_100 = [
  0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
  0.17481389874592423, 0.5265925421845168, 0.2732279943302274, 0.6247446539346129,
  0.8654746483080089, 0.4723170551005751, 0.24992373422719538, 0.8820588334929198,
  0.7457375649828464, 0.3070015134289861, 0.19725383794866502, 0.5007294877432287,
  0.6866120179183781, 0.6106208984274417, 0.003842951962724328, 0.47078192373737693,
  0.8373374259099364, 0.05120926629751921, 0.5923239905387163, 0.03153795562684536,
  0.2669559868518263, 0.06178139243274927, 0.18568900716491044, 0.7835472931619734,
  0.530335606308654, 0.027123609324917197, 0.17300523445010185, 0.8426881253253669,
  0.4877399173565209, 0.8090229837689549, 0.3194617456756532, 0.44989572861231863,
  0.03743921360000968, 0.05139273451641202, 0.5565997792873532, 0.5967295127920806,
  0.24517467361874878, 0.6456944046076387, 0.20951048866845667, 0.30362963443621993,
  0.7386213727295399, 0.8587109192740172, 0.5079962892923504, 0.2041900979820639,
  0.28420698270201683, 0.29299163701944053, 0.07469462975859642, 0.6598597934935242,
  0.6807689322158694, 0.6930881165899336, 0.927839900366962, 0.08796802558936179,
  0.9437352467793971, 0.43113749707117677, 0.942294550826773, 0.13729840773157775,
  0.11094316560775042, 0.015842905268073082, 0.3604456859175116, 0.48172251763753593,
  0.611922019161284, 0.8995579732581973, 0.07758240564726293, 0.7195980150718242, 0.934867731994018,
  0.2782514716964215, 0.7065853946842253, 0.1796227190643549, 0.5203163539990783,
  0.8218917581252754, 0.12059257342480123, 0.9956386350095272, 0.562800214625895,
  0.9161201647948474, 0.4339903697837144, 0.5784530241508037, 0.3369620821904391,
  0.5962391037028283, 0.3229577951133251, 0.7294139908626676, 0.2952086783479899,
  0.4497627364471555, 0.8431257682386786, 0.6950652054511011, 0.9940114878118038,
  0.8901981303934008, 0.431891469983384, 0.5452131326310337, 0.29592951526865363,
  0.1008774396032095, 0.6967215123586357, 0.3133056035730988, 0.7859425814822316,
  0.9047754912171513, 0.09364134701900184, 0.47539179865270853,
];

describe('createRng（mulberry32，设计 §2.5 / DD-09）', () => {
  it('固定种子 42 的前 100 个 next() 值与参考序列逐位一致（确定性）', () => {
    const rng = createRng(42);
    const values = Array.from({ length: 100 }, () => rng.next());
    expect(values).toEqual(MULBERRY32_SEED_42_FIRST_100);
  });

  it('同一种子的两个实例产生相同序列（同种子可回放，DD-09）', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('不同种子产生不同序列（换节点不可预判，DD-09）', () => {
    const a = createRng(1);
    const b = createRng(2);
    const firstA = Array.from({ length: 8 }, () => a.next());
    const firstB = Array.from({ length: 8 }, () => b.next());
    expect(firstA).not.toEqual(firstB);
  });

  it('next() 输出始终落在 [0, 1) 区间', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('createRng 返回完整的 Rng 接口（§2.5 方法面）', () => {
    const rng: Rng = createRng(1);
    for (const method of [
      'next',
      'int',
      'pick',
      'weighted',
      'chance',
      'getState',
      'setState',
      'fork',
    ] as const) {
      expect(typeof rng[method]).toBe('function');
    }
  });
});

/** 断言 fn 抛出携带指定 messageKey 的 EngineError（INTERNAL） */
function expectInternalError(fn: () => unknown, messageKey: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(EngineError);
  const engineError = caught as EngineError;
  expect(engineError.code).toBe('INTERNAL');
  expect(engineError.messageKey).toBe(messageKey);
}

describe('int 边界（设计 §2.5）', () => {
  it('min = max 时恒返回该值（不消耗随机性语义仍确定）', () => {
    const rng = createRng(42);
    for (let i = 0; i < 10; i++) {
      expect(rng.int(5, 5)).toBe(5);
    }
  });

  it('int(1,6) 与钉死的 next() 序列按 min + floor(next * range) 对应', () => {
    const rng = createRng(42);
    const expected = MULBERRY32_SEED_42_FIRST_100.map((v) => 1 + Math.floor(v * 6));
    const dice = Array.from({ length: 100 }, () => rng.int(1, 6));
    expect(dice).toEqual(expected);
  });

  it('区间内各取值均可达且不越界（0..3，1000 抽）', () => {
    const rng = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const value = rng.int(0, 3);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(3);
      expect(Number.isInteger(value)).toBe(true);
      seen.add(value);
    }
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });

  it.each([
    { label: 'min > max', min: 3, max: 1 },
    { label: '非整数下界', min: 0.5, max: 3 },
    { label: '非整数上界', min: 0, max: 2.5 },
  ])('非法区间（$label）抛 EngineError/INTERNAL', ({ min, max }) => {
    const rng = createRng(42);
    expectInternalError(() => rng.int(min, max), 'error.rng.intBounds');
  });
});

describe('pick 边界（设计 §2.5）', () => {
  it('单元素池恒返回该元素', () => {
    const rng = createRng(42);
    for (let i = 0; i < 10; i++) {
      expect(rng.pick(['only'])).toBe('only');
    }
  });

  it('等概率抽取与钉死的 next() 序列按 floor(next * length) 对应', () => {
    const rng = createRng(42);
    const pool = ['heads', 'tails'] as const;
    const expected = MULBERRY32_SEED_42_FIRST_100.slice(0, 20).map(
      (v) => pool[Math.floor(v * 2)] as string,
    );
    const picks = Array.from({ length: 20 }, () => rng.pick(pool));
    expect(picks).toEqual(expected);
  });

  it('空池抛 EngineError/INTERNAL（不返回 undefined）', () => {
    const rng = createRng(42);
    expectInternalError(() => rng.pick([]), 'error.rng.emptyPool');
  });
});

describe('weighted 边界（设计 §2.5）', () => {
  it('权重 0 的条目永不被选中（有其他正权重时）', () => {
    const rng = createRng(42);
    const entries: readonly WeightedEntry<string>[] = [
      { item: 'never', weight: 0 },
      { item: 'always', weight: 5 },
    ];
    for (let i = 0; i < 100; i++) {
      expect(rng.weighted(entries)).toBe('always');
    }
  });

  it('按权重比例分配：权重 1:3 时稀有项与常见项都出现且常见项更多', () => {
    const rng = createRng(123);
    const entries: readonly WeightedEntry<string>[] = [
      { item: 'rare', weight: 1 },
      { item: 'common', weight: 3 },
    ];
    const counts = { rare: 0, common: 0 };
    for (let i = 0; i < 2000; i++) {
      counts[rng.weighted(entries) as 'rare' | 'common'] += 1;
    }
    expect(counts.rare).toBeGreaterThan(0);
    expect(counts.common).toBeGreaterThan(counts.rare);
  });

  it('首抽结果与钉死的 next() 序列按 roll = next * total、累计权重命中对应', () => {
    const rng = createRng(42);
    // v0 = 0.6011…，total = 4，roll ≈ 2.4044 → 落入累计 [1, 4) 的 second
    expect(
      rng.weighted([
        { item: 'first', weight: 1 },
        { item: 'second', weight: 3 },
      ]),
    ).toBe('second');
  });

  it('空池抛 EngineError/INTERNAL', () => {
    const rng = createRng(42);
    expectInternalError(() => rng.weighted([]), 'error.rng.emptyPool');
  });

  it('权重为负抛 EngineError/INTERNAL（带条目定位）', () => {
    const rng = createRng(42);
    expectInternalError(
      () =>
        rng.weighted([
          { item: 'ok', weight: 1 },
          { item: 'bad', weight: -0.5 },
        ]),
      'error.rng.negativeWeight',
    );
  });

  it('全 0 权重（总权重 ≤ 0）抛 EngineError/INTERNAL', () => {
    const rng = createRng(42);
    expectInternalError(
      () =>
        rng.weighted([
          { item: 'a', weight: 0 },
          { item: 'b', weight: 0 },
        ]),
      'error.rng.zeroWeightTotal',
    );
    expectInternalError(
      () => rng.weighted([{ item: 'a', weight: 0 }]),
      'error.rng.zeroWeightTotal',
    );
  });

  it('非有限权重（NaN / Infinity）抛 EngineError/INTERNAL', () => {
    const rng = createRng(42);
    expectInternalError(
      () => rng.weighted([{ item: 'a', weight: Number.NaN }]),
      'error.rng.negativeWeight',
    );
    expectInternalError(
      () => rng.weighted([{ item: 'a', weight: Number.POSITIVE_INFINITY }]),
      'error.rng.negativeWeight',
    );
  });
});

describe('chance 边界（设计 §2.5）', () => {
  it('p = 0 恒为 false', () => {
    const rng = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
    }
  });

  it('p = 1 恒为 true', () => {
    const rng = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('p = 0.5 时真假均出现且比例接近（1000 抽）', () => {
    const rng = createRng(2024);
    let truthy = 0;
    for (let i = 0; i < 1000; i++) {
      if (rng.chance(0.5)) truthy += 1;
    }
    expect(truthy).toBeGreaterThan(400);
    expect(truthy).toBeLessThan(600);
  });

  it.each([
    { label: 'p < 0', p: -0.1 },
    { label: 'p > 1', p: 1.5 },
    { label: 'NaN', p: Number.NaN },
    { label: 'Infinity', p: Number.POSITIVE_INFINITY },
  ])('非法概率（$label）抛 EngineError/INTERNAL', ({ p }) => {
    const rng = createRng(42);
    expectInternalError(() => rng.chance(p), 'error.rng.chanceProbability');
  });
});

describe('getState / setState 往返一致性（设计 §2.5，DD-09）', () => {
  it('初始状态等于种子（uint32 归一化）', () => {
    expect(createRng(42).getState()).toBe(42);
  });

  it('RngState 为 JSON 可序列化数值（随存档保存的前提）', () => {
    const rng = createRng(123456789);
    rng.int(1, 6);
    const state = rng.getState();
    const roundTripped = JSON.parse(JSON.stringify(state)) as RngState;
    expect(roundTripped).toBe(state);
    expect(Number.isInteger(state)).toBe(true);
  });

  it('setState(getState()) 后序列保持不变（状态恒等往返）', () => {
    const reference = createRng(77);
    const rng = createRng(77);
    for (let i = 0; i < 5; i++) {
      reference.next();
      rng.next();
    }
    rng.setState(rng.getState());
    for (let i = 0; i < 50; i++) {
      expect(rng.next()).toBe(reference.next());
    }
  });

  it('状态推进：消耗随机值后状态改变', () => {
    const rng = createRng(42);
    const before = rng.getState();
    rng.next();
    expect(rng.getState()).not.toBe(before);
  });

  it('跨实例恢复：任意实例 setState 后即从该状态继续同一序列', () => {
    const source = createRng(100);
    for (let i = 0; i < 10; i++) source.int(1, 6);
    const saved = source.getState();
    const mainline = Array.from({ length: 20 }, () => source.int(1, 6));

    const restored = createRng(0);
    restored.setState(saved);
    const replay = Array.from({ length: 20 }, () => restored.int(1, 6));
    expect(replay).toEqual(mainline);
  });

  it('存档语义：读档恢复 rngState 后的抽选与保存时刻起的主时间线一致（可回放）', () => {
    const rng = createRng(2024);
    // 存档前的游玩消耗
    for (let i = 0; i < 7; i++) {
      rng.pick(['a', 'b', 'c']);
      rng.weighted([
        { item: 'x', weight: 3 },
        { item: 'y', weight: 1 },
      ]);
      rng.chance(0.7);
    }
    const saved = rng.getState();

    // 主时间线继续推进
    const futureMainline = Array.from({ length: 30 }, () => rng.int(-5, 5));

    // 读档：仅凭 rngState 复原行为
    const restored = createRng(0);
    restored.setState(saved);
    const replay = Array.from({ length: 30 }, () => restored.int(-5, 5));
    expect(replay).toEqual(futureMainline);
  });

  it('setState 非有限值抛 EngineError/INTERNAL（防静默错状态）', () => {
    const rng = createRng(42);
    expectInternalError(() => rng.setState(Number.NaN), 'error.rng.invalidState');
    expectInternalError(() => rng.setState(Number.POSITIVE_INFINITY), 'error.rng.invalidState');
  });

  it('uint32 全域状态值可往返（含高位溢出边界）', () => {
    const rng = createRng(0);
    for (const state of [0, 1, 2147483647, 2147483648, 4294967295]) {
      rng.setState(state);
      expect(rng.getState()).toBe(state);
    }
  });
});

describe('fork() 分叉不回写语义（设计 §2.5 边界）', () => {
  it('fork 不消耗、不回写主序列：子源抽选后主序列与参考序列逐位一致', () => {
    const rng = createRng(42);
    const head = Array.from({ length: 3 }, () => rng.next());
    expect(head).toEqual(MULBERRY32_SEED_42_FIRST_100.slice(0, 3));

    const stateBeforeFork = rng.getState();
    const child = rng.fork();
    const jittered = Array.from({ length: 50 }, () => child.next());
    expect(jittered).toHaveLength(50); // 子源已被大量消耗

    expect(rng.getState()).toBe(stateBeforeFork); // fork 与子源抽选均不回写父状态
    const main = Array.from({ length: 7 }, () => rng.next());
    // 主序列不受影响：继续与参考序列下标 3..9 逐位一致
    expect(main).toEqual(MULBERRY32_SEED_42_FIRST_100.slice(3, 10));
  });

  it('子源抽选不改变父源状态（getState 前后一致）', () => {
    const rng = createRng(42);
    const stateBefore = rng.getState();
    const child = rng.fork();
    for (let i = 0; i < 50; i++) {
      child.next();
    }
    expect(rng.getState()).toBe(stateBefore);
  });

  it('同一父状态分叉出的子序列相同（表现层抖动可复现）', () => {
    const a = createRng(1234);
    for (let i = 0; i < 5; i++) a.int(1, 6);
    const b = createRng(1234);
    for (let i = 0; i < 5; i++) b.int(1, 6);

    const childA = a.fork();
    const childB = b.fork();
    const seqA = Array.from({ length: 20 }, () => childA.next());
    const seqB = Array.from({ length: 20 }, () => childB.next());
    expect(seqA).toEqual(seqB);
  });

  it('不同父状态下分叉出的子序列不同（抖动随进度演化）', () => {
    const rng = createRng(7);
    const childEarly = rng.fork();
    const earlySeq = Array.from({ length: 10 }, () => childEarly.next());
    for (let i = 0; i < 30; i++) {
      rng.next();
    }
    const childLate = rng.fork();
    const lateSeq = Array.from({ length: 10 }, () => childLate.next());
    expect(earlySeq).not.toEqual(lateSeq);
  });

  it('子源是完整的 Rng（可继续 int/chance/getState 等）', () => {
    const child: Rng = createRng(42).fork();
    expect(Number.isInteger(child.int(1, 6))).toBe(true);
    expect(typeof child.chance(0.5)).toBe('boolean');
    expect(Number.isFinite(child.getState())).toBe(true);
    expect(typeof child.fork().next()).toBe('number');
  });

  it('战斗表现层抖动语义：做不做表现层分叉，游戏逻辑时间线完全一致', () => {
    const playTimeline = (withJitter: boolean): { mainline: number[]; jitter: number[] } => {
      const rng = createRng(99);
      const mainline: number[] = [];
      const jitter: number[] = [];
      for (let turn = 0; turn < 5; turn++) {
        mainline.push(rng.int(1, 20)); // 游戏逻辑：命中判定
        if (withJitter) {
          const fx = rng.fork(); // 表现层：命中抖动偏移
          jitter.push(fx.int(-3, 3), fx.chance(0.5) ? 1 : 0);
        }
        mainline.push(rng.chance(0.5) ? 1 : 0); // 游戏逻辑：掉落
      }
      return { mainline, jitter };
    };

    const withoutJitter = playTimeline(false);
    const withJitter = playTimeline(true);
    expect(withJitter.jitter.length).toBeGreaterThan(0);
    expect(withJitter.mainline).toEqual(withoutJitter.mainline);
  });
});
