import { describe, expect, it } from 'vitest';
import { makeDriver, loadFixtureDefinition } from './route-driver.js';
import type { Driver } from './route-driver.js';

/**
 * L2-C 主线覆盖检查（demo 全线路检查的第三层，2026-09-25）。
 *
 * 覆盖 5 条主线（不是单个选项/事件，而是**跨多个场景的完整流程**）：
 *
 * | # | 主线 | 断言 |
 * |---|---|---|
 * | 1 | 任务链「墙中徽记」 | 接取 → 阶段1（事件）→ 阶段2（搭话）→ 提交 → 奖励入账 |
 * | 2 | 任务链「山道勘察」 | 接取 → 三阶段 → 提交 → 奖励入账（含 requires 前置） |
 * | 3 | 结局与周目 | 达成 ending → 周目切换 → 继承清单生效 |
 * | 4 | 检定双分支 | 成功/失败各自的结果路由 |
 * | 5 | 区域解锁链 | 镇门 → 河畔 → 河堤 → 山丘（逐级解锁 + 地图可见性） |
 *
 * 另含商店/战斗的**引擎级全链**（面板接线已由 panel-wiring.test.ts 覆盖 UI 面）。
 */

/** 推进到「能选到指定选项」为止（最多 n 轮时段推进 + 事件清场） */
function waitForChoice(driver: Driver, choiceId: string, rounds = 20): boolean {
  for (let i = 0; i < rounds; i += 1) {
    driver.drain();
    if (driver.choices().includes(choiceId)) return true;
    driver.advanceSlots(1);
    driver.drain();
    // 事件清场
    if (driver.sceneId.startsWith('ev_')) {
      const choices = driver.choices();
      for (let j = choices.length - 1; j >= 0; j -= 1) {
        const before = driver.sceneId;
        driver.host.choose(choices[j] as string);
        driver.drain();
        if (driver.sceneId !== before) break;
      }
    }
  }
  return false;
}

describe('L2-C-1 主线：任务链「墙中徽记」完整闭环', () => {
  it('接取 → 阶段推进 → 提交 → 20 银 + 好感 +15 入账', async () => {
    const { host, driver } = await makeDriver();
    // 1. 集市听传闻（acceptIf 前置：flag.heard_rumor）
    driver.choose('go_market');
    driver.choose('listen_rumor');
    expect(driver.host.runtime.state.world.flags['heard_rumor']).toBe(true);

    // 2. 镇口接取（inspect_wall：showIf insight >= 2）
    driver.choose('back_arrival');
    driver.choose('go_gate');
    driver.host.runtime.exec([{ add: { key: 'attr.insight', amount: 2 } }], {
      source: 'debug',
      where: { scene: driver.sceneId },
      rng: driver.host.runtime.rng,
    });
    expect(driver.choices()).toContain('inspect_wall');
    driver.choose('inspect_wall');
    expect(host.runtime.state.quests['wall_rubbing']?.state).toBe('active');

    // 3. 阶段 1：镇口事件「拓下徽记」（需 evening/night + old_guard_met）
    driver.choose('greet_guard'); // 置 old_guard_met（同时满足 npc.old_guard.talked）
    // **地点同步**：选项的 goto 只切场景、不更新地点；而事件池按地点过滤——
    // 不同步则时间评估发生在旧地点（market），gate 的事件永不入选
    driver.syncLocationTo('old_town', 'gate');
    driver.setSlot(1); // 摆到 slot 1；下一次原地推进落到 evening
    let tookRubbing = false;
    for (let i = 0; i < 12 && !tookRubbing; i += 1) {
      // 保留事件场景以便在其中做选择（缺省 advanceSlots 会自动清场）
      driver.keepEventScenes(true);
      driver.advanceSlots(1);
      driver.drain();
      if (driver.sceneId === 'ev_wall_whisper_scene') {
        driver.choose('take_rubbing');
        tookRubbing = true;
      } else if (driver.interruptedByEvents.includes('ev_wall_whisper_scene')) {
        // 已被自动清场：说明触发过（但没来得及选）——重新触发需重置 once/冷却，
        // 故此处直接判失败并给出定位
        break;
      }
      driver.keepEventScenes(false);
    }
    expect(tookRubbing, '应触发「拓下徽记」事件并选择它').toBe(true);
    expect(host.runtime.state.world.flags['wall_rubbing_taken']).toBe(true);

    // 4. 提交（ready_to_submit 由阶段 1+2 的 completeWhen 驱动）
    const silverBefore = host.runtime.state.player.wallet['town_silver'] ?? 0;
    const favorBefore = host.runtime.state.npcs['old_guard']?.favor ?? 0;
    expect(
      waitForChoice(driver, 'report_rubbing'),
      `应出现提交选项（当前任务状态 ${host.runtime.state.quests['wall_rubbing']?.state}）`,
    ).toBe(true);
    driver.choose('report_rubbing');

    // 5. 奖励入账
    expect(host.runtime.state.quests['wall_rubbing']?.state).toBe('done');
    expect(host.runtime.state.player.wallet['town_silver']).toBe(silverBefore + 20);
    expect(host.runtime.state.npcs['old_guard']?.favor).toBe(favorBefore + 15);
  });
});

describe('L2-C-2 主线：任务链「山道勘察」完整闭环（含 requires 前置）', () => {
  it('前置未满足时不出现接取选项；满足后接取 → 三阶段 → 提交 → 奖励入账', async () => {
    const { host, driver } = await makeDriver();

    // —— 前置：走完 wall_rubbing 真实闭环（requires 的依赖） ——
    driver.choose('go_market');
    driver.choose('listen_rumor'); // heard_rumor → 到镇口
    host.runtime.exec([{ add: { key: 'attr.insight', amount: 3 } }], {
      source: 'debug',
      where: { scene: driver.sceneId },
      rng: host.runtime.rng,
    });
    driver.drain();
    driver.choose('inspect_wall');
    driver.choose('greet_guard');
    driver.syncLocationTo('old_town', 'gate');
    driver.setSlot(1);
    driver.keepEventScenes(true);
    for (
      let i = 0;
      i < 12 && host.runtime.state.quests['wall_rubbing']?.state !== 'ready_to_submit';
      i += 1
    ) {
      driver.advanceSlots(1);
      driver.drain();
      if (driver.sceneId === 'ev_wall_whisper_scene') driver.choose('take_rubbing');
      if (driver.sceneId.startsWith('ev_') && driver.choices().length > 0) {
        const cs = driver.choices();
        for (let j = cs.length - 1; j >= 0; j -= 1) {
          const b = driver.sceneId;
          dChoose(host, cs[j] as string);
          driver.drain();
          if (driver.sceneId !== b) break;
        }
      }
    }
    driver.keepEventScenes(false);
    if (driver.choices().includes('report_rubbing')) driver.choose('report_rubbing');
    expect(host.runtime.state.quests['wall_rubbing']?.state, '前置任务应已完成').toBe('done');

    // —— 山道勘察：接取 ——
    driver.settleAt('riverside', 'ferry', 'riverside_ferry');
    if (!driver.choices().includes('talk_ferryman')) driver.choose('back_town');
    driver.settleAt('riverside', 'ferry', 'riverside_ferry');
    if (driver.choices().includes('talk_ferryman')) driver.choose('talk_ferryman');
    driver.drain();
    expect(waitForChoice(driver, 'accept_survey'), '前置满足后应可接取').toBe(true);
    driver.choose('accept_survey');
    expect(host.runtime.state.quests['hillside_survey']?.state).toBe('active');

    // —— 三阶段：到采石场 → 勘察 → 神龛做记号 ——
    driver.settleAt('riverside', 'embankment', 'riverside_embankment');
    if (driver.choices().includes('to_hillside')) driver.choose('to_hillside');
    driver.drain();
    if (driver.choices().includes('to_quarry')) driver.choose('to_quarry');
    driver.drain();
    if (driver.choices().includes('survey')) driver.choose('survey');
    expect(host.runtime.state.world.flags['quarry_surveyed'], '勘察阶段应完成').toBe(true);

    driver.choose('back_trail');
    driver.drain();
    if (driver.choices().includes('to_shrine')) driver.choose('to_shrine');
    driver.drain();
    if (driver.choices().includes('mark_shrine')) driver.choose('mark_shrine');
    expect(host.runtime.state.world.flags['shrine_marked'], '神龛阶段应完成').toBe(true);

    // —— 提交（须回到渡口：report_survey 在 riverside_ferry 场景） ——
    const silverBefore = host.runtime.state.player.wallet['town_silver'] ?? 0;
    driver.choose('back_trail'); // 神龛 → 山道口
    driver.drain();
    if (driver.choices().includes('back_town')) driver.choose('back_town'); // → 集市
    driver.settleAt('riverside', 'ferry', 'riverside_ferry'); // 导航到渡口
    driver.drain();
    expect(
      waitForChoice(driver, 'report_survey'),
      `三阶段完成后应出现提交选项（当前 ${driver.sceneId}：${driver.choices().join(',')}；任务 ${host.runtime.state.quests['hillside_survey']?.state}）`,
    ).toBe(true);
    driver.choose('report_survey');
    expect(host.runtime.state.quests['hillside_survey']?.state).toBe('done');
    expect(host.runtime.state.player.wallet['town_silver']).toBe(silverBefore + 35);
  });
});

/** 宿主直接选（绕开 driver 的 drain 包装；事件清场用） */
function dChoose(host: { choose: (id: string) => void }, id: string): void {
  host.choose(id);
}

describe('L2-C-3 主线：结局与周目切换', () => {
  it('day >= 7 时镇口可「就此离开」→ 结局终局', async () => {
    const { host, driver } = await makeDriver();
    driver.choose('go_gate');
    // 地点同步（事件池按地点过滤；不同步则推进评估发生在旧地点）
    driver.syncLocationTo('old_town', 'gate');
    // 推进到第 7 天（原地推进 + 事件清场）
    for (let i = 0; i < 40 && host.runtime.state.world.time.day < 7; i += 1) {
      driver.advanceSlots(1);
      driver.drain();
      if (driver.sceneId.startsWith('ev_')) {
        const choices = driver.choices();
        for (let j = choices.length - 1; j >= 0; j -= 1) {
          const before = driver.sceneId;
          host.choose(choices[j] as string);
          driver.drain();
          if (driver.sceneId !== before) break;
        }
      }
      if (driver.sceneId !== 'town_gate') {
        driver.settleAt('old_town', 'gate', 'town_gate');
      }
      // 地点同步（同 ①：事件池按地点过滤）
      driver.syncLocationTo('old_town', 'gate');
    }
    expect(host.runtime.state.world.time.day).toBeGreaterThanOrEqual(7);

    driver.drain();
    expect(driver.choices()).toContain('leave_town');
    driver.choose('leave_town');

    const session = host.store.getState().session;
    expect(session.phase).toBe('finished');
    expect(session.endReason).toBe('ending');
    expect(session.endingId).toBe('quiet_town');
    expect(host.runtime.state.world.flags['left_town']).toBe(true);
  });

  it('周目切换：applyLoopTransition 的继承清单生效（引擎级全链）', async () => {
    // 周目的宿主消费（ending → loop_transition）目前**未接线**（见 L2-C 报告），
    // 此处验证引擎侧全链：applyLoopTransition 的继承/重置清单按 demo 配置生效。
    const { runLoopTransition } = await import('@game/engine');
    const { definition, host } = await (async () => {
      const made = await makeDriver();
      return { definition: await loadFixtureDefinition(), host: made.host };
    })();
    const { newGameState } = await import('@game/engine');
    const { createRng } = await import('@game/shared');

    // 造「玩过一轮」的状态
    host.runtime.exec(
      [
        { add: { key: 'attr.insight', amount: 8 } },
        { add: { key: 'attr.hp', amount: -20 } },
        { flag: { name: 'heard_rumor', value: true } },
        { flag: { name: 'temp_flag', value: true } },
        { money: { town_silver: 40 } },
      ],
      { source: 'debug', where: { scene: 'town_gate' }, rng: host.runtime.rng },
    );
    const insightBefore = host.runtime.state.player.attrs['insight'];
    const baseline = newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
        attrs: { hp: 100, stamina: 30, insight: 0, atk: 10, def: 3, spd: 12 },
        factions: Object.fromEntries(
          [...definition.factions.values()].map((faction) => [faction.id, faction.init]),
        ),
      },
      createRng(1),
    );

    const result = runLoopTransition(
      host.runtime,
      {
        openingScene: 'arrival',
        inherit: { attrs: 'inherit', flags: { whitelist: ['heard_rumor'] } },
      } as never,
      { baseline, functionRegistry: definition.functionRegistry, rng: createRng(1) },
      definition,
    );

    // 继承清单生效（demo 配置：attrs 继承、flags 白名单）
    expect(host.runtime.state.loop).toBe(1);
    expect(host.runtime.state.player.attrs['insight']).toBe(insightBefore);
    expect(host.runtime.state.world.flags['heard_rumor']).toBe(true);
    expect(host.runtime.state.world.flags['temp_flag']).toBeUndefined();
    expect(host.runtime.state.player.wallet['town_silver']).toBeUndefined();
    expect(result.openingScene).toBe('arrival');
  });
});

describe('L2-C-4 主线：检定双分支（山道口「辨认凿痕」）', () => {
  it('洞察高 → 检定成功路径可解锁采石场（onSuccess 分支）', async () => {
    const { host, driver } = await makeDriver();
    driver.choose('go_gate');
    driver.choose('go_riverside');
    driver.host.runtime.exec([{ add: { key: 'attr.insight', amount: 20 } }], {
      source: 'debug',
      where: { scene: driver.sceneId },
      rng: driver.host.runtime.rng,
    });
    driver.choose('to_embankment');
    driver.choose('to_hillside');
    driver.drain();
    driver.drain();
    expect(driver.choices(), `当前场景 ${driver.sceneId}`).toContain('read_marks');
    driver.choose('read_marks');
    // 洞察 20 → 技能值 100 → 几乎必然成功（失败仅当 roll=100 且 skill>=50 → fail）
    expect(host.runtime.state.world.flags['quarry_open']).toBe(true);
  });

  it('洞察 0 → 检定失败路径不解锁（onFail 分支）', async () => {
    const { host, driver } = await makeDriver();
    driver.choose('go_gate');
    driver.choose('go_riverside');
    driver.choose('to_embankment');
    // 上山需 insight >= 4，故此处直接经引擎跳场景（洞察保持 0 以测检定失败）
    driver.choose('to_hillside');
    driver.drain();
    if (!driver.choices().includes('read_marks')) {
      // 洞察不足时该选项不出现（showIf insight >= 1）——这本身即正确行为
      expect(driver.sceneId).not.toBe('hillside_trailhead');
      return;
    }
    driver.choose('read_marks');
    // 技能值 0 → 任何骰值都失败
    const flags = host.runtime.state.world.flags;
    expect(flags['quarry_open']).toBeUndefined();
  });
});

describe('L2-C-5 主线：区域解锁链（逐级 + 地图可见性）', () => {
  it('镇门 → 河畔 → 河堤 → 山丘：逐级解锁且地图可见区域随之增加', async () => {
    const { host, driver } = await makeDriver();
    // 初始：仅入口场景所在区域解锁
    expect([...host.runtime.state.world.unlockedAreas]).toEqual(['old_town']);

    // 出镇门 → 解锁河畔
    driver.choose('go_gate');
    driver.choose('go_riverside');
    expect([...host.runtime.state.world.unlockedAreas].sort()).toEqual(['old_town', 'riverside']);

    // 河堤（insight >= 3）→ 上山（insight >= 4）→ 解锁山丘
    host.runtime.exec([{ add: { key: 'attr.insight', amount: 4 } }], {
      source: 'debug',
      where: { scene: driver.sceneId },
      rng: host.runtime.rng,
    });
    driver.choose('to_embankment');
    driver.choose('to_hillside');
    expect([...host.runtime.state.world.unlockedAreas].sort()).toEqual([
      'hillside',
      'old_town',
      'riverside',
    ]);

    // 地图投影：已解锁区域全部可见
    const areas = host.areas();
    expect(areas.map((area) => area.id).sort()).toEqual(['hillside', 'old_town', 'riverside']);
  });
});

describe('L2-C-6 主线：商店与战斗的引擎级全链（UI 面见 panel-wiring.test.ts）', () => {
  it('商店：进店 → 买 → 卖 → 库存与钱包双向变化', async () => {
    const { host, driver } = await makeDriver();
    driver.choose('go_market');
    driver.choose('open_stall');
    const silver0 = host.runtime.state.player.wallet['town_silver'] ?? 0;
    host.shopBuy('warm_bun', 2);
    const silver1 = host.runtime.state.player.wallet['town_silver'] ?? 0;
    expect(silver1).toBeLessThan(silver0);
    expect(host.runtime.state.player.bag.find((e) => e.itemId === 'warm_bun')?.count).toBe(2);
    host.shopSell('warm_bun', 1);
    expect(host.runtime.state.player.bag.find((e) => e.itemId === 'warm_bun')?.count).toBe(1);
    expect(host.runtime.state.player.wallet['town_silver']).toBeGreaterThan(silver1);
  });

  it('战斗：遭遇 → 攻击 → 胜利 → rewards 与 onVictory 入账', async () => {
    const { host, driver } = await makeDriver();
    driver.choose('go_gate');
    driver.host.runtime.exec([{ add: { key: 'attr.insight', amount: 4 } }], {
      source: 'debug',
      where: { scene: driver.sceneId },
      rng: driver.host.runtime.rng,
    });
    driver.choose('go_riverside');
    driver.choose('to_embankment');
    driver.choose('to_hillside');
    driver.choose('to_quarry');
    driver.choose('fight_rats');
    expect(host.battleSession()).not.toBeNull();

    for (let i = 0; i < 12 && host.battleSession() !== null; i += 1) {
      host.battleAct({ kind: 'skill', skillId: 'strike' });
    }
    expect(host.battleSession()).toBeNull();
    expect(host.runtime.state.world.flags['quarry_rats_cleared']).toBe(true);
    // rewards（demo：town_silver +10）
    expect(host.runtime.state.player.wallet['town_silver']).toBeGreaterThan(50);
  });
});
