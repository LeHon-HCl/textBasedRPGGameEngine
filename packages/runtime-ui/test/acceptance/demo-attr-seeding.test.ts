import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { AttrDefs, ContentTagsDef } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import { createGameHost } from '../../src/app/game-host.js';
import { Driver } from './route-driver.js';

/**
 * demo 属性播种防线（#12「战斗伤害恒为 0」的根因回归，2026-09-27）。
 *
 * ## 为什么需要这条检查（既有检查为什么抓不到）
 * 缺陷面**不在引擎、也不在 UI 组件**，而在「宿主播种口径」与「检查播种口径」
 * 的**不一致**：`route-driver.ts` 的检查宿主注入 `CHECK_INITIAL_ATTRS`（含
 * atk/def/spd），而真实 demo 宿主只给 hp/stamina/insight。于是：
 * - `panel-wiring.test.ts` 的战斗用例在**属性齐全**的检查环境里自然通过；
 * - 浏览器的真实 demo 里 `attrs.atk` 是 `undefined`，内置伤害公式
 *   `Math.max(0, (attacker['atk'] ?? 0) * mult - defender['def'])`
 *   （`packages/engine/src/battle/damage.ts`）→ `undefined ?? 0` → **伤害恒为 0**，
 *   敌人血量永远 `6/6`，战斗无法取胜。
 *
 * 这是 `docs/develop.md` 约束 11「检查工具与被测系统同口径」在**数据装配面**
 * 的实例：检查若自带一套「更完整」的初始数据，就会掩盖真实宿主的装配缺口。
 *
 * ## 本检查的口径（关键设计）
 * 本用例**不**使用 `CHECK_INITIAL_ATTRS`，而是**从 demo 源文件读出它真正声明的
 * `initialAttrs`** 并按原样装配宿主——即「检查宿主 = 被测宿主」的同口径。这使
 * 检查具备**可证伪性**：把 demo 的 `initialAttrs` 改回旧值（只有 hp/stamina/
 * insight）时，本用例会失败；只有 demo 显式给全战斗属性时才通过。
 *
 * ## 断言语义（刻意收紧）
 * 「点击攻击后敌人 HP **下降**」——而不是 `panel-wiring.test.ts` 那种
 * 「掉血**或**战斗已结束」的宽松兜底（后者在伤害为 0 而战斗未结束时仍会通过）。
 *
 * 权威数值来源：`fixtures/mini-game/data/attrs.yaml` 的 `numeric.*.init`
 * （atk 10 / def 3 / spd 5）。见 `docs/reviews/demo-issues-11.md` 的 #12。
 */

const DEMO_MAIN = 'apps/player-demo/src/main.tsx';
const ATTRS_YAML = 'fixtures/mini-game/data/attrs.yaml';
const ROOT = 'fixtures/mini-game';

/**
 * 从 demo 源文件提取它**真正**传给 `createGameHost` 的 `initialAttrs`。
 *
 * 为什么读源码而不是复述常量：本检查的语义是「demo 声明了什么，检查就用什么」。
 * 若把数值抄进测试，缺陷被改回时检查不会跟着变——那就不是防线，只是复制。
 */
export function readDemoInitialAttrs(): Record<string, number> {
  const source = readFileSync(DEMO_MAIN, 'utf8');
  // 匹配所有的 `initialAttrs: { ... }` 字面量，取**含 hp 键**的那个：
  // 注释里也会出现 `options.initialAttrs ?? {}` 之类的字样，用「含 hp」把
  // 真实的配置字面量与注释分开（配置必然含 hp）。
  const candidates = [...source.matchAll(/\binitialAttrs:\s*\{([^}]*)\}/g)].map(
    (match) => match[1] as string,
  );
  const body = candidates.find((text) => /\bhp\b/.test(text));
  if (body === undefined) {
    throw new Error(`未能从 ${DEMO_MAIN} 解析出 initialAttrs（源码结构可能已变）`);
  }
  const attrs: Record<string, number> = {};
  for (const part of body.split(',')) {
    const [rawKey, rawValue] = part.split(':');
    if (rawKey === undefined || rawValue === undefined) continue;
    const key = rawKey.trim().replace(/^['"]|['"]$/g, '');
    const value = Number(rawValue.trim().replace(/^['"]|['"]$/g, ''));
    if (key === '') continue;
    attrs[key] = value;
  }
  return attrs;
}

/**
 * 从 demo 源文件提取它**真正**传给 `createGameHost` 的 `initialWallet`（#14）。
 *
 * 与 `readDemoInitialAttrs` 同法：读源码而非复述常量，使「改回旧值即失败」成立。
 * `wallet` 是**封闭域**（缺键 → `EVAL_ERROR`），故播种缺失的后果与属性同源：
 * 值不是默认 0，而是**键不存在**——包内任何按 `wallet.<id>` 求值的地方都会抛错
 * （成就图鉴因此整树白屏）。
 */
export function readDemoInitialWallet(): Record<string, number> {
  const source = readFileSync(DEMO_MAIN, 'utf8');
  const candidates = [...source.matchAll(/\binitialWallet:\s*\{([^}]*)\}/g)].map(
    (match) => match[1] as string,
  );
  const body = candidates.find((text) => text.trim().length > 0);
  if (body === undefined) {
    throw new Error(
      `未能从 ${DEMO_MAIN} 解析出 initialWallet（源码结构可能已变，或 #14 回归：demo 又没播种钱包）`,
    );
  }
  const wallet: Record<string, number> = {};
  for (const part of body.split(',')) {
    const [rawKey, rawValue] = part.split(':');
    if (rawKey === undefined || rawValue === undefined) continue;
    const key = rawKey.trim().replace(/^['"]|['"]$/g, '');
    const value = Number(rawValue.trim().replace(/^['"]|['"]$/g, ''));
    if (key === '') continue;
    wallet[key] = value;
  }
  return wallet;
}

/** 读夹具包内 attrs.yaml 的 numeric.*.init（战斗属性的权威初值） */
function readAttrsInit(): Record<string, number> {
  const defs = parse(readFileSync(ATTRS_YAML, 'utf8')) as AttrDefs;
  const numeric = (defs as { numeric?: Record<string, { init?: number }> }).numeric ?? {};
  return Object.fromEntries(Object.entries(numeric).map(([id, def]) => [id, def.init ?? 0]));
}

/** 读夹具包全部文件（与 route-driver 同款；此处自建，以独立控制 initialAttrs） */
function readPackage(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(ROOT, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const absolute = `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`;
    files[absolute.slice(absolute.indexOf(ROOT) + ROOT.length + 1)] = readFileSync(
      absolute,
      'utf8',
    );
  }
  return files;
}

/**
 * 自建宿主：装配真实夹具 + 真实加载管线，但**只**用 demo 的 `initialAttrs` 播种。
 *
 * 为什么不复用 `makeHost`：它的缺省值是 `CHECK_INITIAL_ATTRS`（含 atk/def/spd），
 * 那正是掩盖缺陷的口径。改它的缺省会污染既有 40+ 条检查；故在用例内自建宿主。
 * 属性与钱包都取 **demo 自己声明的值**（#12 / #14），保持「检查宿主 = 被测宿主」同口径。
 */
async function makeDemoHost() {
  const files = readPackage();
  const definition = await loadGamePackage(new InMemoryPackageSource(files));
  const attrDefs = parse(files['data/attrs.yaml'] as string) as AttrDefs;
  const contentTags = parse(files['data/content-tags.yaml'] as string) as ContentTagsDef;
  const host = createGameHost({
    definition,
    attrDefs,
    contentTags,
    initialAttrs: readDemoInitialAttrs(),
    initialWallet: readDemoInitialWallet(),
    seed: 2026, // 与 demo 同种子（同口径）
  });
  host.start();
  return { host, driver: new Driver(host) };
}

/** 自建宿主：**故意不播种钱包**（复现 #14 的宿主口径，验证求值容错） */
async function makeHostWithoutWallet() {
  const files = readPackage();
  const definition = await loadGamePackage(new InMemoryPackageSource(files));
  const attrDefs = parse(files['data/attrs.yaml'] as string) as AttrDefs;
  const contentTags = parse(files['data/content-tags.yaml'] as string) as ContentTagsDef;
  const host = createGameHost({
    definition,
    attrDefs,
    contentTags,
    initialAttrs: readDemoInitialAttrs(),
    seed: 2026,
  });
  host.start();
  return host;
}

/** 敌人总血量（未倒下的也计入 0，便于「下降」断言覆盖击杀） */
function enemyTotalHp(host: Awaited<ReturnType<typeof makeDemoHost>>['host']): number {
  const session = host.battleSession();
  if (session === null) return 0;
  return session.units
    .filter((unit) => unit.side === 'enemy')
    .reduce((sum, unit) => sum + unit.hp, 0);
}

describe('demo 属性播种防线（#12 战斗伤害恒为 0）', () => {
  it('demo 的 initialAttrs 与 attrs.yaml 的 numeric.init 一致（战斗属性不得缺失）', () => {
    const demoAttrs = readDemoInitialAttrs();
    const init = readAttrsInit();
    // 逐项对齐权威初值：缺失（undefined）或数值不符都会被这条抓出。
    // 这是「根因面」的静态断言，失败信息直接指向 #12 与 attrs.yaml。
    for (const id of ['hp', 'stamina', 'insight', 'atk', 'def', 'spd']) {
      expect(
        demoAttrs[id],
        `demo 的 initialAttrs 缺 ${id}（宿主只用 initialAttrs 播种、不消费 attrDefs.init，` +
          `缺失即玩家态无该键；见 docs/reviews/demo-issues-11.md #12）`,
      ).toBe(init[id]);
    }
  });

  it('按 demo 的 initialAttrs 装配时，点击攻击能对敌人造成伤害（敌人 HP 下降）', async () => {
    const { host, driver } = await makeDemoHost();

    // —— 走到采石场（#12 的实测路径）——
    // 属性可否被检查临时提升不属于被测语义：用 exec 补足 insight 门槛（到 hillside
    // 需 insight ≥ 4）。**绝不补 atk**——那正是被测点（伤害能否打出）。
    driver.choose('go_gate');
    host.runtime.exec([{ add: { key: 'attr.insight', amount: 4 } }], {
      source: 'debug',
      where: { scene: driver.sceneId },
      rng: host.runtime.rng,
    });
    driver.choose('go_riverside');
    driver.moveTo('riverside', 'embankment');
    driver.settleAt('riverside', 'embankment', 'riverside_embankment');
    driver.choose('to_hillside');
    driver.choose('to_quarry');
    expect(driver.choices(), '应已到达采石场并可发起战斗').toContain('fight_rats');

    // —— 进入战斗 ——
    driver.choose('fight_rats');
    const before = host.battleSession();
    expect(before, '战斗会话应已建立（宿主订阅 battle_start）').not.toBeNull();
    expect(before?.phase, '进入战斗后应停在 await_player（#8 的起步驱动）').toBe('await_player');
    const hpBefore = enemyTotalHp(host);
    expect(hpBefore, '敌人初始应有血量').toBeGreaterThan(0);

    // —— 攻击 ——
    host.battleAct({ kind: 'skill', skillId: 'strike' });

    // —— 断言：敌人 HP **严格下降** ——
    // 刻意不用「掉血或战斗已结束」的宽松兜底：#12 下战斗**未结束**且敌人血量不变，
    // 宽松兜底会误判为通过（正是缺陷逃逸的原因）。此处要求会话仍在且血量真降。
    const after = host.battleSession();
    expect(after, '单次攻击不应结束双岩鼠战斗（用于断言血量变化）').not.toBeNull();
    const hpAfter = enemyTotalHp(host);
    expect(
      hpAfter,
      `攻击后敌人总血量应下降（demo 播种口径下玩家 atk 必须存在；` +
        `#12：initialAttrs 缺 atk → undefined ?? 0 → 伤害恒为 0）`,
    ).toBeLessThan(hpBefore);

    // 交叉验证：日志里存在对**敌人**造成的正数伤害（vars.target 命中敌人名键）。
    const damageEntries = after?.log.filter((entry) => entry.key === 'battle.log.damage') ?? [];
    const enemyNameKeys =
      before?.units.filter((unit) => unit.side === 'enemy').map((unit) => unit.nameKey) ?? [];
    const hitEnemy = damageEntries.some(
      (entry) =>
        enemyNameKeys.includes(String(entry.vars?.['target'])) &&
        Number(entry.vars?.['amount'] ?? 0) > 0,
    );
    expect(hitEnemy, '战斗日志应记录「对敌人造成正数伤害」').toBe(true);
    expect(host.lastError()).toBeNull();
  });
});

/**
 * #14（2026-09-27）：打开成就面板**整树白屏**——同一「宿主播种口径」问题，
 * 本次是 `initialWallet` 缺失（`wallet` 是封闭域，缺键 → `EVAL_ERROR`），
 * 而 `achievements.yaml` 的 `wealthy` 成就读 `wallet.town_silver`；
 * 求值抛错冒到 React 渲染层 → `OverlayPanels` 崩掉 → `#app` 清空。
 *
 * 两根都测：① demo 必须播种钱包（装配面）；② 求值失败不得掀翻整棵树（容错面）。
 */
describe('demo 钱包播种与图鉴求值容错防线（#14 成就面板白屏）', () => {
  it('demo 声明了 initialWallet，且含包内被引用的货币键', () => {
    const wallet = readDemoInitialWallet();
    // 包内实际引用了哪些货币：从 data/ 里扫 `wallet.<id>`（不硬编码，随内容演进）
    const referenced = new Set<string>();
    for (const [path, content] of Object.entries(readPackage())) {
      if (!path.startsWith('data/')) continue;
      for (const match of content.matchAll(/wallet\.([a-z_]+)/g)) {
        referenced.add(match[1] as string);
      }
    }
    expect(referenced.size, '夹具应至少引用一种货币（否则本用例失去意义）').toBeGreaterThan(0);
    for (const currency of referenced) {
      expect(
        wallet[currency],
        `demo 的 initialWallet 缺 ${currency}（wallet 是封闭域，缺键即 EVAL_ERROR；` +
          `包内 data/ 有 'wallet.${currency}' 引用；见 docs/reviews/demo-issues-11.md #14）`,
      ).toBeTypeOf('number');
    }
  });

  it('demo 播种口径下打开成就图鉴不抛错（能正常取到条目）', async () => {
    const { host } = await makeDemoHost();
    // 不抛错即通过；并确认确实拿到了图鉴数据（非空）
    const view = host.achievementGallery();
    expect(view.groups.length, '成就图鉴应有分组').toBeGreaterThan(0);
    expect(host.lastError(), '正常播种下不应产生错误').toBeNull();
  });

  it('未播种钱包时求值失败**不抛出**，转为 lastError 并降级为空图鉴（#14 容错面）', async () => {
    const host = await makeHostWithoutWallet();
    // 核心断言：**不抛**（此前这里会把整个 React 树掀翻成白屏）
    let view: ReturnType<typeof host.achievementGallery> | undefined;
    expect(() => {
      view = host.achievementGallery();
    }, '#14：求值失败不得抛出（否则 React 整树崩掉 → 白屏）').not.toThrow();
    expect(view?.groups.length, '降级为空图鉴').toBe(0);
    // 但错误必须**显性化**（数据问题要看得见，不能静默吞掉）
    expect(host.lastError()?.code, '错误应转到 lastError 可见').toBe('EVAL_ERROR');
    expect(host.lastError()?.detail).toContain('town_silver');
  });
});
