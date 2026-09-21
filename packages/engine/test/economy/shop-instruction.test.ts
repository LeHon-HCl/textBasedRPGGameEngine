import { describe, expect, it } from 'vitest';
import { effectParamSchemas } from '@game/shared';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import { BASE_VERSIONS, fxCompile, makeBuiltinRuntime, makeCtx } from '../effects/fixtures.js';

/**
 * meet / shop 指令测试（17 号 S0，2026-09-21）。
 *
 * - `meet`：`npc.<id>.met` 的写入口（M1 遗留闭合）；语义=幂等 + 自动建档 +
 *   首次写入 emit `npc_met`；
 * - `shop`：jump 类（与 battle 同款）——只产 `{type:'shop'}` 跳转 + `shop_open`
 *   事件，不改状态（商店界面与交易归宿主 + ShopService，§5.3）。
 */

describe('17-S0 meet：NPC 相识标记写入口（M1 遗留闭合）', () => {
  it('首次 meet：met 置位 + emit npc_met', () => {
    const { rt } = makeBuiltinRuntime();
    const outcome = rt.exec([{ meet: { npc: 'npc_raven' } }], makeCtx());
    expect(rt.state.npcs['npc_raven']?.met).toBe(true);
    expect(outcome.events).toEqual([{ type: 'npc_met', npc: 'npc_raven' }]);
  });

  it('幂等：已 met 再 meet 无副作用、不重复 emit', () => {
    const { rt } = makeBuiltinRuntime();
    rt.exec([{ meet: { npc: 'npc_raven' } }], makeCtx());
    const second = rt.exec([{ meet: { npc: 'npc_raven' } }], makeCtx());
    expect(rt.state.npcs['npc_raven']?.met).toBe(true);
    expect(second.events).toEqual([]);
  });

  it('自动建档：未建档 NPC 先建 {favor:0, met:false, flags:{}} 再置 met', () => {
    const { rt } = makeBuiltinRuntime();
    rt.exec([{ meet: { npc: 'npc_newcomer' } }], makeCtx());
    expect(rt.state.npcs['npc_newcomer']).toEqual({ favor: 0, met: true, flags: {} });
  });

  it('与 favor 边界：favor 不改 met；meet 不改 favor', () => {
    const { rt } = makeBuiltinRuntime();
    rt.exec([{ favor: { npc: 'npc_raven', amount: 20 } }], makeCtx());
    expect(rt.state.npcs['npc_raven']?.met).toBe(false);
    rt.exec([{ meet: { npc: 'npc_raven' } }], makeCtx());
    expect(rt.state.npcs['npc_raven']?.favor).toBe(20);
  });

  it('写入后条件表达式真实翻转：npc.<id>.met 由假转真（M1 幽灵条件场景）', () => {
    // npc 域为封闭域：需 bootstrap 建档（与 12 号端口径一致）
    const { rt } = makeBuiltinRuntime({
      bootstrap: { versions: BASE_VERSIONS, attrs: { hp: 30 }, npcs: { npc_raven: { favor: 0 } } },
    });
    // M1 的「幽灵条件」：依赖 met 的分支此前因无写入口而永远为假
    const metExpr = fxCompile('npc.npc_raven.met');
    expect(rt.evalCondition(metExpr)).toBe(false);
    rt.exec([{ meet: { npc: 'npc_raven' } }], makeCtx());
    expect(rt.evalCondition(metExpr)).toBe(true);
  });

  it('回滚一致性：事务失败整体回滚，met 保持 false', () => {
    const { rt } = makeBuiltinRuntime();
    expect(() =>
      rt.exec(
        [
          { meet: { npc: 'npc_raven' } },
          // 故意失败：money 余额不足（后置指令失败 → 整批回滚）
          { money: { town_silver: -999 } },
        ],
        makeCtx(),
      ),
    ).toThrowError();
    // 整批回滚：连自动建档一并撤销（比「met 保持 false」更严格的不变式）
    expect(rt.state.npcs['npc_raven']).toBeUndefined();
  });
});

describe('17-S0 shop：商店开启（jump 类，宿主经 shop_open 事件消费）', () => {
  it('只产事件与跳转，不改状态（DD-05 同款边界）', () => {
    const { rt } = makeBuiltinRuntime();
    const before = JSON.stringify(rt.state.player.wallet);
    const outcome = rt.exec([{ shop: { shop: 'shop_market' } }], makeCtx());
    expect(outcome.events).toEqual([{ type: 'shop_open', shop: 'shop_market' }]);
    expect(outcome.jumps).toContainEqual({ type: 'shop', shop: 'shop_market' });
    expect(JSON.stringify(rt.state.player.wallet)).toBe(before);
  });

  it('touch 声明为空（不触碰任何状态域，迁移登记面零影响）', () => {
    const registry = createBuiltinEffectRegistry();
    const def = registry.lookup('shop');
    expect(def?.touch({ shop: 'shop_market' } as never)).toEqual({ reads: [], writes: [] });
  });

  it("schema 契约：shop 参数为 refId('shop')；缺 shop 字段拒绝", () => {
    expect(effectParamSchemas.shop.parse({ shop: 'shop_market' })).toEqual({
      shop: 'shop_market',
    });
    expect(() => effectParamSchemas.shop.parse({})).toThrowError();
  });
});
