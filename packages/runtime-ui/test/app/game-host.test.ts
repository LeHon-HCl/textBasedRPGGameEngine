import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { AttrDefs, ContentTagsDef } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import { createGameHost } from '../../src/app/game-host.js';
import type { GameHost } from '../../src/app/game-host.js';

/**
 * 25 号宿主集成（A 组验收载体）：以 fixtures/mini-game **真实数据包**跑通
 * 「载入 → 开新档 → 推进 → 选择 → 地图/状态/任务投影」全链路。
 *
 * 与 apps/player-demo 的分工：本文件在 node 环境验证宿主接线的**行为**
 * （会话相位迁移、checkpoint 次序、面板数据源），浏览器人工验收在 demo 侧。
 */

const ROOT = 'fixtures/mini-game';

/** 递归列出包内全部文件（相对路径，正斜杠） */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`);
}

/** 读包为内存文件表（路径相对 ROOT） */
function readPackage(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const absolute of listFiles(ROOT)) {
    const relative = absolute.slice(absolute.indexOf(ROOT) + ROOT.length + 1);
    files[relative] = readFileSync(absolute, 'utf8');
  }
  return files;
}

/** 解析夹具中的 attrs.yaml 与 content-tags.yaml（宿主注入面） */
function readSupportDomains(files: Record<string, string>): {
  attrDefs: AttrDefs;
  contentTags: ContentTagsDef;
} {
  const attrDefs = parse(files['data/attrs.yaml'] as string) as AttrDefs;
  const contentTags = parse(files['data/content-tags.yaml'] as string) as ContentTagsDef;
  return { attrDefs, contentTags };
}

const files = readPackage();

async function makeHost(options?: {
  initialWallet?: Readonly<Record<string, number>>;
}): Promise<GameHost> {
  const definition = await loadGamePackage(new InMemoryPackageSource(files));
  const { attrDefs, contentTags } = readSupportDomains(files);
  return createGameHost({
    definition,
    attrDefs,
    contentTags,
    initialAttrs: { hp: 100, stamina: 30, insight: 0 },
    ...(options?.initialWallet !== undefined ? { initialWallet: options.initialWallet } : {}),
    seed: 2026,
  });
}

describe('宿主装配：mini-game 端到端（设计 §6.1/§6.2）', () => {
  it('start 后进入 game 屏，会话投影含入口场景与段落', async () => {
    const host = await makeHost();
    host.start();
    const state = host.store.getState();
    expect(state.screen).toBe('game');
    expect(state.session.sceneId).toBe('arrival');
    expect(state.session.phase).toBe('await_advance');
    expect(state.session.segments.length).toBeGreaterThan(0);
    expect(state.session.segments[0]?.key).toBe('scenes.arrival.open');
  });

  it('advance 逐段揭示，段落尽后转 await_choice 且选项可见', async () => {
    const host = await makeHost();
    host.start();
    // 首段已揭示；advance 揭示余下段落，再一次 advance 触发终局迁移（§4.2）
    host.advance();
    expect(host.store.getState().session.segments.length).toBeGreaterThan(1);
    host.advance();
    const session = host.store.getState().session;
    expect(session.phase).toBe('await_choice');
    expect(session.choices.map((choice) => choice.id)).toEqual(['go_market', 'go_gate']);
  });

  it('choose 跳转场景：sceneId 变化且段落更新', async () => {
    const host = await makeHost();
    host.start();
    host.advance();
    host.advance();
    host.choose('go_market');
    const session = host.store.getState().session;
    expect(session.sceneId).toBe('market_street');
    expect(session.segments[0]?.key).toBe('scenes.market_street.enter');
  });

  it('文本键经宿主物化（TextResolver 生效）', async () => {
    const host = await makeHost();
    host.start();
    const open = host.store.getState().session.segments[0]?.key as string;
    expect(host.textOf(open)).toContain('石板路');
  });

  it('initialWallet 写入钱包：wallet 是封闭域，建当前必须已有货币键（DD-01）', async () => {
    const host = await makeHost({ initialWallet: { town_silver: 12 } });
    host.start();
    expect(host.runtime.state.player.wallet['town_silver']).toBe(12);
    // 建当后会话正常推进（钱包条件表达式不再因缺键抛 EVAL_ERROR）
    expect(host.store.getState().session.phase).toBe('await_advance');
  });

  it('未注入钱包时 wallet 为空（不隐式造币）', async () => {
    const host = await makeHost();
    host.start();
    expect(host.runtime.state.player.wallet).toEqual({});
  });

  it('NPC 播种：全部已声明 NPC 建档，未遇见者 met=false（封闭域下「尚未遇见」可求值）', async () => {
    const host = await makeHost();
    host.start();
    const npcs = host.runtime.state.npcs;
    // 夹具声明 3 个 NPC（old_guard / hawker / ferryman）——全部播种
    expect(Object.keys(npcs).sort()).toEqual(['ferryman', 'hawker', 'old_guard']);
    for (const id of ['ferryman', 'hawker', 'old_guard']) {
      expect(npcs[id]?.met).toBe(false);
    }
    // 端到端：跨区域跳转依赖 `!npc.ferryman.met`（修复前因未建档抛 EVAL_ERROR 被阻断）
    host.advance();
    host.advance();
    host.choose('go_gate');
    for (let i = 0; i < 4; i += 1) {
      if (host.store.getState().session.phase !== 'await_advance') break;
      host.advance();
    }
    host.choose('go_riverside');
    expect(host.lastError()).toBeNull();
    expect(host.store.getState().session.sceneId).toBe('riverside_ferry');
  });
});

describe('选择前 checkpoint（FR-READ-03）', () => {
  it('choose 前打点：rollback 回退状态并重建会话（FR-READ-03）', async () => {
    const host = await makeHost();
    host.start();
    host.advance();
    host.advance();
    host.choose('go_market');
    expect(host.store.getState().session.sceneId).toBe('market_street');

    host.rollback();
    expect(host.lastError()).toBeNull();
    // 会话重建到入口场景（状态已回到选择前；rollback 只还原状态，叙事位置
    // 须重开会话——§6.3「rollback + session 重建」）
    expect(host.store.getState().session.sceneId).toBe('arrival');
    expect(host.store.getState().session.phase).toBe('await_advance');
  });

  it('无 checkpoint 时回滚报告 NO_CHECKPOINT（不静默）', async () => {
    const host = await makeHost();
    host.start();
    host.rollback();
    expect(host.lastError()?.code).toBe('NO_CHECKPOINT');
  });
});

describe('选择失败后的会话恢复（2026-09-15 用户实测缺陷）', () => {
  /**
   * 背景：某选项的效果在运行期失败（典型：`quest: accept` 被状态机拒绝）时，
   * SceneRunner 会停在 `resolving` 错误挂起态（设计 §4.2：由宿主经 rollback 恢复）。
   * 原实现只回滚状态、**未重建 session**——`choices()` 只在 `await_choice` 返回列表，
   * 于是选项全部消失，玩家卡死在场景里（用户实测：「再点一次徽记选项全没了」）。
   *
   * 为什么用注入的失败选项而不是夹具现成的选项：夹具里的失败路径是**内容缺陷**
   * （修掉后不应再有），而本组用例守护的是**宿主契约**——任何效果失败都不得
   * 把会话留在 `resolving`。故构造一个必然失败的选项（acceptIf 未满足时 accept）。
   */
  function injectAlwaysFailChoice(files: Record<string, string>): Record<string, string> {
    const key = 'data/scenes/old_town/arrival.yaml';
    const original = files[key] as string;
    // wall_rubbing.acceptIf = flag.heard_rumor；新档未听传闻 → accept 必然被拒
    const injected = original.replace(
      /^choices:$/m,
      [
        'choices:',
        '  - id: always_fail_probe',
        '    textKey: scenes.arrival.choice.go_market',
        '    effects:',
        '      - quest: { id: wall_rubbing, action: accept }',
      ].join('\n'),
    );
    return { ...files, [key]: injected };
  }

  async function makeHostWithFailingChoice(): Promise<GameHost> {
    const definition = await loadGamePackage(
      new InMemoryPackageSource(injectAlwaysFailChoice(files)),
    );
    const { attrDefs, contentTags } = readSupportDomains(files);
    const host = createGameHost({
      definition,
      attrDefs,
      contentTags,
      initialAttrs: { hp: 100, stamina: 30, insight: 0 },
      seed: 2026,
    });
    host.start();
    return host;
  }

  /** 推进段落直到出现选项（或到达上限） */
  function drainToChoice(host: GameHost): void {
    for (let i = 0; i < 8; i += 1) {
      if (host.store.getState().session.phase !== 'await_advance') break;
      host.advance();
    }
  }

  it('选择失败后：会话不留在 resolving，选项仍可用，可继续游玩', async () => {
    const host = await makeHostWithFailingChoice();
    drainToChoice(host);
    const before = host.store.getState().session.choices.map((c) => c.id);
    expect(before).toContain('always_fail_probe');

    host.choose('always_fail_probe');
    // 错误被显性化（UI 错误卡片的数据面）
    expect(host.lastError()?.code).toBe('EFFECT_FAILED');

    // 关键断言：失败后会话必须已恢复（而非卡在 resolving）。
    // 恢复口径遵循设计 §6.3「rollback(1) + 重建 session」：状态回到选择前、
    // 叙事在该场景重开，故相位是 entering/await_advance，**不是** resolving。
    const afterFail = host.store.getState().session;
    expect(afterFail.phase).not.toBe('resolving');
    expect(afterFail.sceneId).toBe('arrival');

    // 重开会话后重新推进 → 选项恢复，且能正常选（证明未被永久锁死）
    drainToChoice(host);
    const recovered = host.store.getState().session;
    expect(recovered.phase).toBe('await_choice');
    expect(recovered.choices.map((c) => c.id)).toContain('go_market');
    host.choose('go_market');
    expect(host.lastError()).toBeNull();
    expect(host.store.getState().session.sceneId).toBe('market_street');
  });

  it('失败事务原子回滚：状态与失败前逐字段一致', async () => {
    const host = await makeHostWithFailingChoice();
    drainToChoice(host);
    const before = host.runtime.serialize();
    host.choose('always_fail_probe');
    expect(host.lastError()?.code).toBe('EFFECT_FAILED');
    expect(host.runtime.serialize()).toEqual(before);
  });
});

describe('面板数据源投影（FR-UI-02/03/QUEST-03）', () => {
  it('状态面板投影含属性（attrs.yaml 的 numeric 域）', async () => {
    const host = await makeHost();
    host.start();
    const view = host.statusPanel();
    expect(view.attrs.map((attr) => attr.id)).toEqual(
      expect.arrayContaining(['hp', 'stamina', 'insight']),
    );
    expect(view.attrs.find((attr) => attr.id === 'hp')?.value).toBe(100);
  });

  it('地图投影含旧镇区域与地点（解锁/消耗/坐标）', async () => {
    const host = await makeHost();
    host.start();
    const areas = host.areas();
    const oldTown = areas.find((area) => area.id === 'old_town');
    expect(oldTown?.unlocked).toBe(true);
    const market = oldTown?.locations.find((location) => location.id === 'market');
    expect(market).toMatchObject({ unlocked: true, moveCost: 1 });
    // gate 的 unlockIf 是 'attr.insight >= 2'：初始 insight=0 → 锁定且有提示
    const gate = oldTown?.locations.find((location) => location.id === 'gate');
    expect(gate?.unlocked).toBe(false);
    expect(gate?.unlockHint).toBe('attr.insight >= 2');
  });

  it('日历投影给出天数与时段（ClockBadge 数据源）', async () => {
    const host = await makeHost();
    host.start();
    const calendar = host.calendar();
    expect(calendar.day).toBe(1);
    expect(calendar.slotNameKey).toBeTypeOf('string');
  });

  it('任务日志投影为空分组时结构完整（无已接任务）', async () => {
    const host = await makeHost();
    host.start();
    const log = host.questLog();
    expect(log.groups).toEqual([]);
    expect(log.tracked).toEqual([]);
  });

  it('移动消耗经时间管线推进（FR-XPLR-02）', async () => {
    const host = await makeHost();
    host.start();
    const before = host.calendar();
    host.moveTo({ area: 'old_town', location: 'market' });
    expect(host.lastError()).toBeNull();
    expect(host.location()).toEqual({ area: 'old_town', location: 'market' });
    // market 的 moveCost=1：推进一个时段（启动时段 0 → 1）
    expect(host.runtime.state.world.time.slotIndex).toBe(1);
    expect(before.day).toBe(1);
  });
});

describe('地图导航切场景（FR-XPLR-02；2026-09-15 用户实测问题 1c）', () => {
  it('点击地图地点 → 叙事会话切到该地点的入口场景', async () => {
    const host = await makeHost();
    host.start();
    expect(host.store.getState().session.sceneId).toBe('arrival');
    // gate → town_gate。选 gate 而非 market：market 在上午/下午有随机事件
    // （ev_market_rumor），事件会按设计抢占导航（见下一条用例）。
    // 启动时段为 morning，gate 的事件窗口是 evening/night → 本次不至触发。
    host.moveTo({ area: 'old_town', location: 'gate' });
    expect(host.lastError()).toBeNull();
    expect(host.store.getState().session.sceneId).toBe('town_gate');
  });

  it('事件优先于导航：地点事件触发时进入事件子会话（不覆盖为入口场景）', async () => {
    const host = await makeHost();
    host.start();
    // market 在 morning 命中 ev_market_rumor（random 型）→ 事件子会话优先
    host.moveTo({ area: 'old_town', location: 'market' });
    expect(host.lastError()).toBeNull();
    // 会话进入事件场景（子会话），而非 market_street；depth > 0 证明是压栈子会话
    expect(host.store.getState().session.sceneId).toMatch(/^ev_/);
  });

  it('跨区域导航：河畔/山丘地点各自进入入口场景', async () => {
    const host = await makeHost();
    host.start();
    host.moveTo({ area: 'riverside', location: 'ferry' });
    expect(host.store.getState().session.sceneId).toBe('riverside_ferry');
    host.moveTo({ area: 'riverside', location: 'fish_market' });
    expect(host.store.getState().session.sceneId).toBe('riverside_fish_market');
    host.moveTo({ area: 'hillside', location: 'quarry' });
    expect(host.store.getState().session.sceneId).toBe('hillside_quarry');
    expect(host.lastError()).toBeNull();
  });

  it('导航到的场景可正常交互（推进后有选项）', async () => {
    const host = await makeHost();
    host.start();
    host.moveTo({ area: 'old_town', location: 'gate' });
    for (let i = 0; i < 8; i += 1) {
      if (host.store.getState().session.phase !== 'await_advance') break;
      host.advance();
    }
    expect(host.store.getState().session.phase).toBe('await_choice');
    expect(host.store.getState().session.choices.length).toBeGreaterThan(0);
  });

  it('地图投影标注 navigable；默认只列已解锁区域', async () => {
    const host = await makeHost();
    host.start();
    const areas = host.areas();
    expect(areas.map((area) => area.id)).toEqual(['old_town']);
    const market = areas[0]?.locations.find((location) => location.id === 'market');
    expect(market?.navigable).toBe(true);
  });

  it('开发者模式：未解锁区域也列出（供内容走查）', async () => {
    const definition = await loadGamePackage(new InMemoryPackageSource(files));
    const { attrDefs, contentTags } = readSupportDomains(files);
    const host = createGameHost({
      definition,
      attrDefs,
      contentTags,
      initialAttrs: { hp: 100, stamina: 30, insight: 0 },
      developerMode: true,
      seed: 2026,
    });
    host.start();
    const ids = host.areas().map((area) => area.id);
    expect(ids).toEqual(expect.arrayContaining(['hillside', 'old_town', 'riverside']));
    expect(host.areas().find((area) => area.id === 'riverside')?.unlocked).toBe(false);
  });
});

describe('错误不逃逸（UI 错误卡片数据面）', () => {
  it('未 start 即 choose：lastError 报告 NOT_STARTED 而非抛异常', async () => {
    const host = await makeHost();
    host.choose('go_market');
    expect(host.lastError()?.code).toBe('NOT_STARTED');
  });

  it('未知地点移动：lastError 报告 UNKNOWN_LOCATION', async () => {
    const host = await makeHost();
    host.start();
    host.moveTo({ area: 'old_town', location: 'nowhere' });
    expect(host.lastError()?.code).toBe('UNKNOWN_LOCATION');
  });
});
