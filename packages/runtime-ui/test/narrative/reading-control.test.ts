import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { isSceneRead, useReadingControl } from '../../src/narrative/reading-control.js';

/**
 * A1 测试（25 号 B 组）：已读跳过 + 自动播放（FR-READ-01/02）。
 *
 * 覆盖：跳过开关、一次性跳过（段落推进后失效）、自动播放计时、
 * **遇选项/判定/战斗暂停**（相位非 await_advance 时不计时）。
 */

describe('25B-A1 已读判定（FR-READ-01）', () => {
  it('seen.scenes 命中即已读', () => {
    expect(isSceneRead('arrival', ['arrival', 'market_street'])).toBe(true);
    expect(isSceneRead('town_gate', ['arrival'])).toBe(false);
    expect(isSceneRead('arrival', [])).toBe(false);
  });
});

describe('25B-A1 跳过控制', () => {
  it('skipEnabled 开关：切换后 revealInstantly 为真', () => {
    const { result } = renderHook(() => useReadingControl({ segmentKey: 's1' }));
    expect(result.current.revealInstantly).toBe(false);
    act(() => result.current.toggleSkip());
    expect(result.current.skipEnabled).toBe(true);
    expect(result.current.revealInstantly).toBe(true);
    act(() => result.current.toggleSkip());
    expect(result.current.revealInstantly).toBe(false);
  });

  it('一次性跳过：仅对当前段落生效（段落推进后自动失效）', () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useReadingControl({ segmentKey: key }),
      { initialProps: { key: 'seg-1' } },
    );
    act(() => result.current.skipCurrent());
    expect(result.current.revealInstantly).toBe(true);
    // 段落推进：新 segmentKey → 一次性跳过失效
    rerender({ key: 'seg-2' });
    expect(result.current.revealInstantly).toBe(false);
    expect(result.current.skipEnabled).toBe(false); // 开关状态不受影响
  });
});

describe('25B-A1 自动播放（FR-READ-02）', () => {
  it('await_advance 相位计时到点自动推进', () => {
    vi.useFakeTimers();
    try {
      const onAdvance = vi.fn();
      const { result } = renderHook(() =>
        useReadingControl({ autoDelayMs: 1000, phase: 'await_advance', onAdvance }),
      );
      act(() => result.current.toggleAuto());
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(onAdvance).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onAdvance).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('遇选项暂停：phase = await_choice 时不推进（FR-READ-02 安全边界）', () => {
    vi.useFakeTimers();
    try {
      const onAdvance = vi.fn();
      type Phase = NonNullable<Parameters<typeof useReadingControl>[0]>['phase'];
      const { result, rerender } = renderHook(
        ({ phase }: { phase: Phase }) => useReadingControl({ autoDelayMs: 500, phase, onAdvance }),
        { initialProps: { phase: 'await_advance' as Phase } },
      );
      act(() => result.current.toggleAuto());
      rerender({ phase: 'await_choice' }); // 段落推进到选项相位
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(onAdvance).not.toHaveBeenCalled(); // 选项相位不自动推进
      expect(result.current.autoActive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolving / finished 相位同样不推进（判定与终局的暂停面）', () => {
    vi.useFakeTimers();
    try {
      const onAdvance = vi.fn();
      const { result } = renderHook(() =>
        useReadingControl({ autoDelayMs: 100, phase: 'resolving', onAdvance }),
      );
      act(() => result.current.toggleAuto());
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(onAdvance).not.toHaveBeenCalled();
      expect(result.current.autoActive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('关闭自动播放后不再计时', () => {
    vi.useFakeTimers();
    try {
      const onAdvance = vi.fn();
      const { result } = renderHook(() =>
        useReadingControl({ autoDelayMs: 200, phase: 'await_advance', onAdvance }),
      );
      act(() => result.current.toggleAuto());
      act(() => result.current.toggleAuto()); // 立即关闭
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(onAdvance).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('delay ≤ 0：自动播放视为关闭（不设定时器）', () => {
    vi.useFakeTimers();
    try {
      const onAdvance = vi.fn();
      const { result } = renderHook(() =>
        useReadingControl({ autoDelayMs: 0, phase: 'await_advance', onAdvance }),
      );
      act(() => result.current.toggleAuto());
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(onAdvance).not.toHaveBeenCalled();
      expect(result.current.autoActive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
