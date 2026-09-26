import { describe, expect, it } from 'vitest';
import { makeDriver } from './route-driver.js';

/**
 * 面板接线检查（2026-09-25）：验证「宿主消费 shop_open / battle_start 事件」。
 *
 * 背景：L2-A 选项覆盖检查抓出 `market_street#open_stall`（商店）点击后**无任何
 * 变化**——根因是引擎已 emit 事件、宿主未订阅（UI 接线缺口）。本次接线后，
 * 本检查断言：点击商店选项 → 商店会话建立 + 面板打开；战斗同理。
 */

describe('面板接线：商店（shop_open 消费）', () => {
  it('点「逛杂货铺」→ 商店会话建立，含商品与价格', async () => {
    const { host, driver } = await makeDriver();
    driver.choose('go_market');
    expect(driver.choices()).toContain('open_stall');
    driver.choose('open_stall');

    const session = host.shopSession();
    expect(session, '商店会话应已建立（宿主订阅 shop_open）').not.toBeNull();
    expect(session?.shopId).toBe('shop_market_stall');
    expect(session?.entries.length).toBeGreaterThan(0);
    // 商品：warm_bun（价格由表达式算出）
    const bun = session?.entries.find((entry) => entry.itemId === 'warm_bun');
    expect(bun).toBeDefined();
    expect(bun?.priceBuy).toBeGreaterThan(0);
    // 面板已打开
    expect(host.store.getState().panels.open).toBe('shop');
  });

  it('买入：扣钱 + 给物 + 库存扣减（真实交易事务）', async () => {
    const { host, driver } = await makeDriver();
    driver.choose('go_market');
    driver.choose('open_stall');
    const before = host.runtime.state;
    const silverBefore = before.player.wallet['town_silver'] ?? 0;
    const stockBefore = before.world.shopStock['shop_market_stall/warm_bun'];

    const result = host.shopBuy('warm_bun', 1);
    expect(result.ok, result.detail).toBe(true);

    const after = host.runtime.state;
    const bun = after.player.bag.find((entry) => entry.itemId === 'warm_bun');
    expect(bun?.count).toBe(1);
    expect(after.player.wallet['town_silver']).toBeLessThan(silverBefore);
    expect(after.world.shopStock['shop_market_stall/warm_bun']).toBe((stockBefore ?? 5) - 1);
  });

  it('卖出：给钱 + 扣物（回购价与卖价一致）', async () => {
    const { host, driver } = await makeDriver();
    driver.choose('go_market');
    driver.choose('open_stall');
    host.shopBuy('warm_bun', 1);
    const silverAfterBuy = host.runtime.state.player.wallet['town_silver'] ?? 0;

    const result = host.shopSell('warm_bun', 1);
    expect(result.ok, result.detail).toBe(true);
    expect(host.runtime.state.player.bag.find((e) => e.itemId === 'warm_bun')).toBeUndefined();
    expect(host.runtime.state.player.wallet['town_silver']).toBeGreaterThan(silverAfterBuy);
  });

  it('钱不够：买入被拒且状态不变（原子性）', async () => {
    const { host, driver } = await makeDriver();
    driver.choose('go_market');
    driver.choose('open_stall');
    // 清空钱包
    host.runtime.exec(
      [{ money: { town_silver: -(host.runtime.state.player.wallet['town_silver'] ?? 0) } }],
      {
        source: 'debug',
        where: { scene: driver.sceneId },
        rng: host.runtime.rng,
      },
    );
    const result = host.shopBuy('warm_bun', 1);
    expect(result.ok).toBe(false);
    expect(host.runtime.state.player.bag.find((e) => e.itemId === 'warm_bun')).toBeUndefined();
  });

  it('关闭商店：会话清空 + 面板关闭', async () => {
    const { host, driver } = await makeDriver();
    driver.choose('go_market');
    driver.choose('open_stall');
    expect(host.shopSession()).not.toBeNull();
    host.closeShop();
    expect(host.shopSession()).toBeNull();
    expect(host.store.getState().panels.open).toBeNull();
  });
});

describe('面板接线：战斗（battle_start 消费）', () => {
  async function enterBattle() {
    const { host, driver } = await makeDriver();
    // 走到采石场（经洞察门槛）
    driver.choose('go_gate');
    driver.host.runtime.exec([{ add: { key: 'attr.insight', amount: 4 } }], {
      source: 'debug',
      where: { scene: driver.sceneId },
      rng: driver.host.runtime.rng,
    });
    driver.choose('go_riverside');
    driver.moveTo('riverside', 'embankment');
    driver.settleAt('riverside', 'embankment', 'riverside_embankment');
    driver.choose('to_hillside');
    driver.choose('to_quarry');
    return { host, driver };
  }

  it('点「打岩鼠」→ 战斗会话建立（两只岩鼠），面板打开', async () => {
    const { host, driver } = await enterBattle();
    expect(driver.choices()).toContain('fight_rats');
    driver.choose('fight_rats');

    const session = host.battleSession();
    expect(session, '战斗会话应已建立（宿主订阅 battle_start）').not.toBeNull();
    const enemies = session?.units.filter((unit) => unit.side === 'enemy') ?? [];
    expect(enemies).toHaveLength(2); // FR-CMBT-12 多敌人
    expect(host.store.getState().panels.open).toBe('battle');
  });

  it('玩家攻击 → 敌人掉血（会话真实推进）', async () => {
    const { host, driver } = await enterBattle();
    driver.choose('fight_rats');
    const before = host.battleSession();
    const hpBefore = before?.units.find((unit) => unit.side === 'enemy')?.hp ?? 0;
    expect(hpBefore).toBeGreaterThan(0);

    host.battleAct({ kind: 'skill', skillId: 'strike' });
    const after = host.battleSession();
    // 战斗可能已结束（面板清空）或敌人已掉血——两者都说明行动生效
    const hpAfter = after?.units.find((unit) => unit.side === 'enemy')?.hp;
    expect(after === null || hpAfter === undefined || hpAfter < hpBefore).toBe(true);
  });

  it('防御行动：置位 defending（会话语义）', async () => {
    const { host, driver } = await enterBattle();
    driver.choose('fight_rats');
    host.battleAct({ kind: 'defend' });
    const session = host.battleSession();
    // 防御后可能轮到敌方（会话推进），玩家单位的 defending 标记在下一轮清除
    expect(
      session === null ||
        session.phase !== 'await_player' ||
        session.units.some((u) => u.defending),
    ).toBe(true);
  });

  it('战斗终局：胜利后路由效果入账（flag + 面板关闭）', async () => {
    const { host, driver } = await enterBattle();
    driver.choose('fight_rats');
    // 反复攻击直到终局（最多 10 次；岩鼠 6 血、玩家 3 倍伤害）
    for (let i = 0; i < 10 && host.battleSession() !== null; i += 1) {
      host.battleAct({ kind: 'skill', skillId: 'strike' });
    }
    expect(host.battleSession()).toBeNull(); // 终局后清空
    expect(host.store.getState().panels.open).toBeNull();
    // onVictory 分支的 flag（数据声明：quarry_rats_cleared）
    expect(host.runtime.state.world.flags['quarry_rats_cleared']).toBe(true);
  });
});
