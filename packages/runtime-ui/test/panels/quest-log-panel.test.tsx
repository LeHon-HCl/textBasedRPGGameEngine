import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { QuestDef } from '@game/shared';
import { projectQuestLog } from '@game/engine';
import type { QuestLogView } from '@game/engine';
import { QuestLogPanel } from '../../src/panels/index.js';

/**
 * 25 任务 8：任务日志面板（设计 §6.4 / FR-QUEST-03 UI 侧）。
 *
 * 数据面由引擎 `projectQuestLog` 提供（11 号产物：按状态分组 + 追踪置顶 +
 * 上限策略）；本面板承担 UI 侧：组标题、目标文本、giver/接取日/地点指引，
 * 以及追踪开关的受控呈现。
 *
 * 去重口径：追踪条目只在置顶区渲染（不在分组内重复）——「置顶」的语义是把
 * 条目从原位置移到顶部，不是复制一份。
 */

const DEFS = new Map<string, QuestDef>([
  [
    'wall_rubbing',
    {
      id: 'wall_rubbing',
      giver: 'old_guard',
      acceptIf: 'true',
      stages: [
        {
          id: 'inspect_wall',
          objectiveKey: 'quests.wall_rubbing.obj_inspect',
          completeWhen: 'true',
        },
        { id: 'report', objectiveKey: 'quests.wall_rubbing.obj_report', completeWhen: 'true' },
      ],
      rewards: [],
    } as unknown as QuestDef,
  ],
  [
    'lost_letter',
    {
      id: 'lost_letter',
      acceptIf: 'true',
      stages: [{ id: 'deliver', objectiveKey: 'quests.lost_letter.obj', completeWhen: 'true' }],
      rewards: [],
    } as unknown as QuestDef,
  ],
  [
    'old_debt',
    {
      id: 'old_debt',
      acceptIf: 'true',
      stages: [{ id: 'pay', objectiveKey: 'quests.old_debt.obj', completeWhen: 'true' }],
      rewards: [],
    } as unknown as QuestDef,
  ],
]);

/** 三种状态的 quests 状态切片（active / ready_to_submit / done） */
const QUESTS = {
  wall_rubbing: { state: 'active' as const, stage: 'report', objectives: {} },
  lost_letter: { state: 'ready_to_submit' as const, stage: 'deliver', objectives: {} },
  old_debt: { state: 'done' as const, stage: 'pay', objectives: {}, startedDay: 2 },
};

/** 投影视图（tracked 为空 = 纯分组呈现） */
const groupedView: QuestLogView = projectQuestLog({ quests: QUESTS }, DEFS);

/** 投影视图（追踪 wall_rubbing：置顶区 + 分组去重） */
const trackedView: QuestLogView = projectQuestLog({ quests: QUESTS }, DEFS, {
  tracked: ['wall_rubbing'],
});

describe('QuestLogPanel：分组与追踪置顶（FR-QUEST-03）', () => {
  it('按状态分组渲染，组标题可注入；无追踪时不渲染置顶区', () => {
    render(
      <QuestLogPanel
        view={groupedView}
        nameOf={(key) => key}
        tracked={[]}
        onToggleTrack={vi.fn()}
      />,
    );
    for (const title of ['进行中', '待提交', '已完成']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.queryByRole('heading', { name: '追踪中' })).not.toBeInTheDocument();
  });

  it('追踪条目进置顶区且不在分组内重复（每任务只渲染一次）', () => {
    render(
      <QuestLogPanel
        view={trackedView}
        nameOf={(key) => key}
        tracked={['wall_rubbing']}
        onToggleTrack={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: '追踪中' })).toBeInTheDocument();
    expect(screen.getAllByText('quests.wall_rubbing.obj_report')).toHaveLength(1);
    // 追踪掉 wall_rubbing 后 active 组为空 → 该组标题不渲染（无噪声）
    expect(screen.queryByRole('heading', { name: '进行中' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '待提交' })).toBeInTheDocument();
  });

  it('组标题可注入本地化文案', () => {
    render(
      <QuestLogPanel
        view={groupedView}
        nameOf={(key) => key}
        tracked={[]}
        onToggleTrack={vi.fn()}
        labels={{ active: 'Active', ready_to_submit: 'Ready', done: 'Done' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Active' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ready' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Done' })).toBeInTheDocument();
  });

  it('空分组不渲染（无标题噪声）', () => {
    const onlyActive = projectQuestLog(
      { quests: { wall_rubbing: { state: 'active', stage: 'report', objectives: {} } } },
      DEFS,
    );
    render(
      <QuestLogPanel
        view={onlyActive}
        nameOf={(key) => key}
        tracked={[]}
        onToggleTrack={vi.fn()}
      />,
    );
    expect(screen.queryByRole('heading', { name: '已完成' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '进行中' })).toBeInTheDocument();
  });

  it('目标文本经 nameOf 物化（objectiveKey → 文案）', () => {
    render(
      <QuestLogPanel
        view={groupedView}
        nameOf={(key) => `「${key}」`}
        tracked={[]}
        onToggleTrack={vi.fn()}
      />,
    );
    expect(screen.getByText('「quests.wall_rubbing.obj_report」')).toBeInTheDocument();
  });

  it('giver 指引可见（FR-QUEST-03「giver/地点指引」）', () => {
    render(
      <QuestLogPanel
        view={groupedView}
        nameOf={(key) => key}
        tracked={[]}
        onToggleTrack={vi.fn()}
      />,
    );
    expect(screen.getByText(/npcs\.old_guard\.name/)).toBeInTheDocument();
  });

  it('面板级标题恒渲染（与 StatusPanel/MapPanel 同规）', () => {
    render(
      <QuestLogPanel
        view={groupedView}
        nameOf={(key) => key}
        tracked={[]}
        onToggleTrack={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: '任务' })).toBeInTheDocument();
  });

  it('无任务时仍渲染面板标题 + 空态提示（宽屏侧栏不得无字可认）', () => {
    // 2026-09-15 用户实测缺陷：宽屏三面板并排时，空任务日志没有任何标题
    // （旧实现只在有分组/追踪条目时才渲染标题），看起来像面板不存在。
    render(<QuestLogPanel view={{ groups: [], tracked: [] }} nameOf={(key) => key} tracked={[]} />);
    expect(screen.getByRole('heading', { name: '任务' })).toBeInTheDocument();
    expect(screen.getByText('暂无任务')).toBeInTheDocument();
  });

  it('面板标题与空态文案可注入本地化', () => {
    render(
      <QuestLogPanel
        view={{ groups: [], tracked: [] }}
        nameOf={(key) => key}
        tracked={[]}
        labels={{ title: 'Quests', empty: 'No quests yet' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Quests' })).toBeInTheDocument();
    expect(screen.getByText('No quests yet')).toBeInTheDocument();
  });
});

describe('QuestLogPanel：追踪开关（受控，追踪为 UI 状态）', () => {
  it('追踪中的条目按钮文案为「取消追踪」并回调任务 id', async () => {
    const user = userEvent.setup();
    const onToggleTrack = vi.fn();
    render(
      <QuestLogPanel
        view={trackedView}
        nameOf={(key) => key}
        tracked={['wall_rubbing']}
        onToggleTrack={onToggleTrack}
      />,
    );
    await user.click(screen.getByRole('button', { name: '取消追踪' }));
    expect(onToggleTrack).toHaveBeenCalledWith('wall_rubbing');
  });

  it('未追踪条目显示「追踪」按钮并回调任务 id', async () => {
    const user = userEvent.setup();
    const onToggleTrack = vi.fn();
    render(
      <QuestLogPanel
        view={groupedView}
        nameOf={(key) => key}
        tracked={[]}
        onToggleTrack={onToggleTrack}
      />,
    );
    await user.click(screen.getAllByRole('button', { name: '追踪' })[0] as HTMLElement);
    expect(onToggleTrack).toHaveBeenCalledTimes(1);
    expect(onToggleTrack.mock.calls[0]?.[0]).toBe('wall_rubbing');
  });

  it('置顶区条目数由引擎投影决定（上限策略在宿主/引擎侧，组件不自行截断）', () => {
    const limited = projectQuestLog({ quests: QUESTS }, DEFS, {
      tracked: ['wall_rubbing', 'lost_letter'],
      trackingLimit: 1,
    });
    render(
      <QuestLogPanel
        view={limited}
        nameOf={(key) => key}
        tracked={['wall_rubbing', 'lost_letter']}
        onToggleTrack={vi.fn()}
      />,
    );
    // 上限 1：置顶区只有一个「取消追踪」；被挤出置顶区的条目回落到分组并显示「追踪」
    expect(screen.getAllByRole('button', { name: '取消追踪' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '追踪' }).length).toBeGreaterThan(0);
  });

  it('不提供 onToggleTrack 时追踪按钮不渲染（纯浏览态）', () => {
    render(<QuestLogPanel view={groupedView} nameOf={(key) => key} tracked={[]} />);
    expect(screen.queryByRole('button', { name: '追踪' })).not.toBeInTheDocument();
  });
});

describe('QuestLogPanel：位置指引与日程数据（FR-QUEST-03）', () => {
  it('接取日可见（startedDay 呈现为「第 N 天接取」）', () => {
    render(
      <QuestLogPanel
        view={groupedView}
        nameOf={(key) => key}
        tracked={[]}
        onToggleTrack={vi.fn()}
      />,
    );
    expect(screen.getByText(/第 2 天接取/)).toBeInTheDocument();
  });

  it('目标位置经 locationHintOf 注入呈现（地点指引数据面；缺省不渲染）', () => {
    const { rerender } = render(
      <QuestLogPanel
        view={groupedView}
        nameOf={(key) => key}
        tracked={[]}
        onToggleTrack={vi.fn()}
      />,
    );
    expect(screen.queryByText(/旧镇 · 镇口/)).not.toBeInTheDocument();

    rerender(
      <QuestLogPanel
        view={groupedView}
        nameOf={(key) => key}
        tracked={[]}
        onToggleTrack={vi.fn()}
        locationHintOf={(questId) => (questId === 'wall_rubbing' ? '旧镇 · 镇口' : undefined)}
      />,
    );
    expect(screen.getByText('旧镇 · 镇口')).toBeInTheDocument();
  });

  it('触控目标 ≥44px（NFR-26）', () => {
    render(
      <QuestLogPanel
        view={groupedView}
        nameOf={(key) => key}
        tracked={[]}
        onToggleTrack={vi.fn()}
      />,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(Number.parseFloat(button.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });
});
