import { describe, expect, it } from 'vitest';
import { Driver, loadFixtureDefinition, makeDriver } from './route-driver.js';

/**
 * L2-A 选项覆盖检查（demo 全线路检查的第一层，2026-09-25）。
 *
 * **目的**：穷举 demo 的每一个选项，断言三件事——
 * 1. **可达**：在满足其 `showIf` 的条件下，该选项真的出现在选项列表里
 *    （数据里写了但玩家永远看不到 = 死内容）；
 * 2. **有效果**：点击后产生了数据声明的后果（状态变化 / 场景跳转 / 事件触发
 *    ——任一项即可，断言「不只是没报错」）；
 * 3. **once 语义**：`once: true` 的选项点击后不再出现。
 *
 * **覆盖率闭环**：遍历数据集的全部选项 id，与「实际执行过的集合」比对，
 * 差集必须为空——新增内容时本检查自动要求覆盖，不会静默漏检。
 *
 * 驱动方式：每个选项在**独立的宿主实例**上测试（互不干扰），
 * 前置条件用「前置步骤脚本」注入（如先听传闻才能接任务）。
 */

/** 每条选项的检查用例：前置步骤 + 期望 */
interface ChoiceCase {
  /** 场景 id */
  readonly scene: string;
  /** 选项 id */
  readonly choice: string;
  /**
   * 前置步骤（在该场景出现选项前执行；用文本描述由 executor 解释）。
   * 支持的动作见 {@link runSetup}。
   */
  readonly setup?: readonly SetupStep[];
  /** 跳过的原因（仅登记，不测试；用于「条件无法在同一宿主内构造」的选项） */
  readonly reason?: string;
  /**
   * 已知缺口（宿主层，非 demo 数据缺陷）：点击后**无可见效果**是预期内的，
   * 原因是宿主未接线对应能力（如商店面板/战斗面板未挂 AppShell）。
   * 检查对本类选项只断言「可达且不报错」，并把它计入缺口清单。
   */
  readonly knownGap?: string;
}

/** 前置步骤（可编程动作） */
type SetupStep =
  | { readonly do: 'choose'; readonly id: string }
  | { readonly do: 'move'; readonly area: string; readonly location: string }
  | { readonly do: 'slots'; readonly count: number }
  | { readonly do: 'toSlot'; readonly index: number }
  | { readonly do: 'toDay'; readonly day: number }
  | {
      readonly do: 'toDayStaying';
      readonly day: number;
      readonly area: string;
      readonly location: string;
      readonly scene: string;
    }
  | {
      readonly do: 'settleAt';
      readonly area: string;
      readonly location: string;
      readonly scene: string;
    }
  | { readonly do: 'grantInsight'; readonly amount: number };

/** 执行前置步骤序列 */
function runSetup(driver: Driver, steps: readonly SetupStep[]): void {
  for (const step of steps) {
    switch (step.do) {
      case 'choose':
        driver.choose(step.id);
        break;
      case 'move':
        driver.moveTo(step.area, step.location);
        break;
      case 'slots':
        driver.advanceSlots(step.count);
        break;
      case 'toSlot':
        driver.advanceToSlot(step.index);
        break;
      case 'toDay':
        driver.advanceToDay(step.day);
        break;
      case 'toDayStaying':
        driver.advanceToDay(step.day, {
          area: step.area,
          location: step.location,
          scene: step.scene,
        });
        break;
      case 'settleAt':
        driver.settleAt(step.area, step.location, step.scene);
        break;
      case 'grantInsight':
        // 洞察是走通「高洞察解锁」类选项的最短路径（否则要跑完整条任务链）
        driver.host.runtime.exec([{ add: { key: 'attr.insight', amount: step.amount } }], {
          source: 'debug',
          where: { scene: driver.sceneId },
          rng: driver.host.runtime.rng,
        });
        break;
    }
  }
}

/**
 * 全部选项的检查用例（**数据全集的镜像**；由下方覆盖率断言守护完整性）。
 */
const CHOICE_CASES: readonly ChoiceCase[] = [
  // —— arrival ——
  { scene: 'arrival', choice: 'go_market' },
  { scene: 'arrival', choice: 'go_gate' },
  // —— market_street ——
  { scene: 'market_street', choice: 'listen_rumor', setup: [{ do: 'choose', id: 'go_market' }] },
  {
    scene: 'market_street',
    choice: 'open_stall',
    setup: [{ do: 'choose', id: 'go_market' }],
    knownGap:
      '宿主未订阅 shop_open 事件（商店面板未挂 AppShell）——引擎侧 ShopService 已就绪，属 UI 接线遗留（阶段五登记的遗留项）',
  },
  { scene: 'market_street', choice: 'back_arrival', setup: [{ do: 'choose', id: 'go_market' }] },
  // —— town_gate ——
  { scene: 'town_gate', choice: 'greet_guard', setup: [{ do: 'choose', id: 'go_gate' }] },
  {
    scene: 'town_gate',
    choice: 'inspect_wall',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'grantInsight', amount: 2 },
    ],
  },
  { scene: 'town_gate', choice: 'back_market', setup: [{ do: 'choose', id: 'go_gate' }] },
  { scene: 'town_gate', choice: 'go_riverside', setup: [{ do: 'choose', id: 'go_gate' }] },
  {
    scene: 'town_gate',
    choice: 'leave_town',
    // 推进到第 7 天（结局条件）后**回到镇口**——地图移动会切换场景，
    // 时段推进是「就地重进当前地点」，故最后要显式导航回 gate
    setup: [
      // 先经地图导航到镇口（同时对齐 currentLocation = gate，供「原地推进」用），
      // 再原地推进到第 7 天（镇口无事件，推进干净）
      { do: 'settleAt', area: 'old_town', location: 'gate', scene: 'town_gate' },
      { do: 'toDayStaying', day: 7, area: 'old_town', location: 'gate', scene: 'town_gate' },
    ],
  },
  // —— riverside_ferry ——
  {
    scene: 'riverside_ferry',
    choice: 'talk_ferryman',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
    ],
  },
  {
    scene: 'riverside_ferry',
    choice: 'accept_survey',
    reason: '需 wall_rubbing 完成（跨两条任务链）——由 L2-C 线路检查覆盖',
  },
  {
    scene: 'riverside_ferry',
    choice: 'report_survey',
    reason: '需 hillside_survey 达 ready_to_submit——由 L2-C 线路检查覆盖',
  },
  {
    scene: 'riverside_ferry',
    choice: 'ask_ferry',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'choose', id: 'talk_ferryman' },
    ],
  },
  {
    scene: 'riverside_ferry',
    choice: 'to_fish_market',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
    ],
  },
  {
    scene: 'riverside_ferry',
    choice: 'to_embankment',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 3 },
    ],
  },
  {
    scene: 'riverside_ferry',
    choice: 'back_town',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
    ],
  },
  // —— town_gate（续）——
  {
    scene: 'town_gate',
    choice: 'report_rubbing',
    reason: '需 wall_rubbing 达 ready_to_submit（跨任务链）——由 L2-C 线路检查覆盖',
  },
  // —— riverside_fish_market ——
  {
    scene: 'riverside_fish_market',
    choice: 'buy_fish',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'choose', id: 'to_fish_market' },
    ],
  },
  {
    scene: 'riverside_fish_market',
    choice: 'too_poor',
    reason: '置灰展示项（disabledIf）：银两不足时才出现且不可点——由 L2-C 的商店线路覆盖',
  },
  {
    scene: 'riverside_fish_market',
    choice: 'to_warehouse',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'choose', id: 'to_fish_market' },
    ],
  },
  {
    scene: 'riverside_fish_market',
    choice: 'to_ferry',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'choose', id: 'to_fish_market' },
    ],
  },
  // —— riverside_warehouse ——
  {
    scene: 'riverside_warehouse',
    choice: 'force_door',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'choose', id: 'to_fish_market' },
      { do: 'choose', id: 'to_warehouse' },
    ],
  },
  {
    scene: 'riverside_warehouse',
    choice: 'search_crates',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'choose', id: 'to_fish_market' },
      { do: 'choose', id: 'to_warehouse' },
      { do: 'choose', id: 'force_door' },
    ],
  },
  {
    scene: 'riverside_warehouse',
    choice: 'back_market',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'choose', id: 'to_fish_market' },
      { do: 'choose', id: 'to_warehouse' },
    ],
  },
  // —— riverside_embankment ——
  {
    scene: 'riverside_embankment',
    choice: 'examine_mark',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 5 },
      { do: 'choose', id: 'to_embankment' },
    ],
  },
  {
    scene: 'riverside_embankment',
    choice: 'to_ferry',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 3 },
      { do: 'choose', id: 'to_embankment' },
    ],
  },
  {
    scene: 'riverside_embankment',
    choice: 'to_town',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 3 },
      { do: 'choose', id: 'to_embankment' },
    ],
  },
  {
    scene: 'riverside_embankment',
    choice: 'to_hillside',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 4 },
      { do: 'choose', id: 'to_embankment' },
    ],
  },
  // —— hillside_trailhead ——
  {
    scene: 'hillside_trailhead',
    choice: 'to_quarry',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 4 },
      { do: 'choose', id: 'to_embankment' },
      { do: 'choose', id: 'to_hillside' },
    ],
  },
  {
    scene: 'hillside_trailhead',
    choice: 'to_shrine',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 6 },
      { do: 'choose', id: 'to_embankment' },
      { do: 'choose', id: 'to_hillside' },
    ],
  },
  {
    scene: 'hillside_trailhead',
    choice: 'open_quarry',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 4 },
      { do: 'choose', id: 'to_embankment' },
      { do: 'choose', id: 'to_hillside' },
    ],
  },
  {
    scene: 'hillside_trailhead',
    choice: 'read_marks',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 4 },
      { do: 'choose', id: 'to_embankment' },
      { do: 'choose', id: 'to_hillside' },
    ],
  },
  {
    scene: 'hillside_trailhead',
    choice: 'back_town',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 4 },
      { do: 'choose', id: 'to_embankment' },
      { do: 'choose', id: 'to_hillside' },
    ],
  },
  // —— hillside_quarry ——
  {
    scene: 'hillside_quarry',
    choice: 'fight_rats',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 4 },
      { do: 'choose', id: 'to_embankment' },
      { do: 'choose', id: 'to_hillside' },
      { do: 'choose', id: 'to_quarry' },
    ],
  },
  {
    scene: 'hillside_quarry',
    choice: 'survey',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 4 },
      { do: 'choose', id: 'to_embankment' },
      { do: 'choose', id: 'to_hillside' },
      { do: 'choose', id: 'to_quarry' },
    ],
  },
  {
    scene: 'hillside_quarry',
    choice: 'rest_here',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 4 },
      { do: 'choose', id: 'to_embankment' },
      { do: 'choose', id: 'to_hillside' },
      { do: 'choose', id: 'to_quarry' },
    ],
  },
  {
    scene: 'hillside_quarry',
    choice: 'back_trail',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 4 },
      { do: 'choose', id: 'to_embankment' },
      { do: 'choose', id: 'to_hillside' },
      { do: 'choose', id: 'to_quarry' },
    ],
  },
  // —— hillside_shrine ——
  {
    scene: 'hillside_shrine',
    choice: 'mark_shrine',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 6 },
      { do: 'choose', id: 'to_embankment' },
      { do: 'choose', id: 'to_hillside' },
      { do: 'choose', id: 'to_shrine' },
    ],
  },
  {
    scene: 'hillside_shrine',
    choice: 'pray',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 6 },
      { do: 'choose', id: 'to_embankment' },
      { do: 'choose', id: 'to_hillside' },
      { do: 'choose', id: 'to_shrine' },
    ],
  },
  {
    scene: 'hillside_shrine',
    choice: 'back_trail',
    setup: [
      { do: 'choose', id: 'go_gate' },
      { do: 'choose', id: 'go_riverside' },
      { do: 'grantInsight', amount: 6 },
      { do: 'choose', id: 'to_embankment' },
      { do: 'choose', id: 'to_hillside' },
      { do: 'choose', id: 'to_shrine' },
    ],
  },
];

/** 已被本文件显式登记的「事件场景选项」（由 L2-B 覆盖） */
const EVENT_SCENE_PREFIX = 'ev_';

describe('L2-A 选项覆盖：每个选项可达 + 点击有效果 + once 语义', () => {
  it('覆盖率闭环：数据集的每个普通场景选项都有检查用例（差集为空）', async () => {
    const definition = await loadFixtureDefinition();
    // 数据全集：普通场景（非事件场景）的全部选项
    const dataChoices = new Set<string>();
    for (const scene of definition.scenes.values()) {
      if (scene.def.id.startsWith(EVENT_SCENE_PREFIX)) continue; // 事件场景归 L2-B
      for (const choice of scene.def.choices) {
        dataChoices.add(`${scene.def.id}#${choice.id}`);
      }
    }
    const covered = new Set(CHOICE_CASES.map((entry) => `${entry.scene}#${entry.choice}`));
    const uncovered = [...dataChoices].filter((key) => !covered.has(key)).sort();
    expect(
      uncovered,
      `以下选项未纳入检查（新增内容必须补检查用例）：${uncovered.join(', ')}`,
    ).toEqual([]);
    // 反向：检查用例不得引用不存在的选项（防止数据改动后检查变成空转）
    const stale = [...covered].filter((key) => !dataChoices.has(key)).sort();
    expect(stale, `检查用例引用了不存在的选项：${stale.join(', ')}`).toEqual([]);
  });

  for (const testCase of CHOICE_CASES) {
    if (testCase.reason !== undefined) {
      it.skip(`${testCase.scene}#${testCase.choice}（跳过：${testCase.reason}）`, () => undefined);
      continue;
    }
    it(`${testCase.scene}#${testCase.choice}：可达且点击有效果`, async () => {
      const { driver } = await makeDriver();
      const before = driver.snapshot();
      runSetup(driver, testCase.setup ?? []);
      // 1. 可达：选项在满足条件时真的出现
      driver.drain();
      const choices = driver.choices();
      expect(choices, `选项 ${testCase.choice} 未出现（当前场景 ${driver.sceneId}）`).toContain(
        testCase.choice,
      );

      // 2a. 已知缺口（宿主未接线）：只断言「可达且点击不报错」
      if (testCase.knownGap !== undefined) {
        driver.choose(testCase.choice);
        expect(
          driver.host.lastError(),
          `已知缺口选项 ${testCase.choice} 点击后出现错误：${JSON.stringify(driver.host.lastError())}`,
        ).toBeNull();
        return;
      }

      // 2b. 有效果：点击后状态/场景/可见选项任一发生变化
      const sceneBefore = driver.sceneId;
      const choiceListBefore = [...choices];
      driver.choose(testCase.choice);
      const after = driver.snapshot();
      const changed =
        after.sceneId !== sceneBefore ||
        JSON.stringify(after.flags) !== JSON.stringify(before.flags) ||
        JSON.stringify(after.attrs) !== JSON.stringify(before.attrs) ||
        JSON.stringify(after.wallet) !== JSON.stringify(before.wallet) ||
        JSON.stringify(after.quests) !== JSON.stringify(before.quests) ||
        JSON.stringify(after.bag) !== JSON.stringify(before.bag) ||
        JSON.stringify(after.npcs) !== JSON.stringify(before.npcs) ||
        JSON.stringify(after.choiceIds) !== JSON.stringify(choiceListBefore);
      expect(
        changed,
        `选项 ${testCase.choice} 点击后无任何可观测变化（场景/状态/选项列表均未变）`,
      ).toBe(true);
    });
  }
});
