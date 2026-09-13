import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import type { ItemDef } from '@game/shared';
import { BASE_VERSIONS, makeBuiltinRuntime, makeCtx } from '../effects/fixtures.js';
import type { GameState } from '../effects/fixtures.js';

/**
 * 13 任务 4：换装预设（FR-ITEM-05，§4.7）。
 *
 * 口径：
 * - 快照存储：player.outfitPresets[预设名] = 当前 outfit 全量（设计 §4.7 写
 *   world.flags，但 flagValueSchema 仅允许标量——偏差改为独立状态域，序列化
 *   投影同步扩列；预设名沿用 `__outfit_preset_<name>` 约定）；
 * - 保存：内部指令 `__outfit.save_preset`（引擎内部面，不面向作者；换装 UI
 *   宿主调用，同 `__time.advance` 模式）；
 * - 应用：`wear {preset}`——先从背包取回预设各件（缺件 EFFECT_FAILED），再
 *   把当前穿着回收背包；全程单事务原子。
 */

const PRESET_ITEMS: ReadonlyMap<string, ItemDef> = new Map(
  (
    [
      {
        id: 'item_shirt_a',
        nameKey: 'items.shirt_a.name',
        type: 'garment',
        garment: { part: 'chest', layer: 1 },
      },
      {
        id: 'item_coat',
        nameKey: 'items.coat.name',
        type: 'garment',
        garment: { part: 'chest', layer: 2 },
      },
      {
        id: 'item_hat',
        nameKey: 'items.hat.name',
        type: 'garment',
        garment: { part: 'head', layer: 1 },
      },
    ] as ItemDef[]
  ).map((def) => [def.id, def]),
);

function makePresetRuntime(bag: GameState['player']['bag']) {
  return makeBuiltinRuntime({
    bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 30 }, bag },
    registryOptions: { items: PRESET_ITEMS },
  });
}

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

describe('13-4 换装预设：快照存取与应用', () => {
  it('__outfit.save_preset 快照当前穿着；wear{preset} 应用（当前穿着回收背包）', () => {
    const { rt } = makePresetRuntime([
      { itemId: 'item_shirt_a', count: 1 },
      { itemId: 'item_coat', count: 1 },
      { itemId: 'item_hat', count: 1 },
    ]);
    rt.exec(
      [
        { wear: { item: 'item_shirt_a' } },
        { wear: { item: 'item_coat' } },
        { '__outfit.save_preset': { name: '__outfit_preset_formal' } },
      ],
      makeCtx(),
    );
    expect(rt.state.player.outfitPresets['__outfit_preset_formal']).toEqual({
      chest: { '1': 'item_shirt_a', '2': 'item_coat' },
    });
    // 换上另一套：脱下 coat、戴上 hat
    rt.exec([{ remove: { item: 'item_coat' } }, { wear: { item: 'item_hat' } }], makeCtx());
    // 应用预设：hat 回收背包、coat 从背包穿回
    rt.exec([{ wear: { preset: '__outfit_preset_formal' } }], makeCtx());
    expect(rt.state.player.outfit).toEqual({
      chest: { '1': 'item_shirt_a', '2': 'item_coat' },
    });
    expect(rt.state.player.bag).toEqual([{ itemId: 'item_hat', count: 1 }]);
  });

  it('预设缺件 → EFFECT_FAILED 整体回滚（背包与穿着不变）', () => {
    const { rt } = makePresetRuntime([
      { itemId: 'item_shirt_a', count: 1 },
      { itemId: 'item_coat', count: 1 },
    ]);
    rt.exec(
      [
        { wear: { item: 'item_shirt_a' } },
        { wear: { item: 'item_coat' } },
        { '__outfit.save_preset': { name: '__outfit_preset_formal' } },
      ],
      makeCtx(),
    );
    // coat 被移出背包后应用预设 → 缺件失败
    rt.exec([{ remove: { item: 'item_coat' } }, { take: { item: 'item_coat' } }], makeCtx());
    expectFail(
      () => rt.exec([{ wear: { preset: '__outfit_preset_formal' } }], makeCtx()),
      'wear',
      '未持有',
    );
    expect(rt.state.player.outfit).toEqual({ chest: { '1': 'item_shirt_a' } });
  });

  it('未知预设 → EFFECT_FAILED；重复保存覆盖旧快照', () => {
    const { rt } = makePresetRuntime([{ itemId: 'item_shirt_a', count: 1 }]);
    expectFail(
      () => rt.exec([{ wear: { preset: '__outfit_preset_ghost' } }], makeCtx()),
      'wear',
      '不存在',
    );
    rt.exec(
      [{ wear: { item: 'item_shirt_a' } }, { '__outfit.save_preset': { name: 'p1' } }],
      makeCtx(),
    );
    expect(rt.state.player.outfitPresets['p1']).toEqual({ chest: { '1': 'item_shirt_a' } });
  });
});
