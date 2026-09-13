import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import type { ItemDef } from '@game/shared';
import { bagCount, bagGive, bagMerge, bagSplit, bagTake } from '../../src/items/inventory.js';

/**
 * 13 任务 1：Inventory 纯函数矩阵（§4.7，FR-ITEM-02）。
 *
 * 口径（与容量按条目数计一致）：
 * - 可堆叠（stack 定义）：条目 count 封顶 stack，超出拆新条目（容量按新建条目校验）；
 * - 不可堆叠（stack 缺省）：每件独占一条目（count 恒 1）——容量语义才自洽；
 * - 纯函数：入参 bag 不变异，返回新数组；失败抛 EngineError(EFFECT_FAILED)，
 *   指令层直接透传（05 号 give/take 的 EFFECT_FAILED 语义不变）。
 */

/** 物品定义快捷构造（stack 缺省 = 不可堆叠） */
function def(id: string, overrides?: Partial<ItemDef>): ItemDef {
  return { id, nameKey: `items.${id}.name`, type: 'normal', ...overrides };
}

function expectFail(run: () => unknown, contains?: string): EngineError {
  try {
    run();
    expect.unreachable('应当失败');
  } catch (err) {
    const engineErr = err as EngineError;
    expect(engineErr.code).toBe('EFFECT_FAILED');
    if (contains !== undefined) expect(engineErr.message).toContain(contains);
    return engineErr;
  }
  throw new Error('unreachable');
}

describe('13-1 bagGive：堆叠与容量', () => {
  it('可堆叠：未满条目续加（同一 itemId 一条）', () => {
    const bag = bagGive([{ itemId: 'herb', count: 3 }], def('herb', { stack: 9 }), 4);
    expect(bag).toEqual([{ itemId: 'herb', count: 7 }]);
  });

  it('可堆叠：超出 stack 上限拆多条目（8+4 → [9,3]）', () => {
    const bag = bagGive([{ itemId: 'herb', count: 8 }], def('herb', { stack: 9 }), 4);
    expect(bag).toEqual([
      { itemId: 'herb', count: 9 },
      { itemId: 'herb', count: 3 },
    ]);
  });

  it('不可堆叠：每件独占条目（count 恒 1）', () => {
    let bag = bagGive([], def('sword'), 1);
    bag = bagGive(bag, def('sword'), 1);
    expect(bag).toEqual([
      { itemId: 'sword', count: 1 },
      { itemId: 'sword', count: 1 },
    ]);
  });

  it('容量：新建条目超限 → EFFECT_FAILED（堆叠续加不受容量限制）', () => {
    const full = [
      { itemId: 'a', count: 1 },
      { itemId: 'b', count: 1 },
    ];
    expectFail(() => bagGive(full, def('c'), 1, 2), '背包已满');
    const ok = bagGive(full, def('a', { stack: 9 }), 1, 2);
    expect(ok).toEqual([
      { itemId: 'a', count: 2 },
      { itemId: 'b', count: 1 },
    ]);
  });

  it('容量：一次 give 拆多条目时整体校验（放不下整批失败，不产生半截结果）', () => {
    const full = [
      { itemId: 'a', count: 1 },
      { itemId: 'b', count: 1 },
    ];
    expectFail(() => bagGive(full, def('herb', { stack: 9 }), 12, 2), '背包已满');
  });

  it('count 须为正整数（0/负数/小数拒绝）', () => {
    expectFail(() => bagGive([], def('herb', { stack: 9 }), 0));
    expectFail(() => bagGive([], def('herb', { stack: 9 }), -1));
    expectFail(() => bagGive([], def('herb', { stack: 9 }), 1.5));
  });

  it('入参 bag 不变异（纯函数）', () => {
    const bag = [{ itemId: 'herb', count: 1 }];
    bagGive(bag, def('herb', { stack: 9 }), 2);
    expect(bag).toEqual([{ itemId: 'herb', count: 1 }]);
  });
});

describe('13-1 bagTake：跨条目扣减', () => {
  it('单条目足量扣减；归零移除条目', () => {
    expect(bagTake([{ itemId: 'herb', count: 3 }], 'herb', 2)).toEqual([
      { itemId: 'herb', count: 1 },
    ]);
    expect(bagTake([{ itemId: 'herb', count: 3 }], 'herb', 3)).toEqual([]);
  });

  it('跨条目扣减（可堆叠拆分后的多条目）', () => {
    const bag = [
      { itemId: 'herb', count: 2 },
      { itemId: 'herb', count: 5 },
    ];
    expect(bagTake(bag, 'herb', 6)).toEqual([{ itemId: 'herb', count: 1 }]);
  });

  it('不足 → EFFECT_FAILED（携带需求数与实际数）', () => {
    expectFail(() => bagTake([{ itemId: 'herb', count: 2 }], 'herb', 3), '未持有足够物品');
    expectFail(() => bagTake([], 'herb', 1), '未持有足够物品');
  });
});

describe('13-1 bagCount：持有量', () => {
  it('同 itemId 条目计数求和', () => {
    const bag = [
      { itemId: 'herb', count: 2 },
      { itemId: 'other', count: 1 },
      { itemId: 'herb', count: 5 },
    ];
    expect(bagCount(bag, 'herb')).toBe(7);
    expect(bagCount(bag, 'missing')).toBe(0);
  });
});

describe('13-1 bagSplit / bagMerge：堆叠管理', () => {
  it('split：从条目拆出 count 到新条目（部分移动的 UI 前提）', () => {
    const bag = bagSplit([{ itemId: 'herb', count: 9 }], def('herb', { stack: 9 }), 3);
    expect(bag).toEqual([
      { itemId: 'herb', count: 6 },
      { itemId: 'herb', count: 3 },
    ]);
  });

  it('split：非堆叠物品 / 数量非法 / 超出条目余量 → 拒绝', () => {
    expectFail(() => bagSplit([{ itemId: 'sword', count: 1 }], def('sword'), 1), '不可堆叠');
    expectFail(() => bagSplit([{ itemId: 'herb', count: 3 }], def('herb', { stack: 9 }), 3), '余量');
    expectFail(() => bagSplit([{ itemId: 'herb', count: 3 }], def('herb', { stack: 9 }), 0));
  });

  it('merge：同 itemId 条目收敛为 stack 封顶的最少条目（其余条目原位保留）', () => {
    const bag = [
      { itemId: 'herb', count: 5 },
      { itemId: 'other', count: 1 },
      { itemId: 'herb', count: 7 },
      { itemId: 'herb', count: 2 },
    ];
    expect(bagMerge(bag, def('herb', { stack: 9 }))).toEqual([
      { itemId: 'herb', count: 9 },
      { itemId: 'other', count: 1 },
      { itemId: 'herb', count: 5 },
    ]);
  });

  it('merge：非堆叠物品拒绝（多条目各代表一件，不可合并）', () => {
    expectFail(
      () =>
        bagMerge(
          [
            { itemId: 'sword', count: 1 },
            { itemId: 'sword', count: 1 },
          ],
          def('sword'),
        ),
      '不可堆叠',
    );
  });
});
