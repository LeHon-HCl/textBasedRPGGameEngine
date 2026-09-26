import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { AttrDefs, ContentTagsDef } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import { createGameHost } from '../../src/app/game-host.js';
import type { GameHost } from '../../src/app/game-host.js';

/**
 * 全线路检查的驱动层（demo 路线覆盖检查的基建，2026-09-25）。
 *
 * 为什么需要这一层：人工逐条点 62 个选项 + 10 个事件 + 5 条主线路不现实，
 * 且「点了没崩」不等于「效果正确」。本层把「走一条线路」变成可编程动作，
 * 使检查可以**穷举**并断言**结果**（状态变化/场景跳转/事件触发）。
 *
 * 三个能力：
 * - {@link makeHost}：装配真实宿主（真实夹具 + 真实加载管线 + 真实运行时）；
 * - {@link Driver}：会话驱动（drain 到选项 / 选选项 / 推进时段 / 走到地点）；
 * - {@link snapshot}：状态快照（断言效果的数据面）。
 */

const ROOT = 'fixtures/mini-game';

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`);
}

function readPackage(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const absolute of listFiles(ROOT)) {
    files[absolute.slice(absolute.indexOf(ROOT) + ROOT.length + 1)] = readFileSync(
      absolute,
      'utf8',
    );
  }
  return files;
}

const FILES = readPackage();

/** 检查用初始属性/钱包（足够走通全部线路；数值本身可被断言覆盖） */
export const CHECK_INITIAL_ATTRS = {
  hp: 100,
  stamina: 30,
  insight: 0,
  atk: 10,
  def: 3,
  spd: 12,
} as const;

export const CHECK_INITIAL_WALLET = { town_silver: 50 } as const;

/** 装配检查用宿主（不 start；由调用方决定何时开始） */
export async function makeHost(options?: {
  readonly disabledTags?: readonly string[];
  readonly seed?: number;
}): Promise<GameHost> {
  const definition = await loadGamePackage(new InMemoryPackageSource(FILES));
  const attrDefs = parse(FILES['data/attrs.yaml'] as string) as AttrDefs;
  const contentTags = parse(FILES['data/content-tags.yaml'] as string) as ContentTagsDef;
  const host = createGameHost({
    definition,
    attrDefs,
    contentTags,
    initialAttrs: { ...CHECK_INITIAL_ATTRS },
    initialWallet: { ...CHECK_INITIAL_WALLET },
    seed: options?.seed ?? 2026,
  });
  host.start();
  if (options?.disabledTags !== undefined) host.setDisabledTags(options.disabledTags);
  return host;
}

/** 状态快照（断言效果的数据面：与叙事无关的可变域） */
export interface StateSnapshot {
  readonly sceneId: string;
  readonly phase: string;
  readonly flags: Readonly<Record<string, unknown>>;
  readonly attrs: Readonly<Record<string, number>>;
  readonly wallet: Readonly<Record<string, number>>;
  readonly insight: number;
  readonly stamina: number;
  readonly hp: number;
  readonly day: number;
  readonly slotIndex: number;
  readonly quests: Readonly<Record<string, string>>;
  readonly bag: Readonly<Record<string, number>>;
  readonly npcs: Readonly<Record<string, { favor: number; met: boolean }>>;
  readonly choiceIds: readonly string[];
}

export function snapshot(host: GameHost): StateSnapshot {
  const state = host.runtime.state;
  const session = host.store.getState().session;
  const bag: Record<string, number> = {};
  for (const entry of state.player.bag) {
    bag[entry.itemId] = (bag[entry.itemId] ?? 0) + entry.count;
  }
  const quests: Record<string, string> = {};
  for (const [id, quest] of Object.entries(state.quests)) quests[id] = quest.state;
  const npcs: Record<string, { favor: number; met: boolean }> = {};
  for (const [id, npc] of Object.entries(state.npcs)) {
    npcs[id] = { favor: npc.favor, met: npc.met };
  }
  return {
    sceneId: session.sceneId,
    phase: session.phase,
    flags: { ...state.world.flags },
    attrs: { ...state.player.attrs },
    wallet: { ...state.player.wallet },
    insight: state.player.attrs['insight'] ?? 0,
    stamina: state.player.attrs['stamina'] ?? 0,
    hp: state.player.attrs['hp'] ?? 0,
    day: state.world.time.day,
    slotIndex: state.world.time.slotIndex,
    quests,
    bag,
    npcs,
    choiceIds: session.choices.map((choice) => choice.id),
  };
}

/**
 * 会话驱动器（检查的动作面）。
 *
 * 所有方法都是「推进到可观测状态」的语义（内部处理段落推进与相位迁移），
 * 使检查代码只表达意图（走这里 / 选这个 / 过一天），不重复相位细节。
 */
export class Driver {
  constructor(readonly host: GameHost) {}

  /** 当前相位 */
  get phase(): string {
    return this.host.store.getState().session.phase;
  }

  /** 当前场景 id */
  get sceneId(): string {
    return this.host.store.getState().session.sceneId;
  }

  /** 当前可见选项 id 列表 */
  choices(): string[] {
    return this.host.store.getState().session.choices.map((choice) => choice.id);
  }

  /** 推进段落直到出现选项 / 终局 / 无可推进（最多 max 步，防死循环） */
  drain(max = 30): void {
    for (let i = 0; i < max; i += 1) {
      const phase = this.phase;
      if (phase !== 'await_advance') break;
      this.host.advance();
    }
  }

  /** 选一个选项（自动先 drain 到选项相位）；返回是否成功选中 */
  choose(choiceId: string): boolean {
    this.drain();
    if (this.phase !== 'await_choice') return false;
    if (!this.choices().includes(choiceId)) return false;
    this.host.choose(choiceId);
    this.drain();
    return true;
  }

  /** 走到某地点（经地图移动 API：推进时段 + 可能的导航跳转 + 事件回流） */
  moveTo(area: string, location: string): void {
    this.host.moveTo({ area, location });
    this.drain();
  }

  /**
   * 稳定到达某地点的入口场景（重试 + 清事件）。
   *
   * 为什么需要重试：地图移动会推进时段 → 触发事件评估 → 会话进入事件子会话
   * （depth > 0），此时宿主的**导航跳转会被跳过**（设计意图：事件打断玩家的
   * 点击）。检查需要「确实到达」的语义，故循环：清事件 → 重新导航 → 直到
   * 到达目标地点的入口场景（或重试耗尽）。
   */
  settleAt(area: string, location: string, expectedScene: string): void {
    for (let i = 0; i < 6; i += 1) {
      this.#escapeEventScene();
      if (this.sceneId === expectedScene) return;
      // 直接经 navigateOnly（不推进时间）——避开「导航即触发事件」的循环：
      // 推进时间已在调用方的 toDay/advanceSlots 里完成，此处只需切换场景
      this.host.moveTo({ area, location });
      this.drain();
      this.#escapeEventScene();
      if (this.sceneId === expectedScene) return;
    }
  }

  /**
   * 推进时段（**原地推进**：位置不变 → 不触发导航，只流逝时间 + 事件评估）。
   *
   * 为什么用「原地 moveTo」而不是别的 API：地图移动是宿主推进时间的**唯一**
   * 入口（`moveCost` → 时间管线）。位置与当前一致时，宿主的导航条件
   * （`currentSceneId !== entryScene`）不成立，故不会切场景——这正是检查
   * 需要的「纯时间流逝」语义。
   *
   * 事件打断：推进可能触发事件（会话进入 ev_* 子会话）——记录后选末位选项
   * 清场，保证推进循环收敛。
   */
  advanceSlots(slots: number): void {
    const location = this.host.location();
    for (let i = 0; i < slots; i += 1) {
      this.host.moveTo({ area: location.area, location: location.location ?? 'market' });
      this.drain();
      // 事件打断：默认清场（保证推进循环收敛）；L2-B 需要观察事件本身，
      // 故提供 `keepEvents` 模式（**由调用方**决定何时处理事件场景）
      if (!this.#keepEventScenes) this.#escapeEventScene();
    }
  }

  /** 是否保留事件场景（L2-B 检查用：停下让调用方观察；缺省 false = 自动清场） */
  #keepEventScenes = false;

  /** 切换事件保留模式（链式，便于测试用例设置） */
  keepEventScenes(keep = true): this {
    this.#keepEventScenes = keep;
    return this;
  }

  /**
   * 设置时段（**构造时间前置**，不消耗时段、不触发事件评估）。
   *
   * 为什么需要：地点移动的 `moveCost` 各不同（shrine 是 2），逐时段推进会在
   * 奇偶时段上跳过——对「只在 night 触发」这类窄窗口事件，无法稳定命中。
   * 直接把时钟设到目标时段是**构造前置**（检查的是「事件在该时段能否触发」，
   * 而不是「玩家能否恰好走到那个时段」）。
   *
   * 经引擎内部指令写入时钟（与时间管线同一写入口，保持状态一致性）。
   */
  setSlot(slotIndex: number, slotsPerDay = 4): void {
    const current = this.host.runtime.state.world.time;
    // 只能**向前**推进（`__time.advance` 要求 slots ≥ 0）：目标时段在当前之后
    // 就直接走，否则绕到下一天的同一时段（跨天对事件窗口判定无影响——
    // 事件的 `when.slots` 只看时段，不看天）。
    const delta =
      slotIndex >= current.slotIndex
        ? slotIndex - current.slotIndex
        : slotsPerDay - current.slotIndex + slotIndex;
    this.host.runtime.exec([{ '__time.advance': { slots: delta } } as never], {
      source: 'debug',
      where: { scene: this.sceneId },
      rng: this.host.runtime.rng,
    });
  }

  /** 触发过的事件场景（L2-B 的交叉验证数据） */
  readonly interruptedByEvents: string[] = [];

  /**
   * 若当前在事件子会话，选一个出口选项离开（并记录触发过的事件场景）。
   *
   * **出口选择策略**：优先选**最后一个选项**——数据约定里事件场景的出口选项
   * 排在末尾（`back: null` 或 `goto:`），且这保证必然离开事件场景（不依赖
   * 选项 id 命名的启发式）。
   */
  #escapeEventScene(): void {
    let guard = 0;
    while (this.sceneId.startsWith('ev_') && guard < 6) {
      guard += 1;
      if (!this.interruptedByEvents.includes(this.sceneId)) {
        this.interruptedByEvents.push(this.sceneId);
      }
      this.drain();
      const choices = this.choices();
      if (choices.length === 0) break;
      // 取最后一个选项（数据约定：出口在末位）；若它不离开则逐个尝试
      for (let i = choices.length - 1; i >= 0; i -= 1) {
        const before = this.sceneId;
        this.host.choose(choices[i] as string);
        this.drain();
        if (this.sceneId !== before || !this.sceneId.startsWith('ev_')) break;
      }
    }
  }

  /** 推进到指定时段（同日或跨日；用于事件窗口匹配） */
  advanceToSlot(slotIndex: number): void {
    let guard = 0;
    while (this.host.runtime.state.world.time.slotIndex !== slotIndex && guard < 12) {
      this.advanceSlots(1);
      guard += 1;
    }
  }

  /**
   * 推进到指定天（用于 day >= 7 的结局线路）。
   *
   * @param stay 驻留地点（可选）：每次推进后导航回该地点，避免「就地重进当前
   *   地点」导致的位置漂移（事件打断 + 出口选项会把玩家带到别处）
   */
  advanceToDay(day: number, stay?: { area: string; location: string; scene: string }): void {
    let guard = 0;
    while (this.host.runtime.state.world.time.day < day && guard < 80) {
      this.advanceSlots(1);
      guard += 1;
      // 事件清场可能把会话带回其他场景——需要时导航回驻留点
      if (stay !== undefined && this.sceneId !== stay.scene) {
        this.settleAt(stay.area, stay.location, stay.scene);
      }
    }
    if (stay !== undefined && this.sceneId !== stay.scene) {
      this.settleAt(stay.area, stay.location, stay.scene);
    }
  }

  /** 当前状态快照 */
  snapshot(): StateSnapshot {
    return snapshot(this.host);
  }
}

/** 便捷：装配宿主 + 驱动器 */
export async function makeDriver(options?: {
  readonly disabledTags?: readonly string[];
  readonly seed?: number;
}): Promise<{ host: GameHost; driver: Driver }> {
  const host = await makeHost(options);
  return { host, driver: new Driver(host) };
}

/** 夹具定义（检查需要读数据全集：选项/事件/任务清单） */
export async function loadFixtureDefinition() {
  return loadGamePackage(new InMemoryPackageSource(FILES));
}
