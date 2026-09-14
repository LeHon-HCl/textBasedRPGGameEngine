import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ToastStack } from '../../src/notifications/index.js';

/**
 * 25 任务 11：Toast 浮层渲染（设计 §6.4 末段 / FR-UI-07）。
 *
 * 契约：props 受控（队列由 store 提供）、自动消失经宿主定时器（组件只暴露
 * `onDismiss` 与 `onExpire` 回调）、`count > 1` 呈现「×N」、点击可手动关闭。
 */

describe('ToastStack：渲染与交互', () => {
  it('空队列不渲染（零占位）', () => {
    const { container } = render(
      <ToastStack items={[]} nameOf={(key) => key} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('队列按顺序渲染，文本键经 nameOf 物化', () => {
    render(
      <ToastStack
        items={[
          { id: 1, kind: 'achievement', textKey: 'achv.first', count: 1, at: 0 },
          { id: 2, kind: 'notify', textKey: 'ui.got_item', count: 1, at: 1 },
        ]}
        nameOf={(key) => `「${key}」`}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('「achv.first」')).toBeInTheDocument();
    expect(screen.getByText('「ui.got_item」')).toBeInTheDocument();
  });

  it('count > 1 呈现 ×N（合并策略的可视化）', () => {
    render(
      <ToastStack
        items={[{ id: 1, kind: 'notify', textKey: 'ui.got_item', count: 3, at: 0 }]}
        nameOf={(key) => key}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('×3')).toBeInTheDocument();
  });

  it('count = 1 不显示计数（避免视觉噪声)', () => {
    render(
      <ToastStack
        items={[{ id: 1, kind: 'notify', textKey: 'ui.got_item', count: 1, at: 0 }]}
        nameOf={(key) => key}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it('点击条目回调 onDismiss(id)（手动关闭）', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <ToastStack
        items={[{ id: 7, kind: 'system', textKey: 'ui.save_ok', count: 1, at: 0 }]}
        nameOf={(key) => key}
        onDismiss={onDismiss}
      />,
    );
    await user.click(screen.getByRole('button', { name: /ui\.save_ok/ }));
    expect(onDismiss).toHaveBeenCalledWith(7);
  });

  it('kind 作为 data-kind 标注（样式分支钩子）', () => {
    render(
      <ToastStack
        items={[
          { id: 1, kind: 'achievement', textKey: 'a', count: 1, at: 0 },
          { id: 2, kind: 'stat', textKey: 'b', count: 1, at: 1 },
        ]}
        nameOf={(key) => key}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^a/ })).toHaveAttribute('data-kind', 'achievement');
    expect(screen.getByRole('button', { name: /^b/ })).toHaveAttribute('data-kind', 'stat');
  });

  it('插值变量经 nameOf 第二参传递（文案含变量时由宿主物化）', () => {
    const nameOf = vi.fn((key: string) => `${key}:warm_bun`);
    render(
      <ToastStack
        items={[
          {
            id: 1,
            kind: 'item',
            textKey: 'ui.got_item',
            vars: { item: 'warm_bun' },
            count: 1,
            at: 0,
          },
        ]}
        nameOf={nameOf}
        onDismiss={vi.fn()}
      />,
    );
    expect(nameOf).toHaveBeenCalledWith('ui.got_item', { item: 'warm_bun' });
    expect(screen.getByText('ui.got_item:warm_bun')).toBeInTheDocument();
  });

  it('区域可访问性：role=status + aria-live（读屏播报新通知）', () => {
    const { container } = render(
      <ToastStack
        items={[{ id: 1, kind: 'notify', textKey: 'x', count: 1, at: 0 }]}
        nameOf={(key) => key}
        onDismiss={vi.fn()}
      />,
    );
    const region = container.querySelector('[aria-live]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('role', 'status');
  });
});
