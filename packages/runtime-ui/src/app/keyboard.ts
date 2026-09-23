import { useCallback, useEffect } from 'react';

/**
 * 快捷键映射（设计 §6.4 / FR-READ-06，25 号 A2）。
 *
 * 键位（与设置页说明同源——`KEY_BINDING_DOCS` 是唯一事实源）：
 * - `1`–`9`：选择对应序号的选项（await_choice 相位有效）；
 * - `Space` / `Enter`：推进段落（await_advance 相位有效）；
 * - `H`：切换历史回看；
 * - `S` / `L`：快速存档 / 快速读档（FR-SAVE-04）；
 * - `R`：回退一步（FR-READ-03；与回滚按钮同语义）；
 * - `Esc`：关闭当前面板。
 *
 * 安全性（关键实现约束）：
 * - **输入焦点保护**：焦点在 input/textarea/select/contentEditable 时不响应
 *   （否则玩家在设置面板输入框打字会误触发）；
 * - **修饰键保护**：按住 Ctrl/Alt/Meta 时不响应（避免与浏览器快捷键冲突）；
 * - **相位门控**：选项键只在 `await_choice`、推进键只在 `await_advance` 生效；
 * - `preventDefault` 仅对确实处理的按键调用（不劫持其他组合）。
 */

/** 快捷键动作名（宿主提供对应回调；未提供的动作不响应） */
export interface KeyActionHandlers {
  /** 推进段落（Space/Enter） */
  readonly advance?: () => void;
  /** 选择选项（1–9：下标 0–8） */
  readonly choose?: (index: number) => void;
  /** 切换历史面板（H） */
  readonly toggleHistory?: () => void;
  /** 快速存档 / 快速读档（S/L） */
  readonly quickSave?: () => void;
  readonly quickLoad?: () => void;
  /** 回退一步（R） */
  readonly rollback?: () => void;
  /** 关闭当前面板（Esc） */
  readonly closePanel?: () => void;
}

export interface KeyboardShortcutsOptions extends KeyActionHandlers {
  /** 当前相位（门控选项键与推进键） */
  readonly phase?: 'entering' | 'await_advance' | 'await_choice' | 'resolving' | 'finished';
  /** 当前可选项数量（1–9 键的上界） */
  readonly choiceCount?: number;
  /** 是否启用（缺省 true；如首启向导/主菜单可关闭） */
  readonly enabled?: boolean;
}

/** 键位文档（设置页「快捷键说明」的数据源；与实现同文件保证不漂移） */
export const KEY_BINDING_DOCS: readonly { readonly keys: string; readonly descKey: string }[] = [
  { keys: '1-9', descKey: 'settings.keys.choose' },
  { keys: 'Space / Enter', descKey: 'settings.keys.advance' },
  { keys: 'H', descKey: 'settings.keys.history' },
  { keys: 'S', descKey: 'settings.keys.quickSave' },
  { keys: 'L', descKey: 'settings.keys.quickLoad' },
  { keys: 'R', descKey: 'settings.keys.rollback' },
  { keys: 'Esc', descKey: 'settings.keys.closePanel' },
];

/** 焦点在可输入元素上（不响应快捷键） */
function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false;
  const element = target as { tagName?: string; isContentEditable?: boolean };
  const tag = element.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return element.isContentEditable === true;
}

/**
 * 快捷键监听 hook（挂到 window；卸载时移除）。
 *
 * 返回 `handleKey`（供测试直接驱动，避免依赖真实 DOM 事件派发）。
 */
export function useKeyboardShortcuts(options: KeyboardShortcutsOptions): {
  handleKey: (event: KeyboardEvent) => boolean;
} {
  const enabled = options.enabled ?? true;
  const phase = options.phase;

  const handleKey = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!enabled) return false;
      // 修饰键保护：带修饰键一律不处理（浏览器/系统快捷键优先）
      if (event.ctrlKey || event.altKey || event.metaKey) return false;
      if (isEditableTarget(event.target)) return false;

      // 数字键：选项（仅 await_choice 且序号在范围内）
      if (/^[1-9]$/.test(event.key)) {
        if (phase !== 'await_choice' || options.choose === undefined) return false;
        const index = Number(event.key) - 1;
        if (index >= (options.choiceCount ?? 0)) return false;
        options.choose(index);
        return true;
      }

      switch (event.key) {
        case ' ':
        case 'Enter':
          if (phase !== 'await_advance' || options.advance === undefined) return false;
          options.advance();
          return true;
        case 'Escape':
          if (options.closePanel === undefined) return false;
          options.closePanel();
          return true;
        case 'h':
        case 'H':
          if (options.toggleHistory === undefined) return false;
          options.toggleHistory();
          return true;
        case 's':
        case 'S':
          if (options.quickSave === undefined) return false;
          options.quickSave();
          return true;
        case 'l':
        case 'L':
          if (options.quickLoad === undefined) return false;
          options.quickLoad();
          return true;
        case 'r':
        case 'R':
          if (options.rollback === undefined) return false;
          options.rollback();
          return true;
        default:
          return false;
      }
    },
    [enabled, phase, options],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const listener = (event: KeyboardEvent): void => {
      if (handleKey(event)) event.preventDefault();
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
    };
  }, [enabled, handleKey]);

  return { handleKey };
}
