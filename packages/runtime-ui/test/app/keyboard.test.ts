import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { KEY_BINDING_DOCS, useKeyboardShortcuts } from '../../src/app/keyboard.js';

/**
 * A2 测试（25 号 B 组）：快捷键映射（FR-READ-06）。
 *
 * 覆盖：数字键选项（相位门控 + 上界）、Space/Enter 推进、H/S/L/R/Esc、
 * **输入焦点保护**（input/textarea/contentEditable）、修饰键保护、禁用开关。
 */

type Options = Parameters<typeof useKeyboardShortcuts>[0];

function makeKey(key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    target: { tagName: 'div' },
    preventDefault: () => undefined,
    ...overrides,
  } as unknown as KeyboardEvent;
}

/**
 * 取 hook 返回的 handleKey（经 renderHook 渲染，避免真实 DOM 事件派发）。
 * 用 handleKey 直接驱动：测试不依赖 window 监听与 preventDefault 时序。
 */
function handler(options: Options): (event: KeyboardEvent) => boolean {
  return renderHook(() => useKeyboardShortcuts(options)).result.current.handleKey;
}

describe('25B-A2 数字键选择选项', () => {
  it('await_choice 相位：1–9 触发对应下标', () => {
    const choose = vi.fn();
    const handle = handler({ phase: 'await_choice', choiceCount: 3, choose });
    expect(handle(makeKey('1'))).toBe(true);
    expect(choose).toHaveBeenLastCalledWith(0);
    handle(makeKey('3'));
    expect(choose).toHaveBeenLastCalledWith(2);
  });

  it('超出可选项数量：不触发', () => {
    const choose = vi.fn();
    const handle = handler({ phase: 'await_choice', choiceCount: 2, choose });
    expect(handle(makeKey('5'))).toBe(false);
    expect(choose).not.toHaveBeenCalled();
  });

  it('非 await_choice 相位：数字键不触发（推进/判定相位）', () => {
    const choose = vi.fn();
    const handle = handler({ phase: 'await_advance', choiceCount: 3, choose });
    expect(handle(makeKey('1'))).toBe(false);
    expect(choose).not.toHaveBeenCalled();
  });
});

describe('25B-A2 推进与功能键', () => {
  it('Space / Enter 在 await_advance 触发推进；其他相位不触发', () => {
    const advance = vi.fn();
    const handle = handler({ phase: 'await_advance', advance });
    expect(handle(makeKey(' '))).toBe(true);
    expect(handle(makeKey('Enter'))).toBe(true);
    expect(advance).toHaveBeenCalledTimes(2);

    const handleChoicePhase = handler({ phase: 'await_choice', advance });
    expect(handleChoicePhase(makeKey(' '))).toBe(false);
  });

  it('H / S / L / R / Esc 各自触发对应回调（大小写均可）', () => {
    const toggleHistory = vi.fn();
    const quickSave = vi.fn();
    const quickLoad = vi.fn();
    const rollback = vi.fn();
    const closePanel = vi.fn();
    const handle = handler({ toggleHistory, quickSave, quickLoad, rollback, closePanel });
    handle(makeKey('h'));
    handle(makeKey('S'));
    handle(makeKey('l'));
    handle(makeKey('R'));
    handle(makeKey('Escape'));
    expect(toggleHistory).toHaveBeenCalledTimes(1);
    expect(quickSave).toHaveBeenCalledTimes(1);
    expect(quickLoad).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(closePanel).toHaveBeenCalledTimes(1);
  });

  it('未提供的动作不响应（不 preventDefault）', () => {
    const handle = handler({});
    expect(handle(makeKey('h'))).toBe(false);
    expect(handle(makeKey('Escape'))).toBe(false);
  });
});

describe('25B-A2 保护规则', () => {
  it('输入焦点保护：input/textarea/select/contentEditable 不响应', () => {
    const advance = vi.fn();
    const handle = handler({ phase: 'await_advance', advance });
    for (const target of [
      { tagName: 'INPUT' },
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
    ]) {
      expect(
        handle(makeKey(' ', { target: target as unknown as EventTarget })),
        String(target.tagName),
      ).toBe(false);
    }
    expect(advance).not.toHaveBeenCalled();
    // 普通元素仍响应
    expect(handle(makeKey(' ', { target: { tagName: 'DIV' } as unknown as EventTarget }))).toBe(
      true,
    );
  });

  it('修饰键保护：Ctrl/Alt/Meta 组合不响应', () => {
    const choose = vi.fn();
    const handle = handler({ phase: 'await_choice', choiceCount: 3, choose });
    expect(handle(makeKey('1', { ctrlKey: true }))).toBe(false);
    expect(handle(makeKey('1', { altKey: true }))).toBe(false);
    expect(handle(makeKey('1', { metaKey: true }))).toBe(false);
    expect(choose).not.toHaveBeenCalled();
  });

  it('enabled=false：全部不响应', () => {
    const advance = vi.fn();
    const handle = handler({ enabled: false, phase: 'await_advance', advance });
    expect(handle(makeKey(' '))).toBe(false);
    expect(advance).not.toHaveBeenCalled();
  });

  it('未知按键不响应', () => {
    const handle = handler({ phase: 'await_choice', choiceCount: 3, choose: vi.fn() });
    expect(handle(makeKey('q'))).toBe(false);
    expect(handle(makeKey('F5'))).toBe(false);
  });
});

describe('25B-A2 键位文档（设置页说明的数据源）', () => {
  it('七个键位条目齐备且与实现同源', () => {
    expect(KEY_BINDING_DOCS.map((entry) => entry.keys)).toEqual([
      '1-9',
      'Space / Enter',
      'H',
      'S',
      'L',
      'R',
      'Esc',
    ]);
    for (const entry of KEY_BINDING_DOCS) {
      expect(entry.descKey.startsWith('settings.keys.')).toBe(true);
    }
  });
});
