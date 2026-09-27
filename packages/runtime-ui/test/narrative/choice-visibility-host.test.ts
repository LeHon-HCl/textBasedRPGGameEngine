import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { AttrDefs, ContentTagsDef } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import { createGameHost, visibleChoices } from '../../src/index.js';
import type { GameHost } from '../../src/index.js';

/**
 * #4 的**宿主级**回归防线（真实夹具 + 真实宿主；不是纯函数自证）。
 *
 * 复现口径与玩家实测一致：`town_gate` 场景里玩家已与老卫兵搭过话
 * （`flag.old_guard_met = true`）→ `greet_guard` 被 `show_if` 隐藏，
 * 但它在引擎原始列表里**仍是第 0 项**。屏幕上的第 1 项是 `back_market`。
 *
 * 缺陷形态：宿主键盘层按**未过滤**下标取 → `session.choices[0]` 命中被隐藏的
 * `greet_guard` → 引擎抛 `error.narrative.choiceFiltered` → 红色错误卡片。
 * 收敛后两边都过 {@link visibleChoices}，下标恒定对齐玩家所见。
 *
 * 为什么放在宿主级：纯函数用例能锁住过滤语义，但锁不住「宿主到底拿哪个列表取
 * 下标」——这正是 #4 的实际缺陷位置（develop.md 约束 8 的教训：引擎/组件就绪
 * 不等于宿主接线正确）。
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

async function makeHost(): Promise<GameHost> {
  const definition = await loadGamePackage(new InMemoryPackageSource(FILES));
  const attrDefs = parse(FILES['data/attrs.yaml'] as string) as AttrDefs;
  const contentTags = parse(FILES['data/content-tags.yaml'] as string) as ContentTagsDef;
  const host = createGameHost({
    definition,
    attrDefs,
    contentTags,
    // insight=0：确保 town_gate 的 inspect_wall（showIf attr.insight >= 2）也处于隐藏态
    initialAttrs: { hp: 100, stamina: 30, insight: 0 },
    seed: 2026,
  });
  host.start();
  return host;
}

/** 推进到出现选项（段落尽 → await_choice），最多 max 步防死循环 */
function drain(host: GameHost, max = 20): void {
  for (let i = 0; i < max; i += 1) {
    if (host.store.getState().session.phase !== 'await_advance') return;
    host.advance();
  }
}

/** 宿主键盘选择路径（与 apps/player-demo/src/main.tsx 同写法：经 visibleChoices 取下标） */
function chooseByVisibleIndex(host: GameHost, index: number): void {
  const choice = visibleChoices(host.store.getState().session.choices)[index];
  if (choice !== undefined) host.choose(choice.id);
}

/** 造出 #4 的前置：进入 town_gate 并与老卫兵搭话（此后 greet_guard 被隐藏） */
async function arriveAtTownGateWithGuardMet(): Promise<GameHost> {
  const host = await makeHost();
  drain(host);
  expect(host.store.getState().session.sceneId).toBe('arrival');
  host.choose('go_gate');
  drain(host);
  expect(host.store.getState().session.sceneId).toBe('town_gate');
  const greet = visibleChoices(host.store.getState().session.choices).find(
    (choice) => choice.id === 'greet_guard',
  );
  expect(greet).toBeDefined();
  host.choose('greet_guard');
  drain(host);
  // 搭话为无 goto 的效果选项：留在本场景并回到选项相位
  expect(host.store.getState().session.sceneId).toBe('town_gate');
  expect(host.store.getState().session.phase).toBe('await_choice');
  expect(host.runtime.state.world.flags['old_guard_met']).toBe(true);
  return host;
}

describe('宿主级回归：#4 键盘选到隐藏选项', () => {
  it('前置成立：greet_guard 被隐藏但仍占引擎原始下标 0（屏幕第 1 项另有其人）', async () => {
    const host = await arriveAtTownGateWithGuardMet();
    const raw = host.store.getState().session.choices;
    // 引擎原始列表第 0 项就是被隐藏的 greet_guard——缺陷复现的前提
    expect(raw[0]?.id).toBe('greet_guard');
    expect(raw[0]?.hiddenByFilter).toBe(true);
    // 可见列表第 0 项不是它
    expect(visibleChoices(raw)[0]?.id).toBe('back_market');
    expect(visibleChoices(raw).map((choice) => choice.id)).not.toContain('greet_guard');
  });

  it('按可见下标选：不报错、跳转发生、lastError 保持为 null（#4 的直接回归防线）', async () => {
    const host = await arriveAtTownGateWithGuardMet();
    const first = visibleChoices(host.store.getState().session.choices)[0];
    expect(first?.id).toBe('back_market');

    chooseByVisibleIndex(host, 0);

    expect(host.lastError()).toBeNull();
    drain(host);
    expect(host.store.getState().session.sceneId).toBe('market_street');
  });

  it('反证：若按未过滤下标取（旧实现），会命中隐藏项并被引擎正确拒绝', async () => {
    const host = await arriveAtTownGateWithGuardMet();
    const rawFirst = host.store.getState().session.choices[0];
    expect(rawFirst?.id).toBe('greet_guard');

    host.choose(rawFirst?.id ?? '');

    // 引擎行为正确：这条报错正是 #4 的现场（屏幕第 1 项按下去却报 choiceFiltered）
    const error = host.lastError();
    expect(error?.code).toBe('INTERNAL');
    expect(error?.messageKey).toBe('error.narrative.choiceFiltered');
    // 宿主已按约定重建会话（玩家留在原场景，可另选其他选项）
    expect(host.store.getState().session.sceneId).toBe('town_gate');
  });

  it('可见数量即数字键上界：隐藏项不占序号（第 2 项为 go_riverside）', async () => {
    const host = await arriveAtTownGateWithGuardMet();
    const visible = visibleChoices(host.store.getState().session.choices);
    // 可见 = [back_market, go_riverside]（inspect_wall / report_rubbing / leave_town 均隐藏）
    expect(visible.map((choice) => choice.id)).toEqual(['back_market', 'go_riverside']);

    chooseByVisibleIndex(host, 1);

    expect(host.lastError()).toBeNull();
    drain(host);
    expect(host.store.getState().session.sceneId).toBe('riverside_ferry');
  });
});

/**
 * demo 宿主是**静态**防线（`apps/player-demo` 无测试基建，无法在包内断言其行为）。
 *
 * 为什么必须机械化：上面三条宿主级用例验证的是「经 visibleChoices 取下标是对的」，
 * 但**不能**阻止有人把 demo 的 `choose` 改回 `session.choices[index]`——那正是 #4
 * 的原始写法，而 demo 的 `pnpm test` 覆盖不到它。故在此读源码断言接线形态
 * （与 `test/app/wiring-check.test.ts` 读夹具同型：检查工具与实现同口径）。
 */
describe('#4 静态防线：demo 宿主的选项索引必须经 visibleChoices', () => {
  // 归一化空白后再断言：格式化/换行调整不应让守卫失效或误报
  const source = readFileSync('apps/player-demo/src/main.tsx', 'utf8').replace(/\s+/g, ' ');

  it('导入 visibleChoices（而非自建过滤）', () => {
    expect(source).toMatch(/import \{[^}]*\bvisibleChoices\b[^}]*\} from '@game\/runtime-ui'/);
    // 不得在 demo 内自己实现可见性规则（违反「同一规则一处实现」）
    expect(source).not.toMatch(/hiddenByFilter/);
  });

  it('choiceCount 与 choose 都经 visibleChoices 取可见列表', () => {
    expect(source).toMatch(/choiceCount: visibleChoices\(session\.choices\)\.length/);
    expect(source).toMatch(/visibleChoices\(session\.choices\)\[index\]/);
  });

  it('不再对未过滤的 session.choices 直接取下标（#4 的原始写法）', () => {
    expect(source).not.toMatch(/session\.choices\[index\]/);
    expect(source).not.toMatch(/choiceCount: session\.choices\.length/);
  });
});

/**
 * 「同一规则一处实现」的机械兜底（develop.md 约束 6 的可执行形态）。
 *
 * 为什么需要：口径漂移**不改变任何单点行为**——把 `visibleChoices(choices)` 换回
 * 内联的 `choices.filter(...)` 时所有行为断言照样绿（已实测确认），但重复实现又
 * 回来了，下一位改动者会在其中一处修 bug 而另一处继续错。故对**源码形态**断言：
 * 过滤表达式只允许出现在 `choice-visibility.ts` 一处。
 *
 * 扫描范围是 runtime-ui 的 src（不含 app/**：那里只做投影透传，不决定可见性）。
 */
describe('选项可见性只有一处实现（防口径再度漂移）', () => {
  const narrativeSrc = 'packages/runtime-ui/src/narrative';
  /** 唯一允许的实现点 */
  const SINGLE_SOURCE = 'packages/runtime-ui/src/narrative/choice-visibility.ts';

  function tsFilesOf(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => `${dir}/${entry.name}`);
  }

  /**
   * 去掉注释后的源码：只断言**代码**里的过滤，不误伤 JSDoc 里对该字段的说明
   * （NarrativeView 的渲染规则注释、types.ts 的字段文档都会提到字段名）。
   */
  function codeOf(file: string): string {
    return readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释与 JSDoc
      .replace(/\/\/.*$/gm, ''); // 行注释
  }

  it('代码中只有 choice-visibility.ts 出现过滤表达式（hiddenByFilter !== true）', () => {
    const filesWithFilter = tsFilesOf(narrativeSrc).filter((file) =>
      /hiddenByFilter !== true/.test(codeOf(file)),
    );
    expect(filesWithFilter).toEqual([SINGLE_SOURCE]);
  });

  it('代码中只有 choice-visibility.ts 与 types.ts 提到 hiddenByFilter（后者仅字段声明）', () => {
    const filesMentioning = tsFilesOf(narrativeSrc).filter((file) =>
      /hiddenByFilter/.test(codeOf(file)),
    );
    expect(filesMentioning).toEqual([SINGLE_SOURCE, 'packages/runtime-ui/src/narrative/types.ts']);
  });
});
