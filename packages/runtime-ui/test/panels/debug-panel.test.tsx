import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DebugPanel } from '../../src/panels/DebugPanel.js';

/**
 * Q3 测试（25 号 B 组）：调试面板（FR-DEBG-01～07）。
 *
 * 覆盖：变量监视表、跳转/快进/求值三个交互面、评估日志三态、
 * 「不可回滚」提示、空态、非法输入拒绝。
 */

const WATCH = [
  { label: 'attr.insight', value: '8' },
  { label: 'wallet.town_silver', value: '24' },
];
const EVENTS = [
  { seq: 0, type: 'check_result', detail: 'coc normal success roll=37' },
  { seq: 1, type: 'trade', detail: 'buy warm_bun ×1 = 9' },
];

describe('25B-Q3 DebugPanel', () => {
  it('渲染标题 + 不可回滚提示 + 变量监视表', () => {
    render(<DebugPanel watch={WATCH} events={[]} />);
    expect(screen.getByLabelText('调试面板')).toBeDefined();
    expect(screen.getByText(/此操作不可回滚/)).toBeDefined();
    expect(screen.getByText('attr.insight')).toBeDefined();
    expect(screen.getByText('24')).toBeDefined();
  });

  it('变量为空：显示空态', () => {
    render(<DebugPanel watch={[]} events={[]} />);
    expect(screen.getAllByText('（暂无）').length).toBeGreaterThanOrEqual(1);
  });

  it('跳转：提交表单回调场景 id；空输入不触发', () => {
    const onJump = vi.fn();
    render(<DebugPanel watch={[]} events={[]} onJump={onJump} />);
    const input = screen.getByPlaceholderText('场景 id') as HTMLInputElement;
    const form = input.closest('form') as HTMLFormElement;
    input.value = 'hillside_quarry';
    form.requestSubmit();
    expect(onJump).toHaveBeenCalledWith('hillside_quarry');

    input.value = '   ';
    form.requestSubmit();
    expect(onJump).toHaveBeenCalledTimes(1); // 空输入不触发
  });

  it('时间快进：正整数触发；0 / 负数 / 小数不触发', () => {
    const onTimeWarp = vi.fn();
    const { container } = render(<DebugPanel watch={[]} events={[]} onTimeWarp={onTimeWarp} />);
    const form = container.querySelectorAll('form')[1] as HTMLFormElement;
    const input = form.elements.namedItem('slots') as HTMLInputElement;

    input.value = '4';
    form.requestSubmit();
    expect(onTimeWarp).toHaveBeenCalledWith(4);

    for (const bad of ['0', '-2', '1.5', '']) {
      input.value = bad;
      form.requestSubmit();
    }
    expect(onTimeWarp).toHaveBeenCalledTimes(1);
  });

  it('表达式控制台：提交回调 + 结果受控显示（未求值 / 有结果两态）', () => {
    const onEvaluate = vi.fn();
    const { unmount } = render(
      <DebugPanel watch={[]} events={[]} onEvaluate={onEvaluate} lastEval={null} />,
    );
    const input = screen.getByPlaceholderText('如 attr.insight + 1') as HTMLInputElement;
    const form = input.closest('form') as HTMLFormElement;
    input.value = 'attr.insight + 1';
    form.requestSubmit();
    expect(onEvaluate).toHaveBeenCalledWith('attr.insight + 1');
    expect(screen.getByText('（无结果）')).toBeDefined();
    unmount();

    render(
      <DebugPanel watch={[]} events={[]} lastEval={{ source: 'attr.insight + 1', result: '9' }} />,
    );
    expect(screen.getByText('> attr.insight + 1 ⇒ 9')).toBeDefined();
  });

  it('评估日志：条目渲染 / 空态', () => {
    const { unmount } = render(<DebugPanel watch={[]} events={EVENTS} />);
    expect(screen.getByText('[check_result] coc normal success roll=37')).toBeDefined();
    expect(screen.getByText('[trade] buy warm_bun ×1 = 9')).toBeDefined();
    unmount();

    render(<DebugPanel watch={[]} events={[]} />);
    // 变量区与日志区各有空态
    expect(screen.getAllByText('（暂无）')).toHaveLength(2);
  });
});
