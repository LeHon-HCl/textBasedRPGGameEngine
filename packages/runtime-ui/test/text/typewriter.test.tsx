import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { vi } from 'vitest';
import {
  sliceRichTextNodes,
  typewriterIntervalMs,
  TypewriterText,
  useTypewriter,
  usePrefersReducedMotion,
} from '../../src/text/index.js';

/**
 * 25 任务 4：打字机效果（设计 §6.1 / FR-READ-05 / NFR-26）。
 *
 * 三条硬约束：
 * 1. **不重排渲染结果**——展示层只按字符预算裁剪节点树，节点结构与顺序
 *    与完整渲染一致（同一棵树的前缀），绝不重新分段或重新排序；
 * 2. **prefers-reduced-motion 自动关闭**（NFR-26）：命中时一次性全显；
 * 3. 速度可调（FR-READ-05 排版设置），速度 0/关闭时立即全显。
 */

describe('sliceRichTextNodes：字符预算裁剪（不重排的前提）', () => {
  const nodes = [
    { kind: 'text' as const, text: 'abc' },
    {
      kind: 'element' as const,
      tag: 'b',
      children: [{ kind: 'text' as const, text: 'def' }],
    },
    { kind: 'text' as const, text: 'ghi' },
  ];

  it('预算覆盖全部字符时返回原树（引用不变，避免无效重渲染）', () => {
    expect(sliceRichTextNodes(nodes, 9)).toBe(nodes);
    expect(sliceRichTextNodes(nodes, 100)).toBe(nodes);
  });

  it('预算为 0 时返回空数组', () => {
    expect(sliceRichTextNodes(nodes, 0)).toEqual([]);
  });

  it('预算落在文本节点中间：按前缀截断', () => {
    expect(sliceRichTextNodes(nodes, 2)).toEqual([{ kind: 'text', text: 'ab' }]);
    expect(sliceRichTextNodes(nodes, 4)).toEqual([
      { kind: 'text', text: 'abc' },
      { kind: 'element', tag: 'b', children: [{ kind: 'text', text: 'd' }] },
    ]);
  });

  it('预算恰好落在节点边界：不产生空节点', () => {
    expect(sliceRichTextNodes(nodes, 3)).toEqual([{ kind: 'text', text: 'abc' }]);
    expect(sliceRichTextNodes(nodes, 6)).toEqual([
      { kind: 'text', text: 'abc' },
      { kind: 'element', tag: 'b', children: [{ kind: 'text', text: 'def' }] },
    ]);
  });

  it('保留原节点顺序（展示层不重排）', () => {
    const sliced = sliceRichTextNodes(nodes, 8);
    expect(sliced.map((node) => node.kind)).toEqual(['text', 'element', 'text']);
  });
});

describe('typewriterIntervalMs：速度 → 间隔', () => {
  it('速度越高间隔越短；缺省速度给确定值', () => {
    const slow = typewriterIntervalMs(1);
    const fast = typewriterIntervalMs(2);
    expect(fast).toBeLessThan(slow);
    expect(typewriterIntervalMs(1)).toBe(40);
  });

  it('速度 ≤0 视为关闭（间隔 0 表示无需定时器）', () => {
    expect(typewriterIntervalMs(0)).toBe(0);
    expect(typewriterIntervalMs(-1)).toBe(0);
  });
});

describe('usePrefersReducedMotion：NFR-26 探测', () => {
  /** 以 matchMedia 桩渲染探针，返回 hook 的当前值（每个用例自装自卸） */
  function probeReducedMotion(matches: boolean): boolean {
    const original = window.matchMedia;
    const listeners = new Set<() => void>();
    window.matchMedia = ((query: string) => ({
      matches: matches && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      addListener: (cb: () => void) => listeners.add(cb),
      removeListener: (cb: () => void) => listeners.delete(cb),
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    let observed = false;
    function Probe(): React.ReactNode {
      observed = usePrefersReducedMotion();
      return <span data-testid="probe">{String(observed)}</span>;
    }
    try {
      render(<Probe />);
      return observed;
    } finally {
      window.matchMedia = original;
    }
  }

  it('命中 prefers-reduced-motion: reduce 时返回 true', () => {
    expect(probeReducedMotion(true)).toBe(true);
  });

  it('未命中时返回 false', () => {
    expect(probeReducedMotion(false)).toBe(false);
  });

  it('matchMedia 缺失（Node / 老宿主）时返回 false，不抛错', () => {
    const original = window.matchMedia;
    // @ts-expect-error 故意的环境桩：模拟不支持 matchMedia 的宿主
    window.matchMedia = undefined;
    try {
      expect(() => render(<ProbeMissing />)).not.toThrow();
    } finally {
      window.matchMedia = original;
    }
  });
});

/** matchMedia 缺失场景的探针（与上面 probeReducedMotion 同构，但无桩） */
function ProbeMissing(): React.ReactNode {
  const reduced = usePrefersReducedMotion();
  return <span data-testid="probe">{String(reduced)}</span>;
}

describe('useTypewriter：推进与暂停', () => {
  it('按间隔逐字揭示，达到全长后停下', () => {
    vi.useFakeTimers();
    try {
      let count = -1;
      function Probe(): React.ReactNode {
        count = useTypewriter('abcd', { speed: 1, enabled: true });
        return <span data-testid="n">{count}</span>;
      }
      render(<Probe />);
      expect(screen.getByTestId('n').textContent).toBe('0');
      act(() => {
        vi.advanceTimersByTime(40);
      });
      expect(screen.getByTestId('n').textContent).toBe('1');
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(screen.getByTestId('n').textContent).toBe('4');
      // 已到全长：继续走时不再变化（定时器已清）
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(screen.getByTestId('n').textContent).toBe('4');
    } finally {
      vi.useRealTimers();
    }
  });

  it('enabled=false（reduced-motion 或关闭打字机）时一次性全显', () => {
    let count = -1;
    function Probe(): React.ReactNode {
      count = useTypewriter('abcd', { speed: 1, enabled: false });
      return <span data-testid="n">{count}</span>;
    }
    render(<Probe />);
    expect(count).toBe(4);
  });

  it('文本变更时重置为 0 并重新推进（段落推进的语义）', () => {
    vi.useFakeTimers();
    try {
      function Probe({ text }: { text: string }): React.ReactNode {
        const count = useTypewriter(text, { speed: 1, enabled: true });
        return <span data-testid="n">{count}</span>;
      }
      const { rerender } = render(<Probe text="ab" />);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByTestId('n').textContent).toBe('2');
      rerender(<Probe text="wxyz" />);
      expect(screen.getByTestId('n').textContent).toBe('0');
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(screen.getByTestId('n').textContent).toBe('2');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TypewriterText：展示层不重排渲染结果（FR-READ-05）', () => {
  it('完整揭示后与 RichText 同构（同样式文本内容）', () => {
    const { container } = render(
      <TypewriterText text="你感到<b>疲惫</b>。" enabled={false} speed={1} />,
    );
    expect(container.querySelector('b')?.textContent).toBe('疲惫');
    expect(container.textContent).toBe('你感到疲惫。');
  });

  it('揭示中保持节点顺序与层级（前缀语义，不重新分段）', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<TypewriterText text="你感到<b>疲惫</b>。" enabled speed={1} />);
      act(() => {
        vi.advanceTimersByTime(120); // 3 字：'你感到'
      });
      expect(container.textContent).toBe('你感到');
      act(() => {
        vi.advanceTimersByTime(80); // 5 字：进入 <b>
      });
      expect(container.textContent).toBe('你感到疲惫');
      expect(container.querySelector('b')?.textContent).toBe('疲惫');
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(container.textContent).toBe('你感到疲惫。');
    } finally {
      vi.useRealTimers();
    }
  });

  it('同一样式类名与容器标签透传（排版设置的作用面）', () => {
    const { container } = render(
      <TypewriterText text="x" enabled={false} speed={1} as="p" className="narrative" />,
    );
    expect(container.querySelector('p.narrative')).not.toBeNull();
  });
});
