# 未入档事项清单（临时）

> **性质**：临时中转文档。这里放**尚未写进权威文档**的教训与**未完成**的待办，避免随会话丢失。
> **去向**：教训在下一轮反思报告（`docs/retros/`）与流程文档定稿时并入正式文档；待办完成后逐条勾除。
> **维护**：主 Agent。最后更新 2026-09-25。

---

## 一、尚未入档的教训

### L-1「引擎能力就绪 ≠ 玩家能用」——宿主装配缺口已累计 6 例

**现象**：引擎侧能力完整、测试全绿，但玩家在浏览器里点了**毫无反应**。

| # | 缺口 | 后果 | 状态 |
|---|---|---|---|
| 1 | M1：`TimePipeline` 缺 `eventEval` 步骤 | 10 条事件零触发 | 已修 |
| 2 | 宿主未订阅 `shop_open` | 商店点了无反应 | 已修（PR #53） |
| 3 | 宿主未订阅 `battle_start` | 战斗点了无反应 | 已修（PR #53） |
| 4 | 宿主注册表未注入 `shops` | 商店交易不记账（视一切为无限库存） | 已修（PR #53） |
| 5 | 宿主无 `exploreCandidates` 调用点 | 4 条探索型事件永不触发 | 已修（PR #53） |
| 6 | 宿主注册表未注入 `checkResolver` | **检定零执行**（点「辨认凿痕」无任何反应） | 已修（PR #53） |

**根因共性**：引擎侧「可选依赖缺省静默降级」的设计（如 `CheckRuleResolver` 缺省 → `check` 抛错被宿主 `guard` 吞进 `lastError`；`shops` 缺省 → 视为无限库存）。**宿主遗漏装配面时，失败不显性**。

**已有的机械化防线**（本次建立）：
- `L2-A/B/C` 三层检查（`packages/runtime-ui/test/acceptance/`）——用**玩家视角**断言「点击后有效果」，
  这是唯一能抓出此类缺口的层（引擎单测与加载器诊断都覆盖不到）；
- 覆盖率的**闭环断言**：数据全集 vs 检查用例，差集必须为空。

**待入档**：`develop.md` 约束 8「宿主接线完整性」应补：**每条引擎能力必须有「玩家视角的效果断言」**，
仅靠「接线自检告警」不够（告警只在启动时打印，易被忽略；且第 6 例连告警都没有）。

### L-2 事件池的作用域是「地点」而非「场景」

选项的 `goto` 只切场景、**不更新 `currentLocation`**；而事件池按 `pool.locate(area, location)` 过滤候选。
后果：在 `town_gate` 场景里推进时间，评估的是**旧地点**（如 market）的事件——目标事件永不入选。
宿主侧的补法是显式 `moveTo` 一次（L2 检查的 `syncLocationTo` 即此）。

**待入档**：这是**作者与宿主都会踩**的坑，应写进 detail-design §4.4（事件池）与开发者规范。

### L-3 窄窗口 + 高 `moveCost` 的时段对齐问题

地点移动消耗 `moveCost` 个时段。神龛的 `moveCost = 2`，而事件窗口是 `night`（slotIndex 3）——
逐次推进的步长为 2，只能在**同奇偶**的时段间跳，可能永远碰不到目标窗口。
作者写窄窗口事件时须核算该地点的 `moveCost` 奇偶性。

**待入档**：内容编写规范（事件窗口 × 地点消耗的配合）。

### L-4 检查自身的坑（供后续写检查的人参考）

写 L2 检查时踩到的三处，均与「引擎的正确行为」有关，不是缺陷：

1. **`advanceSlots` 会自动清场事件** → 用「当前场景」判定事件是否触发会误判为「没触发」；
   正确口径是看**事件打断记录**（触发过即算）；
2. **`__time.advance` 要求 `slots ≥ 0`** → 「倒拨时钟」不可行，只能向前推进（跨天绕行）；
3. **`advanceSlots` 的原地推进**（位置不变 → 不触发导航）才是「纯时间流逝」的正确写法。

---

## 二、未完成的待办

### T-1 demo 检查发现的 11 项问题（**均未修**，2026-09-25 人工检查）

| # | 问题 | 归属 | 修复方案 |
|---|---|---|---|
| 1 | 成就面板无内容、**无退出按钮**（进入后出不来） | 组件 + demo | `AchievementGalleryPanel` 加 `onClose`；demo 传退出回调 |
| 2 | 「跳过」开关无现象 | demo 接线 | `revealInstantly` 未传给打字机（`useRevealedChars` 只吃 `textSpeed`） |
| 3 | 错误框按钮恒为「回退一步」、**无法关闭** | demo UX | 按钮按错误类型区分（`NO_CHECKPOINT` 时禁用）；加关闭按钮 |
| 4 | **数字键选选项报 `choiceFiltered`** | demo bug | 键盘取了**未过滤** `hiddenByFilter` 的 `session.choices[index]`；应按渲染层同口径过滤 |
| 5 | 历史显示原始文本键 | demo 接线 | `projectHistory` 支持 `resolveText` 但宿主未传 |
| 6 | 商店名/物品名显示键；价格无标注；「卖」按钮该禁用 | demo 接线 + 组件 UX | 传 `resolveName`；价格加「买/卖」标注；`onSell` 按持有量禁用 |
| 7 | 未与老卫兵搭话就能接任务 | demo 内容 | `inspect_wall` 的 `showIf` 应含 `flag.old_guard_met` |
| 8 | **战斗不渲染行动按钮**（死锁） | demo bug | 会话初始相位是 `turn_order`，宿主未 `beginTurn()` 就等玩家输入 |
| 9 | **「回退一步」总是退回石板路** | demo bug | 待查：工具栏调 `host.rollback()` 未传步数与 `checkpoints` 镜像的关系 |
| 10 | 切英文后部分文案仍中文 | 引擎键面 + demo | 引擎内置 `ui.*` 键不在游戏包词典内（设计边界）；demo 自持中文（标题/工具条）应纳入 i18n |
| 11 | 无存读档/导出按钮 | demo 未接线 | `SaveService` + `DexieAdapter` 已就绪（M1），界面无入口 |

**入库的性质划分**：
- **真 bug**（#4 #8 #9）：影响可玩性，优先修；
- **接线遗漏**（#2 #5 #6 #11）：组件能力就绪、宿主未接；
- **UX/内容设计**（#1 #3 #7 #10）：连同开发者规范一并处理。

### T-2 `requires` / `showIf` 可见性缺陷（L2-C 抓出，**未修**）

**现象**：`accept_survey` 的 `showIf` 为
`flag.ferryman_met && attr.insight >= 3 && quest('wall_rubbing') == 'done'`，
实测 `insight=3`、`ferryman_met=true`、`wall_rubbing` 状态 `undefined`（未接取）时，
**该选项仍出现在列表里**（预期 `quest(...) == 'done'` 为假 → 隐藏）。

**影响**：玩家可在前置未满足时看到并点击接取选项（点击后引擎会拒绝，但属「可点必失败」）。
与 C8 检守护的同类问题（入口与其前置条件不同口径）。

**排查方向**：`quest()` 在 `showIf` 求值路径下的作用域来源（`buildExprScope` 的 `quests` 切片）
是否与 `SceneRunner` 求值时的状态一致；或 `==` 对 `undefined` 的处理。

### T-3 周目切换的宿主接线（**未接线**）

`ending` 达成后 `loop_transition` 的宿主消费不存在——浏览器里无法进入二周目。
引擎侧全链已由 `L2-C-3` 验证（`runLoopTransition` + 继承清单生效）。

### T-4 M2 里程碑收尾（**未做**）

- M2 反思报告（约束 4）——素材：L-1 的 6 例宿主装配缺口、11 项 demo 问题、检查层建设经验；
- M2 里程碑审查记录（约束 10，参照 `docs/reviews/M1-review.md`）——**待人工验收**；
- `docs/reviews/demo-check-path.md` 的 L3 清单**待人类执行**。

### T-5 已登记但未处理的设计/文档事项

| 项 | 出处 | 说明 |
|---|---|---|
| 归入 `items` 类别的钱包无法与背包分开配置 | `19-loop.md` 落地记录 | 待真实需求出现再加 `wallet` 类别 |
| `battle_action_end` 钩子 | `23-script-host.md` 裁定 | 按需追加（additive） |
| 回滚栈深 = 5 的边界 | `M2-stage5-qol-plan.md` §2 | 已裁定维持 |
| 口径乙（叙事位置精确还原） | 同上 | 登记为 M4 打磨项 |
| 条目级定价覆盖（方案 B） | `17-economy.md` 落地记录 | 无真实需求 |
| `npc.<id>.met` 写指令 | M1 遗留 | 已由 `meet` 指令解决，待确认是否还有遗留引用 |

---

## 三、本会话新增的可复用资产（索引）

| 资产 | 位置 | 用途 |
|---|---|---|
| L2 检查驱动层 | `packages/runtime-ui/test/acceptance/route-driver.ts` | 把「走一条线路」变成可编程动作 |
| L2-A/B/C 检查 | 同目录 `route-choices` / `route-events` / `route-mainlines` | 玩家视角的效果断言 + 覆盖率闭环 |
| L3 人工清单 | `docs/reviews/demo-check-path.md` | 10 步 25 检查点（含已知问题单） |
| 双人协作模板 | `docs/plans/collaboration-template.md` | 多人/多 Agent 协作的标准结构 |
| 子代理协议（本次新建） | `docs/subagent-protocol.md` | 本会话 → 检查/设计，子 Agent → 实现 |
