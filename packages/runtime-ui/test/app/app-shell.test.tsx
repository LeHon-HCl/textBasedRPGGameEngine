import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { AppShell, NARROW_BREAKPOINT_PX, TOUCH_TARGET_PX } from '../../src/app/index.js';

/**
 * 25 任务 2：AppShell 响应式布局（设计 §6.1 组件树 / §6.2 响应式；FR-UI-01/09）。
 *
 * 组件契约（props 受控、可 Testing Library 测）：
 * - 宽屏（≥900px）：主文本区 + 侧栏双栏，侧栏同时承载状态/地图/任务三面板；
 * - 窄屏（<900px）：侧栏折叠为 Tab（FR-UI-09），一次只显示一个面板；
 * - 主文本区与底部选项区常驻（FR-UI-01「主文本区 + 侧栏 + 底部选项区」）；
 * - 触控目标 ≥44px（NFR-26 无障碍；以行内样式锁定，可在测试中断言）。
 *
 * 断点判定归宿主：`narrow` 属性显式传入时以属性为准（测试与宿主可控），
 * 缺省走 matchMedia 订阅（`useIsNarrow`）。
 */

const tabLabels = { status: '状态', map: '地图', quest: '任务' } as const;

function renderShell(overrides: Partial<Parameters<typeof AppShell>[0]> = {}) {
  const handlers = { onMobileTabChange: vi.fn() };
  const utils = render(
    <AppShell
      screenTitle="旧镇迷雾"
      narrative={<p data-testid="narrative-body">正文</p>}
      options={<div data-testid="options-body">选项区</div>}
      statusPanel={<div data-testid="status-panel">状态面板</div>}
      mapPanel={<div data-testid="map-panel">地图面板</div>}
      questPanel={<div data-testid="quest-panel">任务面板</div>}
      mobileTab="status"
      tabLabels={tabLabels}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...utils, ...handlers };
}

describe('AppShell 宽屏双栏（FR-UI-01）', () => {
  it('narrow=false 时三面板全部在侧栏、无 Tab 切换条', () => {
    renderShell({ narrow: false });
    expect(screen.getByTestId('status-panel')).toBeInTheDocument();
    expect(screen.getByTestId('map-panel')).toBeInTheDocument();
    expect(screen.getByTestId('quest-panel')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('主文本区与底部选项区常驻，标题可见', () => {
    renderShell({ narrow: false });
    expect(screen.getByTestId('narrative-body')).toBeInTheDocument();
    expect(screen.getByTestId('options-body')).toBeInTheDocument();
    expect(screen.getByText('旧镇迷雾')).toBeInTheDocument();
  });

  it('shell 根节点带 data-narrow 标记供样式分支（布局状态可观测）', () => {
    const { container, rerender } = render(
      <AppShell
        narrative={<p>正文</p>}
        options={null}
        statusPanel={null}
        mapPanel={null}
        questPanel={null}
        mobileTab="status"
        tabLabels={tabLabels}
        narrow={false}
        onMobileTabChange={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-narrow="false"]')).not.toBeNull();
    rerender(
      <AppShell
        narrative={<p>正文</p>}
        options={null}
        statusPanel={null}
        mapPanel={null}
        questPanel={null}
        mobileTab="status"
        tabLabels={tabLabels}
        narrow
        onMobileTabChange={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-narrow="true"]')).not.toBeNull();
  });
});

describe('AppShell 窄屏折叠 Tab（FR-UI-09）', () => {
  it('narrow=true 时只渲染当前 Tab 的面板，其余折叠', () => {
    renderShell({ narrow: true, mobileTab: 'map' });
    expect(screen.getByTestId('map-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('status-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quest-panel')).not.toBeInTheDocument();
  });

  it('Tab 条以 role=tablist 暴露，当前 Tab aria-selected=true', () => {
    renderShell({ narrow: true, mobileTab: 'quest' });
    const tablist = screen.getByRole('tablist');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.textContent)).toEqual(['状态', '地图', '任务']);
    expect(screen.getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '状态' })).toHaveAttribute('aria-selected', 'false');
    expect(tablist).toBeInTheDocument();
  });

  it('点击 Tab 触发 onMobileTabChange（受控：状态由宿主提供）', async () => {
    const user = userEvent.setup();
    const { onMobileTabChange } = renderShell({ narrow: true, mobileTab: 'status' });
    await user.click(screen.getByRole('tab', { name: '地图' }));
    expect(onMobileTabChange).toHaveBeenCalledWith('map');
  });

  it('窄屏下叙事区与选项区仍常驻（折叠只针对侧栏）', () => {
    renderShell({ narrow: true });
    expect(screen.getByTestId('narrative-body')).toBeInTheDocument();
    expect(screen.getByTestId('options-body')).toBeInTheDocument();
  });
});

describe('AppShell 无障碍与触控目标（NFR-26）', () => {
  it('Tab 触控目标高度 ≥44px', () => {
    renderShell({ narrow: true });
    for (const tab of screen.getAllByRole('tab')) {
      expect(Number.parseFloat(tab.style.minHeight)).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
    }
  });

  it('断点常量为 900（FR-UI-09 的判定基准对外可查）', () => {
    expect(NARROW_BREAKPOINT_PX).toBe(900);
    expect(TOUCH_TARGET_PX).toBe(44);
  });
});
