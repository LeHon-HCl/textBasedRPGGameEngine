import type { OptionView } from './types.js';

/**
 * 选项可见性口径（FR-CGRD-03 应用点 3 的 UI 侧唯一实现点；2026-09-27 收敛）。
 *
 * 为什么单独成文件：这条规则**同时**决定「渲染哪些按钮」与「数字键第 N 项对应谁」。
 * 曾经被实现了两遍（{@link OptionList} 内联过滤 / 宿主键盘路径按未过滤索引取），
 * 二者索引错位即出现「屏幕上第 1 项按不动、却报 error.narrative.choiceFiltered」
 * 这类最难归因的缺陷（`docs/reviews/demo-issues-11.md` #4）。
 *
 * 使用约束（develop.md 约束 6「同一业务规则只允许一处实现」）：
 * - 任何消费选项列表的代码（渲染、键盘/手势索引、宿主选择分发）都**必须**经本函数，
 *   不得再写 `choices.filter((choice) => choice.hiddenByFilter !== true)`；
 * - 入参是引擎投影的**未过滤**列表（`SessionView.choices` / `runner.choices()`），
 *   过滤职责只在这里发生。
 */

/**
 * 从引擎投影的选项列表中取出玩家可见的选项（顺序与相对次序保持不变）。
 *
 * 口径：`hiddenByFilter !== true` 即可见。`hiddenByFilter` 由引擎写入，来源有二：
 * `show_if` 不满足（FR-NARR-02）与选项内容标签命中内容过滤（FR-CGRD-02）——
 * 两者对 UI 的语义相同：**整个选项不存在**（不渲染、不可选、不占数字键序号）。
 * 因此索引必须建立在过滤后的列表上，否则键盘序号与屏幕序号会错位。
 *
 * @param choices 引擎投影的选项列表（含被过滤项）
 * @returns 可见选项（新数组；元素引用与入参相同）
 */
export function visibleChoices(choices: readonly OptionView[]): readonly OptionView[] {
  return choices.filter((choice) => choice.hiddenByFilter !== true);
}
