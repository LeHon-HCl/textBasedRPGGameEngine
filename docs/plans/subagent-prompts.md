# 子 Agent 派发 prompt（即用）

> 配套：`docs/subagent-protocol.md`（协作与验收协议）、`docs/reviews/demo-issues-11.md`（问题清单，本文件所有任务的权威依据）。
> **本文件是「可直接复制派发」的 prompt 正文**；派发时把 `<...>` 占位替换为实际值，其余原文照发。
>
> **总批次（按人类裁定的顺序）**：
> 1. **批 1**：真 bug —— #4 / #8 / #9（含 #9b）
> 2. **批 2**：接线遗漏 —— #2 / #5 / #6 / #11
> 3. **批 3**：UX 与内容 + 开发者规范 —— #1 / #3 / #7 / #10

---

## 批 1 的并行分析（派发前必读）

| 包 | 覆盖 | 文件白名单 | 与其他包是否重叠 |
|---|---|---|---|
| **P1** | #4 键盘选择未过滤隐藏项 | `apps/player-demo/src/main.tsx`、`packages/runtime-ui/src/narrative/`（含新增 `choice-visibility.ts`）、`packages/runtime-ui/test/narrative/` | 否 |
| **P2** | #8 战斗起步死锁 + #9/#9b 回退历史 | `packages/runtime-ui/src/app/game-host.ts`、`packages/runtime-ui/src/panels/HistoryPanel.tsx`、`packages/runtime-ui/src/panels/history-projection.ts`、`packages/runtime-ui/test/panels/`、`packages/runtime-ui/test/acceptance/` | 否 |

**结论：P1 与 P2 文件白名单无交集，可同时派发。**
（注意：`docs/plans/subagent-prompts.md` 本身、`docs/reviews/demo-issues-11.md`、
`docs/plans/open-items.md`、`docs/tasks/progress.md` **均不在**任何子 Agent 的白名单内——
文档由主会话维护。）

---

## Prompt P1 —— #4 数字键选到隐藏选项

```text
你是实现 Agent，负责修复 demo 宿主页的键盘选择缺陷，完成后返回报告。

## 任务：修复数字键选到被隐藏选项的缺陷（#4），并把「选项可见性口径」收敛为单一来源

### 背景与目标
用户实测：在 town_gate 场景按数字键 1/2 选选项，屏幕出现红色错误卡片
`[INTERNAL] error.narrative.choiceFiltered (scene=town_gate, choice=greet_guard)`；
鼠标点击同一选项则正常。

**根因（已由主会话实读代码确认，不必重新排查）**：
宿主把**未过滤**的 `session.choices` 交给键盘层——
`apps/player-demo/src/main.tsx` 的 `choose: (index) => { const choice = session.choices[index]; ... }`。
而渲染层 `OptionList` 会先过滤隐藏项
（`packages/runtime-ui/src/narrative/NarrativeView.tsx` 约 180 行：
`const visible = choices.filter((choice) => choice.hiddenByFilter !== true)`）。
两者索引口径不一致 → 玩家按「第 1 项」时键盘取到的是过滤前的第 1 项，
可能正是被 showIf 隐藏的选项。引擎随后正确拒绝（`SceneRunner.choose` 校验
`hiddenByFilter === true` 即抛 `choiceFiltered`）。

**引擎行为正确，这条报错恰恰证明过滤链在工作**——缺陷在「同一个可见性规则被实现了两遍」。

### 设计决定（已定，按此实施，不要改为其它方案）
把可见性口径**收敛为单一来源**：在 runtime-ui 的 narrative 切片新增并导出一个纯函数，
`OptionList` 与宿主键盘选择**都**经它取可见列表。
理由：只修 demo 会留下重复实现，下一个宿主会再踩一次；新函数放在 runtime-ui
才有测试（`apps/player-demo` 无测试基建设置）。

### 必读（按序）
1. `packages/runtime-ui/src/narrative/NarrativeView.tsx` 约 160–200 行（`OptionList` 的过滤与渲染）
2. `packages/runtime-ui/src/narrative/types.ts`（`OptionView` 定义，含 `hiddenByFilter`）
3. `apps/player-demo/src/main.tsx` 约 240–253 行（`useKeyboardShortcuts` 的 `choiceCount` 与 `choose`）
4. `packages/runtime-ui/src/app/keyboard.ts`（`useKeyboardShortcuts` 契约：`choose(index)`、`choiceCount`）
5. `packages/runtime-ui/test/narrative/narrative-view.test.tsx`（既有口径测试，第 56 行有 `hiddenByFilter: true` 夹具）

### 交付物
- [ ] 新增 `packages/runtime-ui/src/narrative/choice-visibility.ts`：
      导出 `visibleChoices(choices: readonly OptionView[]): readonly OptionView[]`
      ——实现即 `choices.filter((choice) => choice.hiddenByFilter !== true)`，
      带 JSDoc 说明「这是 FR-CGRD-03 应用点 3 的 UI 可见性唯一口径」
- [ ] `NarrativeView.tsx` 的 `OptionList` 改用该函数（行为不变，消除重复实现）
- [ ] `packages/runtime-ui/src/narrative/index.ts` 增补导出（含类型）
- [ ] `apps/player-demo/src/main.tsx`：
      · `choose` 回调改为 `const choice = visibleChoices(session.choices)[index];`
      · `choiceCount` 同步改为 `visibleChoices(session.choices).length`
- [ ] 测试：在 `packages/runtime-ui/test/narrative/` 下新增（或扩充既有）用例，至少覆盖：
      · `visibleChoices` 过滤 `hiddenByFilter === true` 的条目；
      · **索引映射用例（关键）**：`[hidden, visibleA, visibleB]` 经过滤后
        index 0 → `visibleA`、index 1 → `visibleB`（这条正是 #4 的回归防线）；
      · `OptionList` 渲染与 `visibleChoices` 输出一致（防止两处口径再度漂移）

### 硬约束
- **允许改动**：`apps/player-demo/src/main.tsx`、
  `packages/runtime-ui/src/narrative/NarrativeView.tsx`、
  `packages/runtime-ui/src/narrative/choice-visibility.ts`（新增）、
  `packages/runtime-ui/src/narrative/index.ts`、
  `packages/runtime-ui/test/narrative/**`
- **禁止改动**：`packages/runtime-ui/src/app/**`（尤其 `game-host.ts`）、
  `packages/runtime-ui/src/panels/**`、`packages/engine/**`、
  `docs/proposal.md`、`docs/detail-design.md`、其他任务文件、`docs/tasks/progress.md`、`scripts/`
- **不得新增公共导出面到 `packages/runtime-ui/src/index.ts` 之外**（此次只在 narrative 切片内导出）
- 提交粒度：一个 commit（`fix(runtime-ui,demo): 选项可见性口径收敛为单一来源（#4）`）
- **自测门禁**：`pnpm test` / `pnpm typecheck` / `pnpm lint` / `node scripts/validate-docs.mjs` 全绿

### 完成定义
- 「过滤后索引映射」用例存在且通过（#4 的回归防线）
- `OptionList` 与键盘路径**共用同一函数**（grep 确认不再有第二处 `hiddenByFilter !== true` 的过滤）
- 四门禁全绿

### 返回报告
按 `docs/subagent-protocol.md` §5 格式。不得贴代码正文。
```

---

## Prompt P2 —— #8 战斗行动按钮死锁 + #9/#9b 回退历史

```text
你是实现 Agent，负责修复战斗会话起步死锁与回退历史丢失两处宿主缺陷，完成后返回报告。

## 任务一：修复进入战斗后无行动按钮的死锁（#8）

### 背景与目标
用户实测：采石场点「打岩鼠」，战斗面板出现（敌方、血条、日志都在），但**没有任何行动按钮**，
只有一行「等待你的行动…」，战斗永久卡住。

**根因（已由主会话实读代码确认，不必重新排查）**：
`BattleSession` 构造后初始相位是 `turn_order`（八相位状态机第一相），
必须由宿主调 `beginTurn()` 才推进到 `await_player`；
而 `BattlePanel` 只在 `phase === 'await_player'` 时渲染按钮
（`packages/runtime-ui/src/panels/BattlePanel.tsx` 约 135 行：
`const canAct = props.phase === 'await_player' && !terminal;`），
`turn_order` 落进 else 只显示 `labels.awaiting`（面板约 252 行「等待你的行动…」）
——**这句提示是假的**，此时是在等宿主，不是等玩家。
宿主的 `game-host.ts` 只在收到玩家行动**之后**才调 `beginTurn()`
（约 818、833 行），但没有按钮就没人能发出第一次行动 → 死锁。

### 修复要求
宿主在战斗会话建立后**立即驱动起步**，直到「等玩家」或终局为止。

**必须注意的相位语义**（实读 `packages/engine/src/battle/session.ts` 约 149–181 行）：
`beginTurn()` 弹出队首：
- 玩家侧 → 返回 `await_player`（停，等玩家输入）；
- 敌方侧 → **内部完成 AI 决策与结算**，返回 `resolving`，且 `settleRoundEnd` 会把相位
  收敛到 `victory` / `defeat` / `escaped` / `turn_order`。
故「驱动到玩家可行动」需要一个**有界循环**：相位为 `turn_order` 时继续 `beginTurn()`，
直到相位为 `await_player` 或终局；**必须设迭代上限**（例如 100）防御异常数据导致的死循环，
超限时按宿主既有错误机制显性化（`lastError`），不得静默吞掉。

- [ ] `game-host.ts` 的战斗接线：`battle_start` 订阅建立控制器后，立即驱动到玩家可行动/终局
      （抽成一个内部函数，`battleAct` 的既有推进逻辑也复用它，避免两处相位驱动漂移）
- [ ] 终局分支要与既有 `battleAct` 的终局消费保持一致（`pollOutcome()` → 清控制器 → 关面板
      → `jumps` 经 `withSession(runner.applyFlowJumps(...))` 注回叙事）
- [ ] 测试（`packages/runtime-ui/test/acceptance/panel-wiring.test.ts` 扩充或同目录新增）：
      新增用例断言「点击进入战斗后，会话相位为 `await_player`（玩家可行动）」——
      **这是 #8 的回归防线**（既有用例只断言「会话建立 + 面板打开」，故漏掉了死锁）

## 任务二：修复「回退一步」历史被清空（#9）与历史面板步数口径（#9b）

### 背景与目标
用户实测：走了很多步后点「回退一步」，**历史面板从 7 组变成 1 组**、
画面回到入口场景，看起来像「全部回退了」。

**根因（已由主会话实测确认，不必重新排查）**：
`rollback(1)` 的**状态回退是精确的**（既有 `test/panels/history-rollback.test.ts` 8 例全绿，
其中「回退 1 步后状态 == 上一步」逐字段断言通过）。真正原因是：
- 回滚只还原 GameState，**叙事位置必须重开会话**（设计 §6.3 原文；M2 验收口径甲，
  见 `docs/plans/M2-stage5-qol-plan.md` §「关键设计点」1）——这是**已知且已裁定**的行为，**不要改**；
- 宿主重建 session 时用 `createRunnerSession(..., definition.manifest.entryScene)`
  （`game-host.ts` 约 765 行），而 `SceneRunner` 的**历史环形缓冲属于会话对象**，
  新会话历史为空 → 历史面板只剩入口场景 1 组。

即：口径甲原本承诺的补强措施（「历史回看面板提供回退前后的文本可追溯性」，
见计划 §1 第 1 点）**没有兑现**。

### 设计决定（已定，按此实施）
**历史缓冲不该随会话重建而丢弃，且回滚应把它截断到对应位置。** 全部在宿主侧完成，
**不改引擎**（`SceneRunner` 无历史播种 API，且引擎 `rollback` 语义正确）。

宿主维护两份并行数据：
1. `historyLog: NarrativeHistoryEntry[]`——跨会话重建累积的历史（每次 `syncSession` 时
   把当前会话 `history()` 中**尚未入账**的尾部条目追加进来）。跨会话的 `seq` 会重复，
   故累积时由宿主**重编号**（用宿主自己的单调递增计数器），保证投影的 `seq` 唯一且有序。
2. `rollbackMarks: number[]`——**每次打检查点的同一时刻**（`choose` 里调 `rt.checkpoint(label)` 处）
   记录当时的 `historyLog.length`。它与引擎的检查点栈**同长同序**：
   引擎栈超深丢最旧（`PERF_GUARD.checkpointStackDepth = 5`），故宿主也要 `shift()` 保持镜像。

**回滚时的截断口径**（务必按此实现，这里有 off-by-one 风险）：
引擎 `rollback(steps)` 弹出的是**最近的 steps 个**（最深的最先被弹出），
`popped[0]` 是最早的那个。对应地：
- 宿主弹出最近 `steps` 个 mark：`const popped = rollbackMarks.splice(len - steps, steps)`；
- 历史截断目标 = `popped[0]`（最早被回退到的那个检查点当时的 `historyLog.length`）；
- 若 `steps` 清空了 `rollbackMarks`（回到最初状态）→ 截断目标 = 0。

### 交付物
- [ ] `game-host.ts`：
      · 累积历史 `historyLog` + 重编号（`syncSession` 内并入新条目）；
      · `choose` 打检查点处同步记录 `rollbackMarks`（并镜像引擎的丢最旧行为）；
      · `rollback` 内按上述口径截断历史；
      · `history()` 投影改用累积历史（不再直接读 `session.history()`）；
      · `restore()`（读档）路径清空两份缓冲（与引擎清空快照栈同规，若该路径存在则一并处理；
        若宿主尚无读档入口，跳过此项并在报告中说明）
- [ ] `game-host.ts` 的 `history()`：为每个分组附带**回退步数**（见任务 #9b 的设计）
- [ ] `history-projection.ts`：`HistoryGroup` 增加可选字段
      `readonly rollbackSteps?: number`（additive，不破坏既有调用方）
- [ ] `HistoryPanel.tsx`：
      · 删除自算步数的逻辑（约 104 行 `const steps = lastIndex - index;`），
        改用 `group.rollbackSteps`；无该字段时**不渲染**回退按钮（宁可没有，也不给错按钮）
      · `canRollback` 由宿主传入（见下）
- [ ] `game-host.ts` 增加并暴露给 demo 的只读信息：当前可回退步数（供 `canRollback`）
- [ ] 测试（`packages/runtime-ui/test/panels/history-rollback.test.ts` 扩充）：
      · **#9 回归防线**：走 N 步 → `rollback(1)` → **历史仍在**（分组数不降为 1），
        且截断到「上一次选择之前」的位置（逐条断言首尾）；
      · 连续 `rollback(2)` 的截断位置正确（覆盖 off-by-one）；
      · 检查点为 0 时回滚报 `NO_CHECKPOINT` 且历史不变（既有行为）；
      · **#9b**：分组的 `rollbackSteps` 与真实可用步数一致——
        断言「按该步数回滚后，状态等于该组开始时的状态」

### 硬约束
- **允许改动**：`packages/runtime-ui/src/app/game-host.ts`、
  `packages/runtime-ui/src/panels/HistoryPanel.tsx`、
  `packages/runtime-ui/src/panels/history-projection.ts`、
  `packages/runtime-ui/test/panels/**`、`packages/runtime-ui/test/acceptance/**`
- **禁止改动**：`apps/**`（demo 由 P1 负责；若你判断某处必须改 demo，
  返回 `SPEC_CONFLICT` 说明需要主会话裁定什么）、`packages/engine/**`、
  `packages/runtime-ui/src/narrative/**`（P1 的文件）、
  `docs/proposal.md`、`docs/detail-design.md`、其他任务文件、`docs/tasks/progress.md`、`scripts/`
- **必须保持通过**：`test/panels/history-rollback.test.ts` 现有的
  「回滚 5 步状态一致」用例（M2 验收标准第 4 条）与「叙事会话重建到入口场景」用例
- 提交粒度：两个 commit——`fix(runtime-ui): 战斗会话起步驱动（#8）`、
  `fix(runtime-ui): 回退历史保留与截断 + 历史面板步数口径（#9/#9b）`
- **自测门禁**：`pnpm test` / `pnpm typecheck` / `pnpm lint` / `node scripts/validate-docs.mjs` 全绿

### 完成定义
- #8：新增用例断言进入战斗后相位为 `await_player` 且通过
- #9：新增用例断言「回退一步后历史仍在且截断位置正确」且通过；既有 8 例仍绿
- #9b：分组的回退步数与真实状态一致（有断言）
- 四门禁全绿

### 返回报告
按 `docs/subagent-protocol.md` §5 格式。
**若任一任务无法在白名单内完成**（例如 `HistoryGroup` 的变更牵动 P1 的文件），
返回 `SPEC_CONFLICT` 并说明，不要越界改动。
```

---

## 批 2（待批 1 验收后派发）：接线遗漏 #2 / #5 / #6 / #11

> 派发前需重新核算文件白名单（批 1 合入后行号会漂移）。初步方案：

| 包 | 覆盖 | 文件白名单（初步） | 备注 |
|---|---|---|---|
| **P3** | #2 跳过开关 + #6① 商店文案 | `apps/player-demo/src/main.tsx` | demo 单文件 |
| **P4** | #5 历史文本物化 | `packages/runtime-ui/src/app/game-host.ts` | 与 P3 不重叠 ✅ |
| **P5** | #6②③ 价格标注 + 卖按钮禁用 | `packages/runtime-ui/src/panels/ShopPanel.tsx`、`packages/runtime-ui/src/app/panel-wiring.ts`、对应测试 | 与 P3/P4 不重叠 ✅ |
| **P6** | #11 存读档入口 | `apps/player-demo/src/main.tsx` + 可能宿主 save API | **与 P3 同文件、与 P4 同文件 → 必须串行** |

**结论**：P3 ∥ P4 ∥ P5 可并行；**P6 单独串行**（它是四批里工作量最大的一项，
涉及存档槽位 UI + 读档后宿主重建，建议独立成一轮）。

---

## 批 3（待批 2 验收后）：UX 与内容 + 开发者规范 #1 / #3 / #7 / #10

批 3 的特点是**多数条目要先改规范再落实现**（约束 2：权威文档修订须人类点头）。
故批 3 分两段走：

**第 1 段：规范修订提案（主会话产出，交人类审查）**
提案内容见 `docs/plans/develop-revision-proposal.md`（含develop.md 修订条款、检查层口径原则、
i18n 键面归属）。**人类点头后**才动笔修订文档。

**第 2 段：实现派发**（规范定稿后）

| 包 | 覆盖 | 文件白名单（初步） |
|---|---|---|
| **P7** | #1 成就面板关闭 + #3 错误框 | `packages/runtime-ui/src/panels/AchievementGalleryPanel.tsx`、`apps/player-demo/src/main.tsx`、`packages/runtime-ui/src/app/game-host.ts`（`clearError`） |
| **P8** | #7 内容前置收紧 | `fixtures/mini-game/data/scenes/old_town/town_gate.yaml`、`packages/runtime-ui/test/acceptance/route-choices.test.ts`（setup 同步） |
| **P9** | #10 i18n 边界（demo 文案提键 + 引擎基础词典） | 视规范定稿的归属结论而定 |

**P7 与 P8 不重叠，可并行**；P9 视 P7 结果（同文件 `main.tsx`）决定串行或合并。

---

## 使用说明（主会话执行）

1. **派发**：用 `Agent` 工具，`subagent_type: general-purpose`，`prompt` 填上述正文（替换占位符）；
2. **验收**：按 `docs/subagent-protocol.md` §6 六项协议（重跑门禁 / 一致性 / 抽查 / 红线 / 范围 / 玩家视角）；
   本次特别加一条：**检查子 Agent 是否引入了第二处可见性过滤**（#4 的根因是重复实现，不能只挪位置）；
3. **合入**：按约束 9 的 PR 合并规程（显式 PR 号 + CI 绿 + 合后同步 main）；
4. **回填**：合入后把 `docs/reviews/demo-issues-11.md` 对应条目状态改为「已修（PR #N）」，
   `docs/plans/open-items.md` 的 L-1 表同步勾除。
