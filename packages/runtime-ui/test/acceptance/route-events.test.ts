import { describe, expect, it } from 'vitest';
import { Driver, loadFixtureDefinition, makeDriver } from './route-driver.js';
import type { GameHost } from '../../src/app/game-host.js';

/**
 * L2-B 事件覆盖检查（demo 全线路检查的第二层，2026-09-25）。
 *
 * **目的**：10 条事件逐一验证「能真实触发」+「事件内选项有效果」。
 *
 * 三类事件的驱动方式不同（引擎设计所定）：
 * - `condition` 型：时间管线推进时按 require 评估即发（`applyFlowJumps` 回流）；
 * - `random` 型：按权重抽取（需多次尝试；固定种子保证可复现）；
 * - `explore` 型：不参与自动 select，由宿主**进入地点**时主动询问
 *   （`exploreCandidates`；宿主接线 2026-09-25 补齐）。
 *
 * **覆盖率闭环**：断言「数据里的每条事件 id」都被本文件覆盖（差集为空）。
 */

/** 单条事件的检查用例：前置 → 驱动 → 断言 */
interface EventCase {
  readonly id: string;
  /** 场景 id（事件场景） */
  readonly scene: string;
  /** 前置步骤（构造触发条件） */
  readonly setup: readonly SetupStep[];
  /** 驱动方式：条件型（推进时间）/随机型（多次尝试）/探索型（移动进入） */
  readonly drive: 'time' | 'retry' | 'explore';
  /** 驱动时的位置（判定作用域） */
  readonly at: { readonly area: string; readonly location?: string };
  /** 事件内至少有一个可选项（冒烟：进入后能继续） */
  readonly expectChoices?: boolean;
}

type SetupStep =
  | { readonly do: 'choose'; readonly id: string }
  | { readonly do: 'flag'; readonly name: string; readonly value: boolean }
  | { readonly do: 'insight'; readonly amount: number }
  | { readonly do: 'move'; readonly area: string; readonly location: string }
  | { readonly do: 'slots'; readonly count: number }
  | { readonly do: 'toSlot'; readonly index: number }
  /** 直接设时段（构造时间前置；不消耗时段、不触发评估——窄窗口事件用） */
  | { readonly do: 'setSlot'; readonly index: number };

function runSetup(driver: Driver, steps: readonly SetupStep[]): void {
  for (const step of steps) {
    switch (step.do) {
      case 'choose':
        driver.choose(step.id);
        break;
      case 'flag':
        driver.host.runtime.exec([{ flag: { name: step.name, value: step.value } }], {
          source: 'debug',
          where: { scene: driver.sceneId },
          rng: driver.host.runtime.rng,
        });
        break;
      case 'insight':
        driver.host.runtime.exec([{ add: { key: 'attr.insight', amount: step.amount } }], {
          source: 'debug',
          where: { scene: driver.sceneId },
          rng: driver.host.runtime.rng,
        });
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
      case 'setSlot':
        driver.setSlot(step.index);
        break;
    }
  }
}

/**
 * 驱动事件触发（返回是否进入了目标事件场景）。
 *
 * - `time`：推进若干时段（条件型在 require 满足时即发）；
 * - `retry`：多次推进 + 移动（随机型按权重抽取，固定种子下可复现）；
 * - `explore`：移动进入目标地点（宿主主动询问探索候选）。
 */
function driveEvent(host: GameHost, driver: Driver, testCase: EventCase): boolean {
  /**
   * 触发判定口径：**看 driver 的事件打断记录**，而非只看当前场景。
   *
   * 为什么：`advanceSlots` 会清场（选出口离开事件）以保证推进循环收敛——
   * 清场后 `sceneId` 已回到普通场景，但事件**确实触发过**（记录在
   * `interruptedByEvents`）。用当前场景判定会把「触发过」误判为「没触发」。
   */
  const arrived = (): boolean =>
    driver.interruptedByEvents.includes(testCase.scene) || driver.sceneId === testCase.scene;
  switch (testCase.drive) {
    case 'time': {
      for (let i = 0; i < 12; i += 1) {
        driver.advanceSlots(1);
        if (arrived()) return true;
        driver.drain();
      }
      return false;
    }
    case 'retry': {
      // 随机型：反复「推进 + 移动」，固定种子下命中概率高（上限 40 次防死循环）
      for (let i = 0; i < 40; i += 1) {
        driver.advanceSlots(1);
        if (arrived()) return true;
        if (testCase.at.location !== undefined) {
          driver.moveTo(testCase.at.area, testCase.at.location);
        }
        if (arrived()) return true;
        if (driver.sceneId.startsWith('ev_')) {
          // 触发了别的事件：清场继续（目标事件仍在候选池里）
          driver.drain();
          const choices = driver.choices();
          for (let j = choices.length - 1; j >= 0; j -= 1) {
            const before = driver.sceneId;
            host.choose(choices[j] as string);
            driver.drain();
            if (driver.sceneId !== before) break;
          }
        }
      }
      return false;
    }
    case 'explore': {
      // 探索型：移动到目标地点即询问候选
      for (let i = 0; i < 6; i += 1) {
        driver.moveTo(testCase.at.area, testCase.at.location ?? 'trailhead');
        if (arrived()) return true;
        if (driver.sceneId.startsWith('ev_') && driver.sceneId !== testCase.scene) {
          driver.drain();
          const choices = driver.choices();
          for (let j = choices.length - 1; j >= 0; j -= 1) {
            const before = driver.sceneId;
            host.choose(choices[j] as string);
            driver.drain();
            if (driver.sceneId !== before) break;
          }
        }
      }
      return false;
    }
  }
}

const EVENT_CASES: readonly EventCase[] = [
  {
    id: 'ev_wall_whisper',
    scene: 'ev_wall_whisper_scene',
    drive: 'time',
    at: { area: 'old_town', location: 'gate' },
    setup: [
      { do: 'flag', name: 'old_guard_met', value: true },
      { do: 'move', area: 'old_town', location: 'gate' },
      { do: 'toSlot', index: 2 }, // evening
    ],
  },
  {
    id: 'ev_market_rumor',
    scene: 'ev_market_rumor_scene',
    drive: 'retry',
    at: { area: 'old_town', location: 'market' },
    setup: [{ do: 'move', area: 'old_town', location: 'market' }],
  },
  {
    id: 'ev_ferry_greeting',
    scene: 'ev_ferry_greeting_scene',
    drive: 'time',
    at: { area: 'riverside', location: 'ferry' },
    setup: [
      { do: 'flag', name: 'ferryman_met', value: true },
      { do: 'move', area: 'riverside', location: 'ferry' },
    ],
  },
  {
    id: 'ev_fish_market_bargain',
    scene: 'ev_fish_market_bargain_scene',
    drive: 'retry',
    at: { area: 'riverside', location: 'fish_market' },
    setup: [{ do: 'move', area: 'riverside', location: 'fish_market' }],
  },
  {
    id: 'ev_embankment_find',
    scene: 'ev_embankment_find_scene',
    drive: 'explore',
    at: { area: 'riverside', location: 'embankment' },
    setup: [
      { do: 'insight', amount: 3 },
      { do: 'flag', name: 'unlocked_riverside', value: true },
    ],
  },
  {
    id: 'ev_quarry_echo',
    scene: 'ev_quarry_echo_scene',
    drive: 'explore',
    at: { area: 'hillside', location: 'quarry' },
    setup: [
      { do: 'insight', amount: 4 },
      { do: 'flag', name: 'quarry_open', value: true },
    ],
  },
  {
    /**
     * 窄窗口 + 高 moveCost 的触发模式（2026-09-25 踩坑记录）：
     * shrine 的 `moveCost = 2`，而事件窗口是 `night`（slotIndex 3）——
     * **一次 moveTo 就是一次 2 时段的时间推进**，故「先把时钟摆到 slot 1、
     * 再 moveTo 到 shrine」这一步移动正好落在 slot 3（night）并触发事件。
     * 不靠逐时段推进：步长 2 只在同奇偶时段间跳，可能永远碰不到 night。
     */
    id: 'ev_shrine_dream',
    scene: 'ev_shrine_dream_scene',
    drive: 'time',
    at: { area: 'hillside', location: 'shrine' },
    setup: [
      { do: 'flag', name: 'shrine_marked', value: true },
      { do: 'insight', amount: 6 },
      // 先驻留到神龛（moveCost 2 会消耗时段，故 move 在前），
      // 再把时钟摆到 slot 1——此后每次推进（2 时段）在 1⇄3 之间跳，
      // 必然命中 night（3）
      { do: 'move', area: 'hillside', location: 'shrine' },
      { do: 'setSlot', index: 1 },
    ],
  },
  {
    id: 'ev_trail_wanderer',
    scene: 'ev_trail_wanderer_scene',
    drive: 'retry',
    at: { area: 'hillside' },
    setup: [
      { do: 'flag', name: 'ferryman_met', value: true },
      { do: 'insight', amount: 4 },
      { do: 'move', area: 'hillside', location: 'trailhead' },
      { do: 'toSlot', index: 2 }, // evening
    ],
  },
  {
    id: 'ev_market_gossip',
    scene: 'ev_market_gossip_scene',
    drive: 'retry',
    at: { area: 'old_town', location: 'market' },
    setup: [{ do: 'move', area: 'old_town', location: 'market' }],
  },
  {
    id: 'ev_night_lantern',
    scene: 'ev_night_lantern_scene',
    drive: 'retry',
    at: { area: 'old_town', location: 'market' },
    setup: [
      { do: 'move', area: 'old_town', location: 'market' },
      { do: 'toSlot', index: 3 }, // night
    ],
  },
];

describe('L2-B 事件覆盖：每条事件可触发 + 事件内可继续', () => {
  it('覆盖率闭环：数据里每条事件都有检查用例（差集为空）', async () => {
    const definition = await loadFixtureDefinition();
    const dataEvents = definition.events.map((event) => event.id).sort();
    const covered = EVENT_CASES.map((entry) => entry.id).sort();
    const uncovered = dataEvents.filter((id) => !covered.includes(id));
    expect(uncovered, `以下事件未纳入检查：${uncovered.join(', ')}`).toEqual([]);
    const stale = covered.filter((id) => !dataEvents.includes(id));
    expect(stale, `检查用例引用了不存在的事件：${stale.join(', ')}`).toEqual([]);
  });

  for (const testCase of EVENT_CASES) {
    it(`${testCase.id}：可触发（${testCase.drive}）且事件内有选项`, async () => {
      const { host, driver } = await makeDriver();
      // 进入事件所在区域的起始场景
      if (testCase.at.area === 'old_town') {
        driver.choose('go_gate');
      } else if (testCase.at.area === 'riverside') {
        driver.choose('go_gate');
        driver.choose('go_riverside');
      } else {
        // hillside：经河堤上山（需洞察门槛）
        driver.choose('go_gate');
        driver.choose('go_riverside');
        driver.host.runtime.exec([{ add: { key: 'attr.insight', amount: 5 } }], {
          source: 'debug',
          where: { scene: driver.sceneId },
          rng: driver.host.runtime.rng,
        });
        driver.moveTo('riverside', 'embankment');
        driver.settleAt('riverside', 'embankment', 'riverside_embankment');
        driver.choose('to_hillside');
      }
      runSetup(driver, testCase.setup);

      const triggered = driveEvent(host, driver, testCase);
      if (process.env.DIAG_EVENTS === '1') {
        console.log(
          `[${testCase.id}] triggered=${triggered} scene=${driver.sceneId} slot=${host.runtime.state.world.time.slotIndex} loc=${JSON.stringify(host.location())} events=${JSON.stringify(driver.interruptedByEvents)}`,
        );
      }
      expect(
        triggered,
        `事件 ${testCase.id} 未触发（当前场景 ${driver.sceneId}；驱动 ${testCase.drive}）`,
      ).toBe(true);
      driver.drain();
      expect(driver.choices().length, `${testCase.id} 事件内应有可选项`).toBeGreaterThan(0);
    });
  }
});
