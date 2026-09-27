# 子 Agent 派发 prompt（即用）

> 配套：`docs/subagent-protocol.md`（协作与验收协议）、`docs/reviews/demo-issues-11.md`（问题清单，本文件所有任务的权威依据）。
> **本文件是「可直接复制派发」的 prompt 正文**；派发时把 `<...>` 占位替换为实际值，其余原文照发。
>
> **总批次（按人类裁定的顺序）**：
> 1. **批 1**：真 bug —— #4 / #8 / #9（含 #9b/#9c）——**已完成并合入（PR #56 / #57）**，
>    真实浏览器复核通过（另抓出 #12，见 P2b）
> 2. **批 2**：接线遗漏 —— #2 / #5 / #6 / #11（前置：#12 修复）
> 3. **批 3**：UX 与内容 + 开发者规范 —— #1 / #3 / #7 / #10

---

## 派发前必读：硬性操作说明（每次派发都要附在 prompt 里）

以下四条是**每个**子 Agent 都必须遵守的开工程序（缺一即会踩坑）：

1. **先切分支**：`git checkout -b <type>/<slug>`（从最新 `main` 切出）。
   **禁止在 main 上提交**——仓库的 pre-commit 钩子会直接拦截
   （`docs/develop.md` 约束 9），绕过钩子（`--no-verify`）是违规行为。
2. **确认基线**：开工前 `git log --oneline -1` 记录基线 hash 并写进报告，
   便于主会话核对「改动是否基于最新 main」。
3. **只提交、不推送**：子 Agent 完成实现 + 自测后，**仅在本地分支提交**；
   `git push` 与 `gh pr create` 由**主会话在验收通过后**执行
   （协议 §2 第 4 步：验收通过才合入）。
4. **不动 `study/`**：仓库根有 `study/` 新目录（新人学习用），
   **不要读、不要改、不要引用**，也不要把它计入任何检查
   （`docs/develop.md` 约束 1 的例外说明）。

**批 1 的实操教训（2026-09-27，已验证的坑）**：

- **`study/` 提交会落到你的分支上**：批 1 的两个子 Agent 各自报告「有不属于我的
  `study/` 提交出现在我的分支」。原因是学习者在同一工作区独立 commit，
  时间上夹在子 Agent 切分支与提交之间，于是成了子 Agent 提交的**父提交**。
  **子 Agent 的正确做法**：不处理、不回滚，在报告中说明即可（批 1 两个 Agent 都做对了）；
  **主会话的正确做法**：把 `study/` 提交分离到独立分支保存（避免丢失学习者进度），
  再用 `git reset --hard <基线> && git cherry-pick <自己的提交>` 重建干净分支。
- **子 Agent 的提交序列不保证是线性的**：P2 的两个 commit 被 `study/` 提交隔开，
  重建时须**按序 cherry-pick 全部自己的 commit**，不能只 cherry-pick 最后一个。

---

## 批 1 的并行分析（派发前必读）

**结论：P1 与 P2 必须串行派发（同一工作区）**，尽管两者文件白名单不重叠。

| 包 | 覆盖 | 文件白名单 | 与其他包是否重叠 |
|---|---|---|---|
| **P1** | #4 键盘选择未过滤隐藏项 | `apps/player-demo/src/main.tsx`、`packages/runtime-ui/src/narrative/`、`packages/runtime-ui/test/narrative/` | 文件层面否 |
| **P2** | #8 战斗起步死锁 + #9/#9b/#9c 回退历史 | `packages/runtime-ui/src/app/game-host.ts`、`packages/runtime-ui/src/panels/History*`、`packages/runtime-ui/test/panels/`、`packages/runtime-ui/test/acceptance/` | 文件层面否 |

**为什么不能并行**（协议 §4 的隔离要求）：两个 Agent 在**同一个工作目录**，
而 git 工作树是共享的——两者各自 `git checkout -b` 会互相打断对方的分支与提交。
协议 §4 明确「一个工作区同时只有一个子 Agent 在写」。

**若要真并行**：需 `git worktree` 各开独立工作区 + 独立分支，
代价是每个 worktree 一次 `pnpm install`（约 195MB 依赖）。批 1 的两个包体量都不大，
**跑串行的总成本低于开 worktree**，故采用串行。

**串行顺序**：先 P1（改动面小、自包含、验证快），验收合入后再派 P2。

---

## Prompt P1 —— #4 数字键选到隐藏选项（**第一个派发**）

```text
你是实现 Agent，负责修复 demo 宿主页的键盘选择缺陷，完成后返回报告。

## 开工程序（先做，勿跳）
1. `git checkout -b fix/visible-choices-single-source`（从最新 main 切出）
2. `git log --oneline -1` 记录基线 hash，写进你的报告
3. **只在本地提交，不要 push、不要建 PR**（由主会话验收后代为推送）
4. 仓库根的 `study/` 目录与本次任务无关：不要读、不要改、不要引用

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

## Prompt P2 —— #8 战斗行动按钮死锁 + #9/#9b/#9c 回退历史（**P1 验收合入后派发**）

```text
你是实现 Agent，负责修复战斗会话起步死锁与回退历史丢失两处宿主缺陷，完成后返回报告。

## 开工程序（先做，勿跳）
1. `git checkout -b fix/battle-turn-start-and-rollback-history`（从最新 main 切出；
   注意：P1 已合入 main，务必先 `git checkout main && git pull` 再切分支）
2. `git log --oneline -1` 记录基线 hash，写进你的报告
3. **只在本地提交，不要 push、不要建 PR**（由主会话验收后代为推送）
4. 仓库根的 `study/` 目录与本次任务无关：不要读、不要改、不要引用

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
1. `historyLog: NarrativeHistoryEntry[]`——跨会话重建累积的历史。
   累积时机：每次 `syncSession()` 调用前（即状态推进后）把当前会话 `history()` 中
   **尚未入账的尾部**追加进来。
   - **关键：需要一个「本会话已入账条数」计数器**（如 `accumulatedInSession`），
     取 `session.history().slice(accumulatedInSession)` 追加，然后更新计数器。
     理由：`SceneRunner.history()` 的 `seq` 是**会话内**自增的——会话被替换后新会话
     从 seq 0 重新开始；若只按 `seq` 判断「是否已入账」，重建后会把新会话的条目录成
     已入账（丢历史）或重复入账。**会话被替换的任何位置都要把该计数器清零**
     （`rollback` 的重建处、`choose` 失败时的重建处）。
   - 累积时由宿主**重编号** `seq`（用宿主自己的单调递增计数器），保证投影的
     `seq` 唯一、有序且跨会话可比。
2. `rollbackMarks: number[]`——**每次打检查点的同一时刻**（`choose` 里调 `rt.checkpoint(label)` 处）
   记录当时的 `historyLog.length`。它与引擎的检查点栈**同长同序**：
   引擎栈超深丢最旧（`PERF_GUARD.checkpointStackDepth = 5`），故宿主也要 `shift()` 保持镜像。
   - 注意顺序：`historyLog` 的累积要先于记录 mark，否则 mark 会指向错误的截断点。

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

> **明确不做（勿顺手实现）**：`demo-issues-11.md` #9 提到的「回退后加一条 Toast 说明」
> （「已回退 1 步，画面回入口场景」）**不在本包范围**——它需要新的文本键，
> 属 #10「i18n 键面归属」的收尾范围（批 3）。**不要为此硬编码中文文案**，
> 否则会加剧 #10 的问题。本包只做「历史保留与截断」这件实事。
> 修好历史保留后，玩家点「回退一步」能直接看到历史仍在、只少了最后一点——
> 观感问题即已解决。

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

## Prompt P2b —— #12 战斗伤害恒为 0（**批 1 验收复核新发现，建议紧随批 1 派发**）

> **为什么插在批 2 之前**：#8 已让战斗「能操作」，但玩家打不动敌人 → **战斗仍不可完成**。
> 这条是「战斗可用」的最后一环，优先级高于批 2 的文案/入口类问题。

```text
你是实现 Agent，负责修复 demo 属性播种不完整导致战斗伤害恒为 0 的缺陷，完成后返回报告。

## 开工程序（先做，勿跳）
1. 先 `git checkout main && git pull`，再 `git checkout -b fix/demo-battle-attrs`
2. `git log --oneline -1` 记录基线 hash，写进你的报告
3. **只在本地提交，不要 push、不要建 PR**（由主会话验收后代为推送）
4. 仓库根的 `study/` 目录与本次任务无关：不要读、不要改、不要引用

## 任务：补齐 demo 的战斗属性播种（#12）

### 背景与目标
批 1 修好 #8 后，战斗面板的按钮已可见可点；但主会话用真实浏览器复核时实测：
**反复攻击，敌人血量始终是 `6 / 6`**，玩家自己每轮掉血（`100 → 84 → 76`），战斗无法取胜。

**根因（已由主会话实测确认，不必重新排查）**：
`apps/player-demo/src/main.tsx` 传的是
`initialAttrs: { hp: 100, stamina: 30, insight: 0 }`——**没有 `atk` / `def` / `spd`**。
而宿主 `game-host.ts` 的 `start()` 里是 `attrs: { ...(options.initialAttrs ?? {}) }`，
**只**用 `initialAttrs` 播种，**不消费** `attrDefs.numeric[id].init`
（`attrDefs` 只被传给 `GameRuntime` 与 `projectStatusPanel`）。
于是玩家的 `attrs.atk` 为 `undefined`，而内置伤害公式
（`packages/engine/src/battle/damage.ts:28-30`）是
`Math.max(0, (input.attacker['atk'] ?? 0) * input.mult - input.defender['def'])`
——`undefined ?? 0` → **玩家伤害恒为 0**。
敌人不受影响：`fixtures/mini-game/data/enemies.yaml` 的 `rock_rat` 显式声明了
`attrs: { atk: 4, def: 1, spd: 4 }`。

**实测验证（主会话已做）**：临时把 demo 的 `initialAttrs` 补上
`atk: 10, def: 3, spd: 5` 后，同样路径下第一次攻击即打出 `岩鼠0/6`（一击击杀）。
即根因确认为属性播种缺失。

### 为什么既有检查都没抓到（供你理解，不必修）
① 检查驱动层 `packages/runtime-ui/test/acceptance/route-driver.ts` 注入的是
`CHECK_INITIAL_ATTRS`（**含** `atk: 10, def: 3, spd: 12`）——检查环境与浏览器宿主
**初始属性集不同口径**；② `panel-wiring.test.ts` 的战斗用例只断言「敌人掉血**或**
战斗已结束」，在属性齐全的检查环境里自然通过；③ E2E 不属默认门禁，未被执行。
（这是约束 11「检查工具与被测系统同口径」的第二个实例。）

### 交付物
- [ ] `apps/player-demo/src/main.tsx`：`initialAttrs` 补齐 `atk: 10, def: 3, spd: 5`
      （与 `fixtures/mini-game/data/attrs.yaml` 的 `numeric.*.init` 一致）
- [ ] **加一条能抓住这类缺陷的机械防线**（二选一，择优选并在报告中说明选择理由）：
      · **甲**：在 `packages/runtime-ui/test/acceptance/` 增加一条用例，
        断言「**按 demo 的 `initialAttrs` 装配**（不是 `CHECK_INITIAL_ATTRS`）时，
        战斗里玩家能对敌人造成伤害」——即把「宿主播种口径」纳入检查；
      · **乙**：在 `packages/runtime-ui/test/app/` 增加一条用例，断言
        「`initialAttrs` 未覆盖的属性在开档后**不应为 undefined**」
        （若走乙，注意这可能牵出「宿主是否该回落 `attrDefs.init`」的设计问题——
        **那是设计决策，不要擅自改宿主行为**，只写「当前行为下 demo 必须显式给全」
        的断言与注释）。
- [ ] 在代码注释里说明：**为什么 demo 必须显式给全属性**（宿主只用 `initialAttrs` 播种，
      `attrDefs.init` 不参与），并指向本任务的问题编号 #12。

### 硬约束
- **允许改动**：`apps/player-demo/src/main.tsx`、
  `packages/runtime-ui/test/acceptance/**`、`packages/runtime-ui/test/app/**`
- **禁止改动**：`packages/runtime-ui/src/**`（宿主与组件行为**不得**改——
  「宿主是否该回落 `attrDefs.init`」是待人类裁定的设计议题）、`packages/engine/**`、
  `fixtures/**`、`docs/**`、`scripts/`
- 提交粒度：一个 commit（`fix(demo): 补齐战斗属性播种，修复伤害恒为 0（#12）`）
- **自测门禁**：`pnpm test` / `pnpm typecheck` / `pnpm lint` / `node scripts/validate-docs.mjs` 全绿

### 完成定义
- demo 的 `initialAttrs` 含 `atk` / `def` / `spd`
- 新增的防线用例**在改回旧 `initialAttrs` 时会失败**（请在报告中贴出你实测的失败输出）
- 四门禁全绿

### 返回报告
按 `docs/subagent-protocol.md` §5 格式，并附「防线可证伪」的实测输出。
```

---

## 批 2（待批 1 验收后派发）：接线遗漏 #2 / #5 / #6 / #11

> 派发前需重新核算文件白名单（批 1 合入后行号会漂移）。初步方案：

| 包 | 覆盖 | 文件白名单（初步） | 备注 |
|---|---|---|---|
| **P3** | #2 跳过开关 + #6①/#6b 商店与战斗日志文案 | `apps/player-demo/src/main.tsx` | demo 单文件 |
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
