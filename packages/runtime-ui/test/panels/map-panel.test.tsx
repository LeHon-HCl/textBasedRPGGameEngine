import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { AreaDef } from '@game/shared';
import { MapPanel, projectAreaViews } from '../../src/panels/index.js';

/**
 * 25 任务 7：地图导航面板（设计 §6.2 MapPanelProps / FR-UI-02）。
 *
 * 数据面（FR-UI-02）：区域图 + 地点列表（解锁状态 + 移动消耗）+ 当前位置高亮；
 * 锁定地点显示为未知/可达条件提示（文案由游戏配置，引擎不解释语义）。
 * 投影为纯函数（AreaDef → AreaView），组件只渲染并回调 `onMove`。
 */

const AREAS = new Map<string, AreaDef>([
  [
    'old_town',
    {
      id: 'old_town',
      nameKey: 'areas.old_town.name',
      locations: {
        market: { nameKey: 'areas.old_town.market', moveCost: 1, mapPos: [120, 80] },
        gate: {
          nameKey: 'areas.old_town.gate',
          unlockIf: 'attr.insight >= 2',
          moveCost: 1,
          mapPos: [220, 60],
        },
        docks: {
          nameKey: 'areas.old_town.docks',
          unlockIf: 'flag.docks_open',
          moveCost: 2,
          mapPos: [60, 200],
        },
      },
    },
  ],
  [
    'north_hills',
    {
      id: 'north_hills',
      nameKey: 'areas.north_hills.name',
      locations: {
        pass: { nameKey: 'areas.north_hills.pass', moveCost: 3, mapPos: [10, 10] },
      },
    },
  ],
]);

/** 全部表达式求值桩：按给定集合判定（测试可控，不依赖表达式引擎） */
const evaluateWith = (passing: ReadonlySet<string>) => (expr: string) => passing.has(expr);

describe('projectAreaViews：区域与地点投影（FR-UI-02）', () => {
  it('区域未解锁时其地点不展开（区域级门控优先）', () => {
    const views = projectAreaViews(AREAS, {
      unlockedAreas: ['old_town'],
      evaluate: evaluateWith(new Set()),
    });
    expect(views.map((area) => area.id)).toEqual(['old_town']);
    expect(views[0]?.unlocked).toBe(true);
  });

  it('地点无 unlockIf 视为已解锁；有 unlockIf 者按求值结果', () => {
    const views = projectAreaViews(AREAS, {
      unlockedAreas: ['old_town'],
      evaluate: evaluateWith(new Set(['attr.insight >= 2'])),
    });
    const locations = views[0]?.locations ?? [];
    expect(locations.find((entry) => entry.id === 'market')?.unlocked).toBe(true);
    expect(locations.find((entry) => entry.id === 'gate')?.unlocked).toBe(true);
    expect(locations.find((entry) => entry.id === 'docks')?.unlocked).toBe(false);
  });

  it('锁定地点保留解锁提示（来源 unlockIf 原文，引擎不解释语义）', () => {
    const views = projectAreaViews(AREAS, {
      unlockedAreas: ['old_town'],
      evaluate: evaluateWith(new Set(['attr.insight >= 2'])),
    });
    const docks = views[0]?.locations.find((entry) => entry.id === 'docks');
    expect(docks?.unlocked).toBe(false);
    expect(docks?.unlockHint).toBe('flag.docks_open');
    // 已解锁的地点不带提示（避免陈旧提示）
    expect(views[0]?.locations.find((entry) => entry.id === 'gate')?.unlockHint).toBeUndefined();
  });

  it('未提供求值器时按「已解锁」处理（缺省不过滤，与设计 §5.8「未标注恒放行」同口径）', () => {
    const views = projectAreaViews(AREAS, { unlockedAreas: ['old_town'] });
    expect(views[0]?.locations.every((entry) => entry.unlocked)).toBe(true);
  });

  it('移动消耗与地图坐标原样投影', () => {
    const views = projectAreaViews(AREAS, { unlockedAreas: ['old_town'] });
    const market = views[0]?.locations.find((entry) => entry.id === 'market');
    expect(market).toMatchObject({ moveCost: 1, mapPos: [120, 80] });
  });

  it('多区域按名称键排序稳定（区域图列表不随 Map 插入序漂移）', () => {
    const views = projectAreaViews(AREAS, { unlockedAreas: ['old_town', 'north_hills'] });
    expect(views.map((area) => area.id)).toEqual(['north_hills', 'old_town']);
  });

  it('未解锁区域的名称与地点仍列出（显示为未知/条件提示，不隐藏）', () => {
    const views = projectAreaViews(AREAS, {
      unlockedAreas: ['old_town'],
      includeLockedAreas: true,
    });
    const locked = views.find((area) => area.id === 'north_hills');
    expect(locked?.unlocked).toBe(false);
    expect(locked?.locations.every((entry) => entry.unlocked === false)).toBe(true);
  });

  it('提供 locationEntries 时标注 navigable（有映射 true / 无映射 false）', () => {
    const views = projectAreaViews(AREAS, {
      unlockedAreas: ['old_town'],
      locationEntries: new Map([['old_town/market', 'market_street']]),
    });
    const locations = views[0]?.locations ?? [];
    expect(locations.find((entry) => entry.id === 'market')?.navigable).toBe(true);
    expect(locations.find((entry) => entry.id === 'gate')?.navigable).toBe(false);
  });

  it('不提供 locationEntries 时不标注 navigable（旧宿主行为逐字不变）', () => {
    const views = projectAreaViews(AREAS, { unlockedAreas: ['old_town'] });
    expect(views[0]?.locations.every((entry) => entry.navigable === undefined)).toBe(true);
  });
});

describe('MapPanel：渲染与交互（FR-UI-02）', () => {
  const views = projectAreaViews(AREAS, {
    unlockedAreas: ['old_town'],
    evaluate: evaluateWith(new Set(['attr.insight >= 2'])),
  });

  it('区域与地点列表渲染，移动消耗可见', () => {
    render(
      <MapPanel
        areas={views}
        current={{ area: 'old_town', location: 'market' }}
        nameOf={(key) => key}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByText('areas.old_town.name')).toBeInTheDocument();
    expect(screen.getByText('areas.old_town.market')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /areas\.old_town\.gate/ })).toHaveTextContent(
      '移动 1 时段',
    );
  });

  it('当前位置高亮（aria-current + data-current 钩子）', () => {
    render(
      <MapPanel
        areas={views}
        current={{ area: 'old_town', location: 'market' }}
        nameOf={(key) => key}
        onMove={vi.fn()}
      />,
    );
    const current = screen.getByRole('button', { name: /areas\.old_town\.market/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current).toHaveAttribute('data-current', 'true');
    expect(screen.getByRole('button', { name: /areas\.old_town\.gate/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('点击已解锁地点回调 onMove(locationId) 一次', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <MapPanel
        areas={views}
        current={{ area: 'old_town', location: 'market' }}
        nameOf={(key) => key}
        onMove={onMove}
      />,
    );
    await user.click(screen.getByRole('button', { name: /areas\.old_town\.gate/ }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ area: 'old_town', location: 'gate' });
  });

  it('锁定地点禁用不可点，并显示解锁提示原文', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <MapPanel
        areas={views}
        current={{ area: 'old_town', location: 'market' }}
        nameOf={(key) => key}
        onMove={onMove}
      />,
    );
    const docks = screen.getByRole('button', { name: /areas\.old_town\.docks/ });
    expect(docks).toBeDisabled();
    expect(docks).toHaveTextContent('flag.docks_open');
    await user.click(docks);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('当前位置不可重复移动（禁用而非隐藏，保持可读）', () => {
    render(
      <MapPanel
        areas={views}
        current={{ area: 'old_town', location: 'market' }}
        nameOf={(key) => key}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /areas\.old_town\.market/ })).toBeDisabled();
  });

  it('区域标题与地点同为列表结构（区域图骨架）', () => {
    render(
      <MapPanel
        areas={views}
        current={{ area: 'old_town', location: 'market' }}
        nameOf={(key) => key}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'areas.old_town.name' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('触控目标 ≥44px（NFR-26）', () => {
    render(
      <MapPanel
        areas={views}
        current={{ area: 'old_town', location: 'market' }}
        nameOf={(key) => key}
        onMove={vi.fn()}
      />,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(Number.parseFloat(button.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });

  it('移动消耗为 0 的地点显示「无需耗时」而非「移动 0 时段」', () => {
    const freeAreas = projectAreaViews(
      new Map<string, AreaDef>([
        [
          'old_town',
          {
            id: 'old_town',
            nameKey: 'areas.old_town.name',
            locations: {
              well: { nameKey: 'loc.well', moveCost: 0, mapPos: [0, 0] },
            },
          },
        ],
      ]),
      { unlockedAreas: ['old_town'] },
    );
    render(
      <MapPanel
        areas={freeAreas}
        current={{ area: 'old_town', location: 'market' }}
        nameOf={(key) => key}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /loc\.well/ })).toHaveTextContent('无需耗时');
  });
});
