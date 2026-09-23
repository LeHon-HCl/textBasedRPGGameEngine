import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AchievementGalleryEntry } from '@game/engine';
import {
  progressPercent,
  projectAchievementGallery,
} from '../../src/panels/achievements-projection.js';
import { AchievementGalleryPanel } from '../../src/panels/AchievementGalleryPanel.js';

/**
 * C1 测试（25 号 B 组）：成就图鉴投影与面板（FR-ACHV-04）。
 *
 * 覆盖：分组与排序、收集率、进度百分比（边界）、面板三态呈现
 * （已解锁 / 普通未解锁 / 隐藏占位）、隐藏成就零信息泄露。
 */

const ENTRIES: AchievementGalleryEntry[] = [
  { id: 'ach_b', hidden: false, unlocked: true, points: 10, nameKey: 'ach.b', group: 'story' },
  { id: 'ach_a', hidden: false, unlocked: false, points: 5, nameKey: 'ach.a', group: 'story' },
  {
    id: 'ach_p',
    hidden: false,
    unlocked: false,
    points: 20,
    nameKey: 'ach.p',
    group: 'econ',
    progress: { id: 'ach_p', cur: 30, goal: 100, unlocked: false },
  },
  // 隐藏未解锁：引擎数据面不下发 nameKey（仅 hidden 标记）
  { id: 'ach_secret', hidden: true, unlocked: false, points: 50 },
];

const RATE = { unlocked: 1, total: 4, rate: 0.25 };

describe('25B-C1 projectAchievementGallery', () => {
  it('分组按名称排序；组内已解锁在前、其余按 id 稳定排序', () => {
    const view = projectAchievementGallery(ENTRIES, RATE);
    // 三组：econ / general（隐藏条目无 group）/ story——字典序
    expect(view.groups.map((group) => group.group)).toEqual(['econ', 'general', 'story']);
    const story = view.groups.find((group) => group.group === 'story');
    expect(story?.entries.map((entry) => entry.id)).toEqual(['ach_b', 'ach_a']);
    expect(story).toMatchObject({ unlocked: 1, total: 2 });
  });

  it('无 group 的条目归入 general', () => {
    const view = projectAchievementGallery(
      [{ id: 'x', hidden: false, unlocked: false, points: 1, nameKey: 'x' }],
      RATE,
    );
    expect(view.groups[0]?.group).toBe('general');
  });

  it('收集率原样透传（引擎口径不改写）', () => {
    expect(projectAchievementGallery(ENTRIES, RATE).rate).toEqual(RATE);
  });

  it('progressPercent：正常取整 / 封顶 100 / 无进度或 goal≤0 返回 null', () => {
    expect(progressPercent({ id: 'x', cur: 30, goal: 100, unlocked: false })).toBe(30);
    expect(progressPercent({ id: 'x', cur: 250, goal: 100, unlocked: false })).toBe(100);
    expect(progressPercent(undefined)).toBeNull();
    expect(progressPercent({ id: 'x', cur: 1, goal: 0, unlocked: false })).toBeNull();
  });
});

describe('25B-C1 AchievementGalleryPanel（渲染）', () => {
  it('渲染标题 + 收集率 + 分组 + 条目名', () => {
    const view = projectAchievementGallery(ENTRIES, RATE);
    render(
      <AchievementGalleryPanel
        view={view}
        resolveName={(key) => `名称:${key}`}
        labels={{ groupNames: { story: '剧情', econ: '经济' } }}
      />,
    );
    expect(screen.getByLabelText('成就')).toBeDefined();
    expect(screen.getByText('已解锁 1/4（25%）')).toBeDefined();
    expect(screen.getByText('剧情 (1/2)')).toBeDefined();
    expect(screen.getByText(/名称:ach\.b/)).toBeDefined();
    // 已解锁标记（文本被拆为多个节点，用函数匹配器）
    expect(
      screen.getByText((_, element) => element?.textContent === '名称:ach.b · 已解锁'),
    ).toBeDefined();
  });

  it('隐藏未解锁条目：仅占位，不泄露名称/条件/分数以外的信息', () => {
    const view = projectAchievementGallery(ENTRIES, RATE);
    render(<AchievementGalleryPanel view={view} />);
    expect(screen.getAllByText('???').length).toBe(1);
    // 隐藏成就的 nameKey 不存在于数据面——面板不可能显示它
    expect(screen.queryByText(/ach\.secret/)).toBeNull();
  });

  it('进度型：渲染进度条与 cur/goal 文本（aria 值）', () => {
    const view = projectAchievementGallery(ENTRIES, RATE);
    const { container } = render(<AchievementGalleryPanel view={view} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('30');
    expect(screen.getByText('30 / 100')).toBeDefined();
  });

  it('空态：无成就时显示空提示', () => {
    render(
      <AchievementGalleryPanel view={{ groups: [], rate: { unlocked: 0, total: 0, rate: 0 } }} />,
    );
    expect(screen.getByText('暂无成就')).toBeDefined();
  });

  it('缺省文案回退：未注入 resolveName 时显示 nameKey', () => {
    const view = projectAchievementGallery(ENTRIES, RATE);
    render(<AchievementGalleryPanel view={view} />);
    expect(screen.getByText(/ach\.b/)).toBeDefined();
  });
});
