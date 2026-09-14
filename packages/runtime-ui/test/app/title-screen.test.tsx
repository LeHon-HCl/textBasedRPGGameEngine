import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { TitleScreen } from '../../src/app/index.js';
import type { SaveSlotSummary } from '../../src/app/index.js';

/**
 * 25 任务 3：主菜单（设计 §6.1 组件树 TitleScreen；FR-UI-06）。
 *
 * 六项：继续（最近存档）/ 新游戏（含 Perk 选择流程入口）/ 读档 / 成就 / 设置 / 关于。
 * 契约：受控组件——`continueSlot` 决定「继续」可用性与显示名；点击只回调；
 * 读档在无存档时禁用并给出原因（不静默隐藏）。
 */

const SLOT: SaveSlotSummary = {
  slot: 'auto_1',
  name: '自动存档 1',
  day: 3,
  loop: 1,
  location: 'market_street',
  slotName: 'auto_1',
  playSeconds: 3600,
  activeQuests: ['wall_rubbing'],
  createdAt: 1_700_000_000_000,
  versions: { engineVersion: '0.0.0', gameVersion: '1.0.0', schemaVersion: 1 },
};

function renderTitle(overrides: Partial<Parameters<typeof TitleScreen>[0]> = {}) {
  const handlers = {
    onNewGame: vi.fn(),
    onContinue: vi.fn(),
    onOpenLoad: vi.fn(),
    onOpenAchievements: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenAbout: vi.fn(),
  };
  const utils = render(
    <TitleScreen
      gameTitle="旧镇迷雾"
      continueSlot={SLOT}
      saveCount={2}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...utils, ...handlers };
}

describe('主菜单六项（FR-UI-06）', () => {
  it('渲染继续/新游戏/读档/成就/设置/关于六项', () => {
    renderTitle();
    for (const label of ['继续', '新游戏', '读档', '成就', '设置', '关于']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: '旧镇迷雾' })).toBeInTheDocument();
  });

  it('「继续」显示最近存档摘要（槽名 / 天数 / 周目），点击回调 onContinue(slot)', async () => {
    const user = userEvent.setup();
    const { onContinue } = renderTitle();
    const continueButton = screen.getByRole('button', { name: /^继续/ });
    expect(continueButton).toHaveTextContent('自动存档 1');
    expect(continueButton).toHaveTextContent('第 3 天');
    expect(continueButton).toHaveTextContent('第 1 周目');
    await user.click(continueButton);
    expect(onContinue).toHaveBeenCalledWith(SLOT);
  });

  it('无存档时「继续」与「读档」禁用并给出原因（不静默隐藏）', () => {
    renderTitle({ continueSlot: null, saveCount: 0 });
    const continueButton = screen.getByRole('button', { name: /^继续/ });
    expect(continueButton).toBeDisabled();
    expect(continueButton).toHaveTextContent('暂无存档');
    const loadButton = screen.getByRole('button', { name: /^读档/ });
    expect(loadButton).toBeDisabled();
    expect(loadButton).toHaveTextContent('暂无存档');
  });

  it('「读档」在存在存档时可用并显示存档数', async () => {
    const user = userEvent.setup();
    const { onOpenLoad } = renderTitle({ saveCount: 3 });
    const loadButton = screen.getByRole('button', { name: /^读档/ });
    expect(loadButton).toBeEnabled();
    expect(loadButton).toHaveTextContent('3');
    await user.click(loadButton);
    expect(onOpenLoad).toHaveBeenCalledTimes(1);
  });

  it('新游戏/成就/设置/关于各自触发对应回调', async () => {
    const user = userEvent.setup();
    const { onNewGame, onOpenAchievements, onOpenSettings, onOpenAbout } = renderTitle();
    await user.click(screen.getByRole('button', { name: /^新游戏/ }));
    await user.click(screen.getByRole('button', { name: /^成就/ }));
    await user.click(screen.getByRole('button', { name: /^设置/ }));
    await user.click(screen.getByRole('button', { name: /^关于/ }));
    expect(onNewGame).toHaveBeenCalledTimes(1);
    expect(onOpenAchievements).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenAbout).toHaveBeenCalledTimes(1);
  });

  it('「新游戏（含 Perk 选择流程）」文案可经 props 注入本地化标签', () => {
    renderTitle({
      labels: { newGame: 'New Game (Perks)', continue: 'Continue', load: 'Load' },
    });
    expect(screen.getByRole('button', { name: /New Game \(Perks\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Continue/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Load/ })).toBeInTheDocument();
  });

  it('触控目标高度 ≥44px（NFR-26）', () => {
    renderTitle();
    for (const button of screen.getAllByRole('button')) {
      expect(Number.parseFloat(button.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });
});
