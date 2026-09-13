import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import type { ItemDef } from '@game/shared';
import { BASE_VERSIONS, makeBuiltinRuntime, makeCtx } from '../effects/fixtures.js';
import type { GameState } from '../effects/fixtures.js';

/**
 * 13 任务 3：wear 冲突规则（§4.7，FR-ITEM-04）。
 *
 * 同 part 同 layer 已有穿着时，以**新穿戴件**的 garment.swappable 为准：
 * - true → 旧件回收背包、新件替换（换装流水线的引擎侧语义）；
 * - 缺省 false → 拒绝（EFFECT_FAILED，作者前置 if 判断处理）。
 * 中立性：coverage 等开放字段引擎只透传不解释（无任何语义分支）。
 */

/** 服装目录：chest 层 1 有普通/可替换两件，chest 层 2 一件外套 */
const WEAR_ITEMS: ReadonlyMap<string, ItemDef> = new Map(
  (
    [
      {
        id: 'item_shirt_a',
        nameKey: 'items.shirt_a.name',
        type: 'garment',
        garment: { part: 'chest', layer: 1 },
      },
      {
        id: 'item_shirt_b',
        nameKey: 'items.shirt_b.name',
        type: 'garment',
        // coverage 为开放数据字段：引擎不解释，仅验证透传不报错（中立性）
        garment: { part: 'chest', layer: 1, swappable: true, coverage: 3 },
      },
      {
        id: 'item_coat',
        nameKey: 'items.coat.name',
        type: 'garment',
        garment: { part: 'chest', layer: 2 },
      },
    ] as ItemDef[]
  ).map((def) => [def.id, def]),
);

function makeWearRuntime(init?: { bag?: GameState['player']['bag']; bagCapacity?: number }) {
  return makeBuiltinRuntime({
    bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 30 }, bag: init?.bag ?? [] },
    registryOptions: {
      items: WEAR_ITEMS,
      ...(init?.bagCapacity !== undefined ? { bagCapacity: init.bagCapacity } : {}),
    },
  });
}

function expectWearFail(run: () => unknown, contains?: string): void {
  try {
    run();
    expect.unreachable('应当失败');
  } catch (err) {
    const engineErr = err as EngineError;
    expect(engineErr.code).toBe('EFFECT_FAILED');
    const cause = engineErr.cause as EngineError;
    expect(cause.where.op).toBe('wear');
    if (contains !== undefined) expect(cause.message).toContain(contains);
  }
}

describe('13-3 wear 冲突规则：swappable 决定拒绝/替换', () => {
  it('缺省（不可替换）：同 part 同 layer 已占用 → 拒绝且状态不变', () => {
    const { rt } = makeWearRuntime({
      bag: [
        { itemId: 'item_shirt_a', count: 1 },
        { itemId: 'item_shirt_b', count: 1 },
      ],
    });
    rt.exec([{ wear: { item: 'item_shirt_a' } }], makeCtx());
    expectWearFail(() => rt.exec([{ wear: { item: 'item_shirt_a' } }], makeCtx()), '占用');
    // 失败回滚：outfit 与背包保持原状（shirt_a 已穿，背包剩 shirt_b）
    expect(rt.state.player.outfit).toEqual({ chest: { '1': 'item_shirt_a' } });
    expect(rt.state.player.bag).toEqual([{ itemId: 'item_shirt_b', count: 1 }]);
  });

  it('swappable=true：旧件回收背包、新件替换（coverage 透传不解释）', () => {
    const { rt } = makeWearRuntime({
      bag: [
        { itemId: 'item_shirt_a', count: 1 },
        { itemId: 'item_shirt_b', count: 1 },
      ],
    });
    rt.exec([{ wear: { item: 'item_shirt_a' } }], makeCtx());
    rt.exec([{ wear: { item: 'item_shirt_b' } }], makeCtx());
    expect(rt.state.player.outfit).toEqual({ chest: { '1': 'item_shirt_b' } });
    expect(rt.state.player.bag).toEqual([{ itemId: 'item_shirt_a', count: 1 }]);
  });

  it('swappable 替换的旧件回收触发容量校验：容量满 → 整体失败回滚', () => {
    const { rt } = makeWearRuntime({
      bag: [
        { itemId: 'item_shirt_a', count: 1 },
        { itemId: 'item_shirt_b', count: 1 },
        { itemId: 'item_herb', count: 1 },
      ],
      bagCapacity: 1,
    });
    rt.exec([{ wear: { item: 'item_shirt_a' } }], makeCtx());
    expect(rt.state.player.bag).toEqual([
      { itemId: 'item_shirt_b', count: 1 },
      { itemId: 'item_herb', count: 1 },
    ]);
    // 替换需回收旧件 → 新建条目超容量（b 消耗后仍有 herb 占 1 位）→ 整体失败
    expectWearFail(() => rt.exec([{ wear: { item: 'item_shirt_b' } }], makeCtx()), '背包已满');
    expect(rt.state.player.outfit).toEqual({ chest: { '1': 'item_shirt_a' } });
    expect(rt.state.player.bag).toEqual([
      { itemId: 'item_shirt_b', count: 1 },
      { itemId: 'item_herb', count: 1 },
    ]);
  });

  it('同 part 不同 layer 互不冲突（层语义，与 swappable 无关）', () => {
    const { rt } = makeWearRuntime({
      bag: [
        { itemId: 'item_shirt_a', count: 1 },
        { itemId: 'item_coat', count: 1 },
      ],
    });
    rt.exec([{ wear: { item: 'item_shirt_a' } }, { wear: { item: 'item_coat' } }], makeCtx());
    expect(rt.state.player.outfit['chest']).toEqual({
      '1': 'item_shirt_a',
      '2': 'item_coat',
    });
  });
});
