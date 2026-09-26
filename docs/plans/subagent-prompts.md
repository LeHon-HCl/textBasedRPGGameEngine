# 子 Agent 派发 prompt（即用）

> 配套 `docs/subagent-protocol.md`。本文件给出**可直接复制派发**的 prompt 正文。
> 当前批次：demo 检查发现的 3 个**真 bug**（T-1 的 #4 / #8 / #9）——文件不重叠，**可并行派发**。
> 派发时把 `<...>` 占位符替换为实际值；其余原文照发。

---

## 批次 A：三个真 bug（可并行）

| 包 | 问题 | 文件白名单 | 可否并行 |
|---|---|---|---|
| **A1** | #4 数字键选到隐藏选项 | `apps/player-demo/src/main.tsx` | ✅（与 A2/A3 不重叠） |
| **A2** | #8 战斗不渲染行动按钮 | `apps/player-demo/src/main.tsx` ⚠️ **与 A1 同文件 → 必须串行** | ❌ |
| **A3** | #9「回退一步」总是全退 | `packages/runtime-ui/src/app/game-host.ts` | ✅ |

**结论**：A1 与 A2 同文件（demo 的 `main.tsx`）→ **合并为一个包**；A3 改宿主 → **可与 A1+A2 并行**。

修正后的批次：

| 包 | 覆盖 | 文件白名单 |
|---|---|---|
| **A-1** | #4 + #8（键盘选择过滤 + 战斗会话驱动） | `apps/player-demo/src/main.tsx` |
| **A-2** | #9（回退步数语义） | `packages/runtime-ui/src/app/game-host.ts` + 对应测试 |

---

## Prompt A-1（#4 数字键选择过滤 + #8 战斗行动按钮不渲染）

```text
你是实现 Agent，负责修复 demo 宿主页的两个缺陷，完成后返回报告。

## 任务：修复键盘选择未过滤隐藏选项（#4）与战斗面板无行动按钮（#8）

### 背景与目标
用户实测 demo 发现两处可玩性缺陷：
1. **#4**：按数字键 1/2 选选项时，有时报错
   `[INTERNAL] error.narrative.choiceFiltered (scene=town_gate, choice=greet_guard)`。
   根因：键盘处理取了 `session.choices[index]`，而该数组**含 `hiddenByFilter` 的选项**
   （渲染层 `OptionList` 会过滤掉它们）——索引错位导致选到了隐藏选项，引擎正确拒绝。
2. **#8**：进入战斗后**看不到行动按钮**。根因：`BattleSession` 构造后初始相位是
   `turn_order`，而 `BattlePanel` 只在 `phase === 'await_player'` 时渲染按钮；
   宿主（runtime-ui 的 `battleAct`）只在收到玩家行动后才调 `beginTurn()`，形成死锁。

### 必读（按序）
1. `apps/player-demo/src/main.tsx` 的 `GameScreen`：`useKeyboardShortcuts` 的 `choose` 回调（约 240-253 行）、
   `OverlayPanels` 的 `BattlePanel` 用法（约 385-420 行）
2. `packages/runtime-ui/src/app/game-host.ts` 的 `battleAct`（搜索 `battleAct:`）
   —— 会话驱动逻辑在此，**本包不改该文件**，但需理解其行为以决定 demo 侧如何调用
3. `packages/runtime-ui/src/panels/BattlePanel.tsx` 的 `canAct` 判定（约 135 行）
4. `packages/runtime-ui/src/narrative/NarrativeView.tsx` 的 `OptionList`：
   `const visible = choices.filter((choice) => choice.hiddenByFilter !== true)`（约 180 行）
   —— **这是键盘选择必须对齐的口径**
5. 参考测试风格：`packages/runtime-ui/test/acceptance/panel-wiring.test.ts`

### 交付物
- [ ] `apps/player-demo/src/main.tsx`：
      · `useKeyboardShortcuts` 的 `choose` 回调改为**先过滤 `hiddenByFilter`**，再按 index 取；
        （口径与 `OptionList` 完全一致：`choices.filter((c) => c.hiddenByFilter !== true)`）
      · `choiceCount` 同步改为过滤后的数量
- [ ] `apps/player-demo/src/main.tsx`：战斗面板行动按钮的可用性修复（**二选一，择优选**）：
      · 方案甲（推荐）：demo 在渲染战斗面板时，若 `battle.phase === 'turn_order'`，
        主动调 `host.battleAct({ kind: 'defend' })` 之外的**推进入口**——需要先确认宿主
        `battleAct` 是否已处理「先 beginTurn 再等玩家」；若未处理，**本包不改宿主**，
        改为在 demo 侧用一个 `useEffect` 观察 `phase === 'turn_order'` 时调用
        `host.battleAct({ kind: 'flee' })` 之外的方式触发推进（与主会话确认后实施）；
      · 方案乙：把 `BattlePanel` 的 `canAct` 放宽为「`phase !== 终局`」并在 `turn_order`
        时也显示按钮（需主会话批准——**这是改组件语义，须先报主会话**）。
      · **实施前先在报告里说明你选了哪个方案与理由**；若两个方案都需要改白名单外文件，
        返回 `BLOCKED` 并说明需要主会话裁定什么。
- [ ] 任务文件勾选：`docs/tasks/25-runtime-ui.md` B 组的「快捷键映射」与「判定呈现/战斗面板」条目
      （若已勾选则跳过）

### 硬约束
- **允许改动**：`apps/player-demo/src/main.tsx`（仅此文件）
- **禁止改动**：`packages/**`（任何包内代码，包括 game-host 与 BattlePanel）、
  `docs/proposal.md`、`docs/detail-design.md`、其他任务文件、`docs/tasks/progress.md`、`scripts/`
- 提交粒度：一个缺陷一个 commit（`fix(demo): ...（#4 键盘选择过滤）` / `fix(demo): ...（#8 战斗行动按钮）`）
- **自测门禁**：`pnpm test` / `pnpm typecheck` / `pnpm lint` / `node scripts/validate-docs.mjs` 全绿

### 完成定义
- 键盘选择的索引与 `OptionList` 的可见列表一致（有测试或可复现的手工验证步骤）
- 进入战斗后**行动按钮可见可点**（有可复现的手工验证步骤：走到采石场 → 打岩鼠 → 看到按钮）
- 四门禁全绿

### 返回报告
按 `docs/subagent-protocol.md` §5 格式。
```

---

## Prompt A-2（#9「回退一步」总是退回入口场景）

```text
你是实现 Agent，负责修复「回退一步」的行为缺陷，完成后返回报告。

## 任务：修复宿主「回退一步」总是回退到最初场景的缺陷（#9）

### 背景与目标
用户实测：在 demo 里走了很多步（历史面板显示已到第 9、10 步），但点工具栏「回退一步」
**直接回到石板路（入口场景），历史全部清空**——看起来像「无论多少步都全部回退」。

预期行为（已裁定的口径，见 `docs/plans/M2-stage5-qol-plan.md` §「关键设计点」1）：
- 回退**只还原状态**（attrs/flags/wallet/quests/time/npcs），**一步**；
- 叙事位置按设计 §6.3 重开会话到**入口场景**——这是**已知且已裁定**的行为，
  **不是**本任务要修的部分；
- 本任务要修的是：**「一步」的语义**。当前实现可能把 `steps` 语义搞错了
  （例如 `checkpoints` 镜像与实际快照栈不同步，导致 `rollback(1)` 一次退到最早）。

### 必读（按序）
1. `packages/runtime-ui/src/app/game-host.ts` 的 `rollback`（搜索 `rollback: (steps = 1)`）
   —— 含步数前置校验（`rt.state.checkpoints.length`）与 `createRunnerSession(entryScene)`
2. `packages/engine/src/runtime/game-runtime.ts` 的 `rollback(steps)` 与 `checkpoint(label)`
   —— 理解快照栈（`#snapshots`）与 `state.checkpoints` 镜像的关系
3. `packages/runtime-ui/test/acceptance/history-rollback.test.ts`
   —— **已有的「回滚 5 步状态一致」验收用例**（M2 验收第 4 条），必须继续通过
4. `docs/plans/M2-stage5-qol-plan.md` §「关键设计点」1（回滚口径的裁定）

### 交付物
- [ ] 定位根因：为什么在走过 N 步后 `rollback(1)` 会退到最初状态？
      可能方向（择实修正）：
      · `state.checkpoints` 镜像条目数远少于实际快照数（检查点的写入路径是否只在 `choose` 里？）
      · demo 的「回退一步」按钮传了错误的步数（检查 `apps/player-demo/src/main.tsx` 的调用——
         **本包不改该文件**，若问题在此则返回 `SPEC_CONFLICT` 说明）
      · `rollback(steps)` 的 `steps` 是「退到第 N 个快照」而非「退 N 步」的语义混淆
- [ ] `packages/runtime-ui/src/app/game-host.ts`：修正步数语义 + 补充/更新测试
- [ ] `packages/runtime-ui/test/acceptance/history-rollback.test.ts`（或新增测试文件）：
      新增用例覆盖「走 N 步后回退 1 步，状态只退一步」（断言：退一步后的状态 == 倒数第二次选择前的状态）
- [ ] 任务文件勾选：`docs/tasks/25-runtime-ui.md` 的「回滚按钮（rollback + session 重建）+ 历史回看」条目

### 硬约束
- **允许改动**：`packages/runtime-ui/src/app/game-host.ts`、
  `packages/runtime-ui/test/acceptance/history-rollback.test.ts`（或同目录新增测试）
- **禁止改动**：`apps/**`、`packages/engine/**`、需求/设计文档、其他任务文件、`progress.md`、`scripts/`
- **必须保持通过**：`history-rollback.test.ts` 现有的「回滚 5 步状态一致」用例（M2 验收标准第 4 条）
- 提交粒度：一个 commit（`fix(runtime-ui): 回退一步的步数语义（#9）`）
- **自测门禁**：`pnpm test` / `pnpm typecheck` / `pnpm lint` / `node scripts/validate-docs.mjs` 全绿

### 完成定义
- 新用例证明「走 N 步 → 回退 1 步 → 只退一步」（用状态快照逐字段断言）
- 「回滚 5 步状态一致」既有用例仍绿
- 四门禁全绿

### 返回报告
按 `docs/subagent-protocol.md` §5 格式；若根因在 demo 侧（白名单外），返回 `SPEC_CONFLICT`。
```

---

## 使用说明（主会话执行）

1. **确认批次**：A-1 与 A-2 文件不重叠 → **可同时派发**；
2. **派发**：用 `Agent` 工具，`subagent_type: general-purpose`，`prompt` 填上述正文（替换占位符）；
3. **验收**：按 `docs/subagent-protocol.md` §6 六项协议（重跑门禁 / 一致性 / 抽查 / 红线 / 范围 / 玩家视角）；
4. **后续批次**（待前批验收后按同样方式准备）：
   - B 批：接线遗漏（#2 跳过开关、#5 历史文案、#6 商店文案与禁用、#11 存读档入口）；
   - C 批：UX 与内容（#1 成就面板关闭、#3 错误框、#7 showIf 叙事一致性、#10 i18n 边界）；
   - D 批：T-2（`requires` 可见性）、T-3（周目宿主接线）。
