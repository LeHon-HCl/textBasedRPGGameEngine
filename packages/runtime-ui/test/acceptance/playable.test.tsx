import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { AttrDefs, ContentTagsDef } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import {
  AppShell,
  createGameHost,
  MapPanel,
  NarrativeView,
  OptionList,
  QuestLogPanel,
  StatusPanel,
  UiStoreProvider,
  useUiSelector,
  selectMobileTab,
  selectSession,
  selectStatHighlights,
  selectPhase,
} from '../../src/index.js';
import type { GameHost } from '../../src/index.js';

/**
 * 25 号 A 组验收（组件级）：mini-game 在界面中完整可玩。
 *
 * 链路：fixtures/mini-game → 加载器 → 宿主 → **真实组件树**（AppShell +
 * NarrativeView + OptionList + 三面板）。断言口径为**玩家可见的结果**：
 * 文案出现在 DOM、点击选项推进场景、面板显示真实状态。
 *
 * 浏览器人工验收（`pnpm dev:player`）的自动化等价物——因 Playwright 属 M1
 * 收尾阶段（本模块不引入），此处以 Testing Library 覆盖同一交互序列。
 */

const ROOT = 'fixtures/mini-game';

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath.split('\\').join('/')}/${entry.name}`);
}

function readPackage(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const abs of listFiles(ROOT)) {
    files[abs.slice(abs.indexOf(ROOT) + ROOT.length + 1)] = readFileSync(abs, 'utf8');
  }
  return files;
}

const files = readPackage();

async function makeHost(): Promise<GameHost> {
  const definition = await loadGamePackage(new InMemoryPackageSource(files));
  const attrDefs = parse(files['data/attrs.yaml'] as string) as AttrDefs;
  const contentTags = parse(files['data/content-tags.yaml'] as string) as ContentTagsDef;
  return createGameHost({
    definition,
    attrDefs,
    contentTags,
    initialAttrs: { hp: 100, stamina: 30, insight: 0 },
    seed: 2026,
  });
}

/** 组件树装配（与 apps/player-demo 的 GameScreen 同构的测试替身） */
function GameTree({ host, narrow = false }: { host: GameHost; narrow?: boolean }): React.ReactNode {
  return (
    <UiStoreProvider store={host.store}>
      <GameTreeInner host={host} narrow={narrow} />
    </UiStoreProvider>
  );
}

/** Provider 内的实际组件树（hooks 必须在 Provider 之下调用） */
function GameTreeInner({ host, narrow }: { host: GameHost; narrow: boolean }): React.ReactNode {
  const session = useUiSelector(selectSession);
  const phase = useUiSelector(selectPhase);
  const highlights = useUiSelector(selectStatHighlights);
  const mobileTab = useUiSelector(selectMobileTab);
  const lang = host.runtime.state.settings.lang;
  return (
    <AppShell
      screenTitle="旧镇迷雾"
      narrative={
        <NarrativeView
          segments={session.segments}
          resolver={host.resolver}
          lang={lang}
          textSpeed={1}
          revealed={Number.POSITIVE_INFINITY}
          {...(phase !== undefined ? { phase } : {})}
          onAdvance={() => host.advance()}
        />
      }
      options={
        session.choices.length > 0 ? (
          <OptionList
            choices={session.choices}
            resolver={host.resolver}
            lang={lang}
            onChoice={(id) => host.choose(id)}
          />
        ) : null
      }
      statusPanel={
        <StatusPanel
          view={host.statusPanel()}
          nameOf={(key) => host.textOf(key)}
          highlights={highlights}
        />
      }
      mapPanel={
        <MapPanel
          areas={host.areas()}
          current={host.location()}
          nameOf={(key) => host.textOf(key)}
          onMove={(target) => host.moveTo({ area: target.area, location: target.location })}
        />
      }
      questPanel={
        <QuestLogPanel view={host.questLog()} nameOf={(key) => host.textOf(key)} tracked={[]} />
      }
      mobileTab={mobileTab}
      onMobileTabChange={(tab) => host.store.getState().setMobileTab(tab)}
      narrow={narrow}
    />
  );
}

describe('A 组验收：mini-game 在界面中完整可玩（组件级）', () => {
  it('新游戏 → 叙事文案出现在 DOM（TextResolver + sanitize 全链路）', async () => {
    const host = await makeHost();
    host.start();
    render(<GameTree host={host} />);
    expect(screen.getByText(/暮雨初歇/)).toBeInTheDocument();
    // 侧栏三面板同时呈现（宽屏双栏）；状态面板显示真实 hp
    expect(screen.getByRole('heading', { name: '属性' })).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('点击「继续」推进段落；段落尽后出现选项按钮', async () => {
    const user = userEvent.setup();
    const host = await makeHost();
    host.start();
    render(<GameTree host={host} />);
    await user.click(screen.getByRole('button', { name: /^继续$/ }));
    await user.click(screen.getByRole('button', { name: /^继续$/ }));
    expect(screen.getByRole('button', { name: '去集市看看' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '往镇口去' })).toBeInTheDocument();
  });

  it('点击选项 → 场景跳转、文案更新、地图当前位置随之变化', async () => {
    const user = userEvent.setup();
    const host = await makeHost();
    host.start();
    render(<GameTree host={host} />);
    await user.click(screen.getByRole('button', { name: /^继续$/ }));
    await user.click(screen.getByRole('button', { name: /^继续$/ }));
    await user.click(screen.getByRole('button', { name: '去集市看看' }));
    expect(screen.getByText(/集市比想象中安静/)).toBeInTheDocument();
    // 选项跳转不自动移动地点：手动移动后当前位置高亮（地点名经 TextResolver 物化）
    await user.click(screen.getByRole('button', { name: /露天集市/ }));
    expect(host.location()).toEqual({ area: 'old_town', location: 'market' });
  });

  it('地图面板：锁定地点禁用并显示解锁条件原文（FR-UI-02）', async () => {
    const host = await makeHost();
    host.start();
    render(<GameTree host={host} />);
    const gate = screen.getByRole('button', { name: /旧镇门口/ });
    expect(gate).toBeDisabled();
    // 解锁条件以**原文**呈现（引擎与 UI 都不解释条件语义，文案由游戏配置）
    expect(gate).toHaveTextContent('attr.insight >= 2');
    expect(gate).toHaveTextContent('移动 1 时段');
  });

  it('任务日志面板在无任务时不渲染分组标题（无噪声）', async () => {
    const host = await makeHost();
    host.start();
    render(<GameTree host={host} />);
    expect(screen.queryByRole('heading', { name: '进行中' })).not.toBeInTheDocument();
    // 但侧栏仍完整渲染（空面板不占位）
    expect(screen.getByRole('heading', { name: '属性' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '地图' })).toBeInTheDocument();
  });

  it('窄屏折叠：只显示当前 Tab 的面板（FR-UI-09）', async () => {
    const host = await makeHost();
    host.start();
    const { rerender } = render(<GameTree host={host} />);
    // 宽屏：三面板同时在侧栏
    expect(screen.getByRole('heading', { name: '属性' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '地图' })).toBeInTheDocument();

    // 窄屏：默认 mobileTab='status' → 仅状态面板 + Tab 条
    rerender(<GameTree host={host} narrow />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '属性' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '地图' })).not.toBeInTheDocument();
  });
});
