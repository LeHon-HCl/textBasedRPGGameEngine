import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrivacyBanner } from '../../src/persistence/index.js';

/**
 * 25 任务 10：隐私模式降级横幅（NFR-10「频繁导出提醒，不静默丢档」）。
 *
 * 契约：常驻（不可关闭——关闭横幅等于默许丢档），文案含原因与行动指引；
 * 未降级时不渲染（零占位）。
 */

describe('PrivacyBanner：降级提示', () => {
  it('degraded=false 时不渲染（零占位）', () => {
    const { container } = render(<PrivacyBanner degraded={false} reason="x" />);
    expect(container.firstChild).toBeNull();
  });

  it('降级时展示原因与「请导出存档」指引', () => {
    render(<PrivacyBanner degraded reason="IndexedDB 被隐私模式禁用" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/IndexedDB 被隐私模式禁用/)).toBeInTheDocument();
    expect(screen.getByText(/导出存档/)).toBeInTheDocument();
  });

  it('常驻：不提供关闭按钮（关闭等同默许丢档）', () => {
    render(<PrivacyBanner degraded reason="x" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('无原因时给通用文案（不显示 undefined）', () => {
    render(<PrivacyBanner degraded />);
    expect(screen.getByRole('status')).toHaveTextContent(/浏览器存储不可用/);
    expect(screen.getByRole('status').textContent).not.toContain('undefined');
  });

  it('文案可注入（D4 边界）', () => {
    render(
      <PrivacyBanner
        degraded
        reason="quota"
        labels={{ message: '存储不可用：{reason}', action: '立即导出' }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('存储不可用：quota');
    expect(screen.getByRole('status')).toHaveTextContent('立即导出');
  });

  it('提供导出入口时渲染为按钮并回调（可选能力）', () => {
    render(<PrivacyBanner degraded reason="x" onExport={(() => undefined) as () => void} />);
    expect(screen.getByRole('button', { name: /导出/ })).toBeInTheDocument();
  });
});
