import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createTextResolver } from '@game/engine';
import type { LocalePack } from '@game/engine';
import { NarrativeView, OptionList } from '../../src/narrative/index.js';
import type { NarrativeSegmentView, OptionView } from '../../src/narrative/index.js';

/**
 * 25 任务 5：NarrativeView / OptionList（设计 §6.2 组件契约；FR-READ-03）。
 *
 * 契约要点：
 * - 组件 **props 受控**：段落/选项由调用方给出，交互只回调；
 * - `onAdvance` 由推进按钮/键盘触发；`onChoice(id)` 携带选项 id；
 * - 禁用选项可见但不可点，并展示 disabledReasonKey 物化后的原因；
 * - `hiddenByFilter` 的选项**不渲染**（FR-CGRD-03 应用点 3 的 UI 侧）；
 * - 选择前的 checkpoint 是**宿主**职责（本组件的 onChoice 是唯一入口），
 *   故此处以「点击只回调一次」锁定入口唯一性。
 */

const LOCALES: Record<string, LocalePack> = {
  'zh-CN': {
    lang: 'zh-CN',
    keys: new Map<string, string>([
      ['scenes.market.enter', '集市比想象中安静。'],
      ['scenes.market.stall', '旧书摊上摊着半页手抄的镇志。'],
      ['scenes.market.choice.listen', '凑近听摊贩的低语'],
      ['scenes.market.choice.leave', '假装没听见，走开'],
      ['scenes.market.choice.locked', '翻看镇志'],
      ['scenes.market.choice.locked_reason', '需要更高的洞察'],
      ['scenes.market.choice.filtered', '被过滤的选项'],
      ['ui.advance', '继续'],
      ['ui.end', '本段旅程到此为止'],
      ['ui.ending', '—— 结局：{ending} ——'],
    ]),
  },
};

const resolver = createTextResolver({ mainLang: 'zh-CN', locales: LOCALES });

const SEGMENTS: NarrativeSegmentView[] = [
  { kind: 'text', key: 'scenes.market.enter' },
  { kind: 'spacing' },
  { kind: 'text', key: 'scenes.market.stall' },
];

const CHOICES: OptionView[] = [
  { id: 'listen', textKey: 'scenes.market.choice.listen', enabled: true },
  { id: 'leave', textKey: 'scenes.market.choice.leave', enabled: true },
  {
    id: 'locked',
    textKey: 'scenes.market.choice.locked',
    enabled: false,
    disabledReasonKey: 'scenes.market.choice.locked_reason',
  },
  { id: 'filtered', textKey: 'scenes.market.choice.filtered', enabled: true, hiddenByFilter: true },
];

describe('NarrativeView：段落流渲染（FR-READ-05 排版参数）', () => {
  it('逐段物化文本，spacing 段不产文本', () => {
    render(
      <NarrativeView
        segments={SEGMENTS}
        resolver={resolver}
        lang="zh-CN"
        textSpeed={1}
        revealed={Number.POSITIVE_INFINITY}
      />,
    );
    expect(screen.getByText('集市比想象中安静。')).toBeInTheDocument();
    expect(screen.getByText('旧书摊上摊着半页手抄的镇志。')).toBeInTheDocument();
  });

  it('revealed 只控制最后一段的揭示进度（已读段落保持完整）', () => {
    const { container, rerender } = render(
      <NarrativeView
        segments={SEGMENTS}
        resolver={resolver}
        lang="zh-CN"
        textSpeed={1}
        revealed={3}
      />,
    );
    const before = container.textContent ?? '';
    expect(before).toContain('集市比想象中安静。');
    // 第三段（索引 2）仍在打字：揭示 3 字
    const lastBefore = container.querySelectorAll('p')[1]?.textContent ?? '';
    expect(lastBefore.length).toBeLessThan('旧书摊上摊着半页手抄的镇志。'.length);

    rerender(
      <NarrativeView
        segments={SEGMENTS}
        resolver={resolver}
        lang="zh-CN"
        textSpeed={1}
        revealed={100}
      />,
    );
    expect(container.querySelectorAll('p')[1]?.textContent).toBe('旧书摊上摊着半页手抄的镇志。');
  });

  it('字号/行距经 CSS 变量施加（FR-READ-05 即时生效，无需重渲染语义）', () => {
    const { container } = render(
      <NarrativeView
        segments={SEGMENTS}
        resolver={resolver}
        lang="zh-CN"
        textSpeed={1}
        revealed={99}
        fontSize={18}
        lineHeight={1.8}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue('--narrative-font-size')).toBe('18px');
    expect(root.style.getPropertyValue('--narrative-line-height')).toBe('1.8');
  });
});

describe('OptionList：选项渲染与交互（FR-READ-03 入口唯一性）', () => {
  it('渲染可用与置灰选项；hiddenByFilter 不渲染', () => {
    render(<OptionList choices={CHOICES} resolver={resolver} lang="zh-CN" onChoice={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    // 被过滤选项的文本键不出现在文档中（应用点 3 的 UI 侧收敛）
    expect(screen.queryByText('被过滤的选项')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /被过滤/ })).not.toBeInTheDocument();
  });

  it('置灰选项可见但不可点，并显示原因键物化文案', async () => {
    const user = userEvent.setup();
    const onChoice = vi.fn();
    render(<OptionList choices={CHOICES} resolver={resolver} lang="zh-CN" onChoice={onChoice} />);
    const locked = screen.getByRole('button', { name: /翻看镇志/ });
    expect(locked).toBeDisabled();
    expect(locked).toHaveTextContent('需要更高的洞察');
    await user.click(locked);
    expect(onChoice).not.toHaveBeenCalled();
  });

  it('点击可用选项只回调一次并携带 id（checkpoint 入口唯一性）', async () => {
    const user = userEvent.setup();
    const onChoice = vi.fn();
    render(<OptionList choices={CHOICES} resolver={resolver} lang="zh-CN" onChoice={onChoice} />);
    await user.click(screen.getByRole('button', { name: '凑近听摊贩的低语' }));
    expect(onChoice).toHaveBeenCalledTimes(1);
    expect(onChoice).toHaveBeenCalledWith('listen');
  });

  it('等待选择时隐藏推进按钮由 NarrativeFooter 承担，OptionList 不混入推进语义', () => {
    render(<OptionList choices={CHOICES} resolver={resolver} lang="zh-CN" onChoice={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /继续/ })).not.toBeInTheDocument();
  });

  it('触控目标 ≥44px（NFR-26）', () => {
    render(<OptionList choices={CHOICES} resolver={resolver} lang="zh-CN" onChoice={vi.fn()} />);
    for (const button of screen.getAllByRole('button')) {
      expect(Number.parseFloat(button.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });

  it('空选项列表渲染为空的容器（不产生交互残留）', () => {
    const { container } = render(
      <OptionList choices={[]} resolver={resolver} lang="zh-CN" onChoice={vi.fn()} />,
    );
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('NarrativeView 的会话终局与推进按钮', () => {
  it('await_advance 相位显示推进按钮，点击回调 onAdvance 一次', async () => {
    const user = userEvent.setup();
    const onAdvance = vi.fn();
    render(
      <NarrativeView
        segments={SEGMENTS}
        resolver={resolver}
        lang="zh-CN"
        textSpeed={1}
        revealed={99}
        phase="await_advance"
        onAdvance={onAdvance}
        labels={{ advance: '继续 ▾' }}
      />,
    );
    await user.click(screen.getByRole('button', { name: '继续 ▾' }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('finished 相位显示终局说明且不给推进按钮（避免卡死循环）', () => {
    render(
      <NarrativeView
        segments={SEGMENTS}
        resolver={resolver}
        lang="zh-CN"
        textSpeed={1}
        revealed={99}
        phase="finished"
        onAdvance={vi.fn()}
        endReason="ending"
        endingId="quiet_town"
        labels={{ ending: '—— 结局：{ending} ——' }}
      />,
    );
    expect(screen.queryByRole('button', { name: /继续/ })).not.toBeInTheDocument();
    expect(screen.getByText('—— 结局：quiet_town ——')).toBeInTheDocument();
  });
});
