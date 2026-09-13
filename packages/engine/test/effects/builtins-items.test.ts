import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import { BASE_VERSIONS, ITEMS, makeBuiltinRuntime, makeCtx } from './fixtures.js';
import type { GameState } from '../../src/state/index.js';

/** 带初始背包的运行时（物品类用例） */
function makeItemRuntime(init?: { bag?: GameState['player']['bag']; bagCapacity?: number }) {
  return makeBuiltinRuntime({
    bootstrap: {
      versions: BASE_VERSIONS,
      attrs: { hp: 30 },
      bag: init?.bag ?? [],
    },
    registryOptions: {
      items: ITEMS,
      ...(init?.bagCapacity !== undefined ? { bagCapacity: init.bagCapacity } : {}),
    },
  });
}

/** 断言 EFFECT_FAILED：外层 code + cause 归因（op）+ cause 消息包含定位细节 */
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

describe('05-B2 give / take：背包增减（FR-ITEM-02）', () => {
  it('give 新建条目与同种类堆叠；count 表达式求值', () => {
    const { rt } = makeItemRuntime();
    rt.exec(
      [
        { give: { item: 'item_herb', count: 2 } },
        { give: { item: 'item_herb', count: '1 + 1' } },
        { give: { item: 'item_herb_green', count: 1 } },
      ],
      makeCtx(),
    );
    expect(rt.state.player.bag).toEqual([
      { itemId: 'item_herb', count: 4 },
      { itemId: 'item_herb_green', count: 1 },
    ]);
  });

  it('take 扣减并在归零时移除条目；不足即失败回滚', () => {
    const { rt } = makeItemRuntime({ bag: [{ itemId: 'item_herb', count: 3 }] });
    rt.exec(
      [{ take: { item: 'item_herb', count: 2 } }, { take: { item: 'item_herb', count: 1 } }],
      makeCtx(),
    );
    expect(rt.state.player.bag).toEqual([]);
    expectFail(() => rt.exec([{ take: { item: 'item_herb' } }], makeCtx()), 'take', '未持有');
  });

  it('容量按条目数计：新建条目超限失败，堆叠续加不受限（13 号堆叠口径）', () => {
    const { rt } = makeItemRuntime({ bagCapacity: 2 });
    rt.exec(
      [{ give: { item: 'item_herb', count: 8 } }, { give: { item: 'item_herb_green' } }],
      makeCtx(),
    );
    expectFail(() => rt.exec([{ give: { item: 'item_sword' } }], makeCtx()), 'give', '背包已满');
    // 堆叠续加（8 → 9，stack 封顶 9）不新建条目，不受容量限制
    rt.exec([{ give: { item: 'item_herb', count: 1 } }], makeCtx());
    expect(rt.state.player.bag).toEqual([
      { itemId: 'item_herb', count: 9 },
      { itemId: 'item_herb_green', count: 1 },
    ]);
  });

  it('数量须为非负整数：负数 / 小数失败；0 为无操作', () => {
    const { rt } = makeItemRuntime({ bag: [{ itemId: 'item_herb', count: 1 }] });
    expectFail(() => rt.exec([{ give: { item: 'item_herb', count: -1 } }], makeCtx()), 'give');
    expectFail(() => rt.exec([{ take: { item: 'item_herb', count: 1.5 } }], makeCtx()), 'take');
    rt.exec([{ give: { item: 'item_herb', count: 0 } }], makeCtx());
    expect(rt.state.player.bag).toEqual([{ itemId: 'item_herb', count: 1 }]);
  });
});

describe('05-B2 equip / unequip：装备栏最简规则（FR-ITEM-03，完整规则属 13 号）', () => {
  it('equip 从背包消耗 1 件并占据 ItemDef.equipSlot；unequip 还原（不可堆叠独立条目）', () => {
    const { rt } = makeItemRuntime({ bag: [{ itemId: 'item_sword', count: 2 }] });
    rt.exec([{ equip: { item: 'item_sword' } }, { unequip: { slot: 'weapon' } }], makeCtx());
    expect(rt.state.player.equip).toEqual({});
    // 不可堆叠（stack 缺省）：每件独占条目（13 任务 1 堆叠口径）
    expect(rt.state.player.bag).toEqual([
      { itemId: 'item_sword', count: 1 },
      { itemId: 'item_sword', count: 1 },
    ]);
  });

  it('equip 后装备栏生效、背包扣减；touch 写域覆盖 equip + bag', () => {
    const { rt } = makeItemRuntime({ bag: [{ itemId: 'item_sword', count: 1 }] });
    const outcome = rt.exec([{ equip: { item: 'item_sword' } }], makeCtx());
    expect(rt.state.player.equip['weapon']).toBe('item_sword');
    expect(rt.state.player.bag).toEqual([]);
    expect(outcome.patches.map((p) => p.path[1])).toContain('equip');
  });

  it('占用槽位 = 交换（现装备回收背包）；非 equip / 未知物品 / 空槽卸下失败', () => {
    const { rt } = makeItemRuntime({ bag: [{ itemId: 'item_sword', count: 2 }] });
    rt.exec([{ equip: { item: 'item_sword' } }], makeCtx());
    // 再穿同槽位：旧件回收背包、新件穿上（13 任务 2 交换语义）
    rt.exec([{ equip: { item: 'item_sword' } }], makeCtx());
    expect(rt.state.player.equip['weapon']).toBe('item_sword');
    expect(rt.state.player.bag).toEqual([{ itemId: 'item_sword', count: 1 }]);
    expectFail(() => rt.exec([{ equip: { item: 'item_herb' } }], makeCtx()), 'equip', '非 equip');
    expectFail(() => rt.exec([{ equip: { item: 'item_ghost' } }], makeCtx()), 'equip', '未知物品');
    expectFail(() => rt.exec([{ unequip: { slot: 'finger' } }], makeCtx()), 'unequip', '为空');
  });
});

describe('05-B2 wear / remove：多层服装最简规则（FR-ITEM-04，完整规则属 13 号）', () => {
  it('wear 消耗背包写入 outfit[part][layer]；remove 按 itemId 还原', () => {
    const { rt } = makeItemRuntime({ bag: [{ itemId: 'item_cotton_shirt', count: 1 }] });
    rt.exec([{ wear: { item: 'item_cotton_shirt' } }], makeCtx());
    expect(rt.state.player.outfit).toEqual({ chest: { '1': 'item_cotton_shirt' } });
    expect(rt.state.player.bag).toEqual([]);
    rt.exec([{ remove: { item: 'item_cotton_shirt' } }], makeCtx());
    expect(rt.state.player.outfit).toEqual({});
    expect(rt.state.player.bag).toEqual([{ itemId: 'item_cotton_shirt', count: 1 }]);
  });

  it('同 part 不同 layer 可并存；同 part 同 layer 冲突报错（基础规则）', () => {
    const { rt } = makeItemRuntime({
      bag: [
        { itemId: 'item_cotton_shirt', count: 1 },
        { itemId: 'item_wool_coat', count: 2 },
      ],
    });
    rt.exec(
      [{ wear: { item: 'item_cotton_shirt' } }, { wear: { item: 'item_wool_coat' } }],
      makeCtx(),
    );
    expect(rt.state.player.outfit['chest']).toEqual({
      '1': 'item_cotton_shirt',
      '2': 'item_wool_coat',
    });
    expectFail(() => rt.exec([{ wear: { item: 'item_wool_coat' } }], makeCtx()), 'wear', '占用');
  });

  it('preset 应用：未知预设显性报错；未穿戴 remove 报错', () => {
    const { rt } = makeItemRuntime({ bag: [{ itemId: 'item_cotton_shirt', count: 1 }] });
    expectFail(
      () => rt.exec([{ wear: { preset: 'outfit_home' } }], makeCtx()),
      'wear',
      '不存在',
    );
    expectFail(() => rt.exec([{ remove: { item: 'item_cotton_shirt' } }], makeCtx()), 'remove');
  });

  it('garment 类型校验与背包校验：非 garment / 未持有失败', () => {
    const { rt } = makeItemRuntime({ bag: [{ itemId: 'item_sword', count: 1 }] });
    expectFail(() => rt.exec([{ wear: { item: 'item_sword' } }], makeCtx()), 'wear', '非 garment');
    expectFail(() => rt.exec([{ wear: { item: 'item_wool_coat' } }], makeCtx()), 'wear');
  });
});

describe('05-B2 物品类指令：未知物品与目录缺省语义', () => {
  it('give/take 不依赖物品目录（悬空引用归加载器 crossRef）；equip 需目录解析槽位', () => {
    const { rt } = makeBuiltinRuntime({
      bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 30 } },
    });
    rt.exec([{ give: { item: 'item_anything' } }], makeCtx());
    expect(rt.state.player.bag).toEqual([{ itemId: 'item_anything', count: 1 }]);
    expectFail(
      () => rt.exec([{ equip: { item: 'item_anything' } }], makeCtx()),
      'equip',
      '未知物品',
    );
  });
});
