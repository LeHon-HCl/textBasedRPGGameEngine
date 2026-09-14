import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ContentTagDef } from '@game/shared';
import { ContentWizard } from '../../src/onboarding/index.js';

/**
 * 25 任务 12：首启内容向导（设计 §6.5 末段 / FR-CGRD-04）。
 *
 * 数据面由引擎 `resolveContentWizard` 提供（warningKey + needed，22 号产物）；
 * 本组件承担 UI 流程：内容警告页（manifest 文案键物化）+ 标签开关（初始态由
 * `ContentFilter.initialDisabledTags()` 投影）+ 确认/跳过。
 *
 * 语义（FR-CGRD-04「可跳过、可在设置中修改」）：
 * - 跳过与确认都完成向导（写 `settings.wizardDone` 归宿主）；
 * - 跳过 ≠ 不应用选择：跳过的语义是「采用当前（默认）开关态」，须一并提交，
 *   否则默认关闭的标签会被静默打开——那是隐私语义的反转。
 */

const TAGS: readonly ContentTagDef[] = [
  { id: 'general', nameKey: 'tags.general.name', defaultOn: true },
  { id: 'tag_horror', nameKey: 'tags.horror.name', defaultOn: false },
  { id: 'tag_romance', nameKey: 'tags.romance.name', defaultOn: true },
];

/** 初始禁用集（ContentFilter.initialDisabledTags() 的等价投影：defaultOn=false） */
const INITIAL_DISABLED = ['tag_horror'];

function renderWizard(overrides: Partial<Parameters<typeof ContentWizard>[0]> = {}) {
  const handlers = { onConfirm: vi.fn(), onSkip: vi.fn() };
  const utils = render(
    <ContentWizard
      warningKey="manifest.content_warning"
      tags={TAGS}
      initialDisabledTags={INITIAL_DISABLED}
      nameOf={(key) => `「${key}」`}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...utils, ...handlers };
}

describe('ContentWizard：内容警告页（FR-CGRD-04）', () => {
  it('渲染 manifest 警告文案键的物化结果', () => {
    renderWizard();
    expect(screen.getByText('「manifest.content_warning」')).toBeInTheDocument();
  });

  it('warningKey 为 null 时不渲染警告页（游戏未声明警告文案）', () => {
    renderWizard({ warningKey: null });
    expect(screen.queryByText(/manifest\.content_warning/)).not.toBeInTheDocument();
    // 标签开关区仍在（向导流程不因缺警告文案而中断）
    expect(screen.getByLabelText('「tags.general.name」')).toBeInTheDocument();
  });

  it('提供确认与跳过两个动作（可跳过，FR-CGRD-04）', () => {
    renderWizard();
    expect(screen.getByRole('button', { name: /开始|确认/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /跳过/ })).toBeInTheDocument();
  });
});

describe('ContentWizard：标签开关（FR-CGRD-03/04）', () => {
  it('开关初始态 = 未被禁用（initialDisabledTags 取反）', () => {
    renderWizard();
    expect(screen.getByLabelText('「tags.general.name」')).toBeChecked();
    expect(screen.getByLabelText('「tags.horror.name」')).not.toBeChecked();
    expect(screen.getByLabelText('「tags.romance.name」')).toBeChecked();
  });

  it('确认时提交当前禁用集（含默认关闭项）', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderWizard();
    await user.click(screen.getByRole('button', { name: /开始|确认/ }));
    expect(onConfirm).toHaveBeenCalledWith({ disabledTags: ['tag_horror'] });
  });

  it('切换开关后确认，提交更新后的禁用集', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderWizard();
    // 关闭 romance（加入禁用集）；开启 horror（移出禁用集）
    await user.click(screen.getByLabelText('「tags.romance.name」'));
    await user.click(screen.getByLabelText('「tags.horror.name」'));
    await user.click(screen.getByRole('button', { name: /开始|确认/ }));
    expect(onConfirm).toHaveBeenCalledWith({ disabledTags: ['tag_romance'] });
  });

  it('跳过时同样提交当前开关态（跳过 ≠ 丢弃选择，避免默认关闭项被静默打开）', async () => {
    const user = userEvent.setup();
    const { onSkip, onConfirm } = renderWizard();
    await user.click(screen.getByRole('button', { name: /跳过/ }));
    expect(onSkip).toHaveBeenCalledWith({ disabledTags: ['tag_horror'] });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('跳过前若已调整开关，跳过后提交的是调整后的结果', async () => {
    const user = userEvent.setup();
    const { onSkip } = renderWizard();
    await user.click(screen.getByLabelText('「tags.horror.name」'));
    await user.click(screen.getByRole('button', { name: /跳过/ }));
    expect(onSkip).toHaveBeenCalledWith({ disabledTags: [] });
  });

  it('标签为空时不渲染开关区（纯警告页形态）', () => {
    renderWizard({ tags: [] });
    expect(screen.getByRole('button', { name: /开始|确认/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /内容标签/ })).not.toBeInTheDocument();
  });
});

describe('ContentWizard：文案注入与无障碍', () => {
  it('全部文案可注入（D4 边界）', () => {
    renderWizard({
      labels: {
        title: '内容提示',
        confirm: '我已知悉',
        skip: '略过',
        tagsTitle: '分级开关',
      },
    });
    expect(screen.getByRole('heading', { name: '内容提示' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我已知悉' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '略过' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '分级开关' })).toBeInTheDocument();
  });

  it('触控目标 ≥44px（NFR-26；移动端首启场景）', () => {
    renderWizard();
    for (const button of screen.getAllByRole('button')) {
      expect(Number.parseFloat(button.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });
});
