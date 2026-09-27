import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createTextResolver } from '@game/engine';
import type { LocalePack } from '@game/engine';
import { OptionList, visibleChoices } from '../../src/narrative/index.js';
import type { OptionView } from '../../src/narrative/index.js';

/**
 * #4 回归防线：选项可见性收敛为单一来源（FR-CGRD-03 应用点 3）。
 *
 * 缺陷回顾（`docs/reviews/demo-issues-11.md` #4）：可见性规则被实现了两遍
 * ——`OptionList` 过滤掉 `hiddenByFilter` 项，宿主键盘路径却按**未过滤**的
 * `session.choices` 取下标。玩家按「第 1 项」时键盘拿到的是原始第 1 项，
 * 可能正是被 `show_if` 隐藏的那条，引擎随即正确拒绝并抛
 * `error.narrative.choiceFiltered`（表现为「屏幕第 1 项按下去报错」）。
 *
 * 本文件锁定三件事：
 * 1. `visibleChoices` 的过滤语义；
 * 2. **索引映射**：过滤后 index 0/1 指向玩家看到的第 1/2 项（#4 的直接防线）；
 * 3. `OptionList` 的渲染顺序与 `visibleChoices` 输出一致——两处口径若再漂移，
 *    漂移发生在组件侧时本用例会红（另一半漂移由宿主消费同一函数消除）。
 */

const LOCALES: Record<string, LocalePack> = {
  'zh-CN': {
    lang: 'zh-CN',
    keys: new Map<string, string>([
      ['choices.hidden_guard', '被 show_if 隐藏的打招呼（不见于屏幕）'],
      ['choices.greet', '向守卫打招呼'],
      ['choices.pass', '沉默通过'],
      ['choices.locked', '出示通行证'],
      ['choices.locked_reason', '还没拿到通行证'],
    ]),
  },
};

const resolver = createTextResolver({ mainLang: 'zh-CN', locales: LOCALES });

/**
 * 关键夹具：**隐藏项排在首位**——正是 town_gate 的形态（`greet_guard` 被
 * show_if 隐藏但占据原始下标 0）。若实现按未过滤下标取，index 0 会命中它。
 */
const CHOICES: readonly OptionView[] = [
  { id: 'hidden_greet', textKey: 'choices.hidden_guard', enabled: true, hiddenByFilter: true },
  { id: 'greet', textKey: 'choices.greet', enabled: true },
  {
    id: 'locked',
    textKey: 'choices.locked',
    enabled: false,
    disabledReasonKey: 'choices.locked_reason',
  },
  { id: 'pass', textKey: 'choices.pass', enabled: true },
];

describe('visibleChoices：选项可见性唯一口径（FR-CGRD-03 应用点 3）', () => {
  it('过滤 hiddenByFilter === true 的条目，保留其余（含置灰项）', () => {
    expect(visibleChoices(CHOICES).map((choice) => choice.id)).toEqual(['greet', 'locked', 'pass']);
  });

  it('hiddenByFilter 为 false/undefined 一律视为可见（只有显式 true 才隐藏）', () => {
    const mixed: readonly OptionView[] = [
      { id: 'a', textKey: 'choices.greet', enabled: true },
      { id: 'b', textKey: 'choices.pass', enabled: true, hiddenByFilter: false },
      { id: 'c', textKey: 'choices.locked', enabled: true, hiddenByFilter: true },
    ];
    expect(visibleChoices(mixed).map((choice) => choice.id)).toEqual(['a', 'b']);
  });

  it('返回新数组、保持相对次序与元素引用（调用方不可借此改写入参）', () => {
    const result = visibleChoices(CHOICES);
    expect(result).not.toBe(CHOICES);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(CHOICES[1]);
    expect(result[2]).toBe(CHOICES[3]);
    expect(CHOICES).toHaveLength(4);
  });

  it('空列表与全隐藏列表都退化为空（宿主不因空列表报错）', () => {
    expect(visibleChoices([])).toEqual([]);
    expect(
      visibleChoices([{ id: 'x', textKey: 'choices.pass', enabled: true, hiddenByFilter: true }]),
    ).toEqual([]);
  });

  it('索引映射：过滤后 index 0 → greet、index 1 → locked、index 2 → pass（#4 回归防线）', () => {
    const visible = visibleChoices(CHOICES);
    // 键盘层拿到的是这个可见列表的下标；若有人退回未过滤列表，下面三条会指向
    // hidden_greet / greet / locked——屏幕第 1 项与引擎第 1 项错位，即 #4 的复现
    expect(visible[0]?.id).toBe('greet');
    expect(visible[1]?.id).toBe('locked');
    expect(visible[2]?.id).toBe('pass');
    // 数字键 1/2 会被 useKeyboardShortcuts 映射为 index 0/1
    expect(visible[0]?.id).not.toBe(CHOICES[0]?.id);
    expect(visibleChoiceIdAt(CHOICES, 0)).toBe('greet');
    expect(visibleChoiceIdAt(CHOICES, 1)).toBe('locked');
  });

  it('过滤后越界的序号不产出选项（数字键上界与可见数量同源）', () => {
    const visible = visibleChoices(CHOICES);
    expect(visibleChoices(CHOICES).length).toBe(3);
    expect(visible[3]).toBeUndefined();
  });
});

describe('OptionList 与 visibleChoices 共用同一口径（防漂移）', () => {
  it('渲染的按钮顺序与 id 与 visibleChoices 输出逐项一致', () => {
    const { container } = render(
      <OptionList choices={CHOICES} resolver={resolver} lang="zh-CN" onChoice={vi.fn()} />,
    );
    const renderedIds = [...container.querySelectorAll('[data-choice]')].map((element) =>
      element.getAttribute('data-choice'),
    );
    expect(renderedIds).toEqual(visibleChoices(CHOICES).map((choice) => choice.id));
    // 隐藏项既不在渲染结果里，也不占序号位
    expect(renderedIds).toEqual(['greet', 'locked', 'pass']);
    expect(screen.queryByText('被 show_if 隐藏的打招呼（不见于屏幕）')).not.toBeInTheDocument();
  });

  it('点击屏幕第 1 个按钮回调的是可见列表 index 0 的 id（键盘同一映射）', async () => {
    const user = userEvent.setup();
    const onChoice = vi.fn();
    const { container } = render(
      <OptionList choices={CHOICES} resolver={resolver} lang="zh-CN" onChoice={onChoice} />,
    );
    const first = container.querySelectorAll('[data-choice]')[0];
    expect(first).toBeDefined();
    await user.click(first as Element);
    expect(onChoice).toHaveBeenCalledTimes(1);
    expect(onChoice).toHaveBeenCalledWith(visibleChoices(CHOICES)[0]?.id);
    expect(onChoice).toHaveBeenCalledWith('greet');
  });

  it('全隐藏时容器不产出任何按钮（渲染与可见数同步归零）', () => {
    const { container } = render(
      <OptionList
        choices={CHOICES.map((choice) => ({ ...choice, hiddenByFilter: true as const }))}
        resolver={resolver}
        lang="zh-CN"
        onChoice={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-choice]')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

/** 可见列表第 index 项（键盘路径的等价取值；与宿主 main.tsx 的写法同源） */
function visibleChoiceIdAt(choices: readonly OptionView[], index: number): string | undefined {
  return visibleChoices(choices)[index]?.id;
}
