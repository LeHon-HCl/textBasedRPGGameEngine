# Demo 人工检查发现的 11 项问题（问题清单）

> **来源**：2026-09-25 用户人工试玩 `pnpm dev:player` 时逐项记录。
> **用途**：本清单是这 11 项的**唯一权威登记处**——每条给出「现象 / 根因 / 修复方案 / 归属」，
> 供人类过目后按批次派发子 Agent（派发 prompt 见 `docs/plans/subagent-prompts.md`）。
> **核对方式**：根因均经**主会话实读代码或实跑检查**确认（《依据》列标注证据位置），
> 非推测。核对日期 2026-09-26。
> **状态**：待人类审查。

## 结论摘要

**引擎核心无缺陷。** 11 项归为三类（另发现 3 项同源问题，一并登记）：

| 类别 | 项数 | 条目 | 性质 |
|---|---|---|---|
| **A 类：真 bug** | 3 | #4 #8 #9（含 9b） | 宿主/demo 侧实现错误，影响可玩性，优先修 |
| **B 类：接线遗漏** | 4 | #2 #5 #6（含 6b）#11 | 组件能力已就绪、宿主未接（L-1 的第 7–10 例） |
| **C 类：规范/内容** | 4 | #1 #3 #7 #10 | UX 与内容设计，连同开发者规范一并处理 |

**本次核对新发现 3 项**（均登记在对应条目内）：
- **#9b**：历史面板「回退 N 步」用**分组距离**当步数，与检查点步数不一致（实测 5 个检查点 vs 7 个分组）；
- **#6b**：战斗日志显示原始文本键（与 #6① 同一装配遗漏模式）；
- **#9c**：`HistoryPanel.canRollback` 全仓无调用点 → 回退按钮永不置灰。

另有 **1 项原登记问题被证伪**（原 T-2「`requires`/`showIf` 可见性缺陷」），见文末。

---

## A 类：真 bug（优先修）

### #4 数字键选选项报 `choiceFiltered`

| 项 | 内容 |
|---|---|
| **现象** | 在 `town_gate` 场景按数字键 `1`/`2` 选选项，屏幕出现红色错误卡片：`[INTERNAL] error.narrative.choiceFiltered (scene=town_gate, choice=greet_guard)`。鼠标点击同一选项则正常。 |
| **根因** | **demo 侧索引错位**。宿主把**未过滤**的 `session.choices` 交给键盘层：`main.tsx` 的 `choose: (index) => { const choice = session.choices[index]; ... }`。而渲染层 `OptionList` 会先过滤掉隐藏项（`NarrativeView.tsx:180`：`const visible = choices.filter((choice) => choice.hiddenByFilter !== true)`）。两者索引口径不一致 → 玩家按「第 1 项」时，键盘取到的是**过滤前**的第 1 项，可能正是被 `showIf` 隐藏的 `greet_guard`。引擎随后正确拒绝：`SceneRunner.choose` 校验 `view?.hiddenByFilter === true` 即抛 `choiceFiltered`（`scene-runner.ts:249-258`）。 |
| **重要判断** | **引擎行为正确，且这条报错恰恰证明过滤链在正常工作**——它防止了「玩家选中一个不该可见的选项」。缺陷在 demo 的键盘层。 |
| **修复方案** | `main.tsx` 的键盘选择改为**先过滤再取索引**，口径与 `OptionList` 完全一致：`const visible = session.choices.filter((c) => c.hiddenByFilter !== true)`。`choiceCount` 同步改为过滤后的数量（否则按 `3` 会落在可见范围外）。 |
| **归属** | **demo bug**（`apps/player-demo/src/main.tsx`）。引擎无改动。 |
| **依据** | 实读 `apps/player-demo/src/main.tsx:240-253`；`packages/runtime-ui/src/narrative/NarrativeView.tsx:180`；`packages/engine/src/narrative/scene-runner.ts:249-258`。 |

### #8 进入战斗后没有行动按钮（死锁）

| 项 | 内容 |
|---|---|
| **现象** | 采石场点「打岩鼠」，战斗面板出现（敌方两只岩鼠、我方血条、日志都在），但**没有任何行动按钮**，只有一行「等待你的行动…」。玩家无法操作，战斗永久卡住。 |
| **根因** | **宿主未驱动会话起步**。`BattleSession` 构造后初始相位是 `turn_order`（八相位状态机的第一相），必须由宿主调 `beginTurn()` 才推进到 `await_player`。而 `BattlePanel` 只在 `phase === 'await_player'` 时渲染按钮（`BattlePanel.tsx:135`：`const canAct = props.phase === 'await_player' && !terminal;`），`turn_order` 分支落进 `else` 只显示 `labels.awaiting`（面板第 252 行「等待你的行动…」）——**这句提示是假的**，此时并非等玩家，而是在等宿主。宿主 `battleAct` 只在收到玩家行动**之后**才调 `beginTurn()`（`game-host.ts:818`），但没有按钮就没人能发出第一次行动 → 死锁。 |
| **修复方案** | 宿主在战斗会话建立后**立即推进起步**：订阅 `battle_start` 后即调一次会话驱动（等价于 `battleAct` 里的推进段），使相位进入 `await_player`，按钮随之出现。改动点在 `game-host.ts` 的战斗接线（也可在 demo 渲染面板时按相位驱动，但宿主是会话持有者，放在宿主更正确）。 |
| **归属** | **宿主 bug**（`packages/runtime-ui/src/app/game-host.ts`）。组件与引擎无需改。 |
| **依据** | 实读 `packages/runtime-ui/src/app/game-host.ts:807-835`（`battleAct`）与 `:624-650`（`battle_start` 订阅）；`packages/runtime-ui/src/panels/BattlePanel.tsx:135,220-255`。 |

### #9 「回退一步」把历史退光（历史面板清空）

| 项 | 内容 |
|---|---|
| **现象** | 走了很多步后点工具栏「回退一步」（或按 `R`），**历史面板从 7 组变成 1 组**，画面回到入口场景「石板路」，看起来像「无论多少步都全部回退」。 |
| **根因**（**与初判不同，已实测修正**） | **不是步数语义错误**。`rollback(1)` 的状态回退是**精确的**——`packages/runtime-ui/test/panels/history-rollback.test.ts` 8 例全绿，其中「回退 1 步后状态 == 上一步」逐字段断言通过（本次实跑确认）。真正原因是**两个已知口径叠加后的观感**：<br>① 回滚只还原 GameState，**叙事位置必须重开会话**（设计 §6.3 原文；M2 验收口径甲，`M2-stage5-qol-plan.md` §「关键设计点」1 已裁定）；<br>② 宿主重建 session 时用 `createRunnerSession(..., definition.manifest.entryScene)`（`game-host.ts:765`）——而 `SceneRunner` 的**历史环形缓冲属于会话对象**，新会话的历史是空的。故「画面回入口场景」+「历史面板只剩入口场景的 1 组」两件事同时发生。<br>玩家看到的是「退了一步，但**看起来**全丢了」，实际状态（属性/钱袋/任务/时间）只退了一步。 |
| **判断** | 这是**设计口径的观感缺陷**，不是实现缺陷。但「历史面板被清空」让玩家无法确认「只退了一步」，**削弱了回滚的可信度**——按口径甲原本的补强措施（「历史面板提供回退前后的文本可追溯性」，见计划 §1 第 1 点），现在的实现**没有兑现这条补强**。 |
| **修复方案** | 三个层次，建议**甲+乙**：<br>**甲（必修，兑现已承诺的补强）**：回滚重建会话时**沿用回滚前的历史**——历史缓冲不属于状态树，回滚不该把它清掉。可在宿主侧保留一份历史镜像并在重建后回填（或改由宿主持有历史、不随会话重建丢失）。修完后玩家点「回退一步」能**看到历史仍在**、只是状态退了一步，观感即正常。<br>**乙（必修，避免误导）**：回退后给一条 Toast 说明「已回退 1 步（画面回到入口场景，数值已还原）」，把「为什么画面回入口」讲清楚。<br>**丙（不建议现在做）**：口径乙（叙事位置精确还原，需 `CheckpointMeta` 扩展）已登记为 M4 打磨项，本批不动。 |
| **归属** | **宿主**（`packages/runtime-ui/src/app/game-host.ts`）+ 可选 demo Toast。引擎无改动（`rollback` 语义正确，已实测）。 |
| **依据** | 实跑 `npx vitest run packages/runtime-ui/test/panels/history-rollback.test.ts`（8/8 绿）；实测探针：走 5 步后 `checkpoints=5`、历史 7 组 → `rollback(1)` 后历史降为 1 组；实读 `game-host.ts:739-766`、`docs/plans/M2-stage5-qol-plan.md` §「关键设计点」1、设计 §6.3（`detail-design.md:1121`）。 |

> **修正说明**：本条初判为「步数语义错误（`rollback(1)` 退到最早）」，**经实测推翻**。
> 步数语义正确，缺陷在「会话重建丢弃历史」+「缺少回退说明」。

#### #9b 历史面板的「回退 N 步到这里」步数口径错位（本次新发现，同属 #9 修复面）

| 项 | 内容 |
|---|---|
| **现象** | 历史面板每组的「回退 N 步到这里」按钮，其 N 由**分组距离**算出（`HistoryPanel.tsx:104`：`const steps = lastIndex - index;`），而 `rollback(steps)` 的 `steps` 是**检查点步数**。两者不是同一个量。 |
| **实测证据** | 走 5 步后：`checkpoints = 5`，但历史**分组数 = 7**。面板会给出「回退 6 步」这样的按钮，而回滚栈只有 5 步 → 点了必然 `NO_CHECKPOINT`。即便步数没超限，「回退 2 步」也**退不到**该组对应的位置（分组边界是「换场景或跨天」，检查点边界是「每次选择」）。 |
| **附带缺陷（#9c）** | `HistoryPanel` 的 `canRollback` prop（用于栈空时禁用按钮）**宿主与 demo 都没传**（grep 全仓仅组件自身声明与使用）→ 永远是 `undefined` → 按钮永不置灰，即**明知不可回退也照样可点**，点了报错。 |
| **修复方案** | ① **正本清源**：宿主投影历史时**为每个分组附带它的检查点步数**（`HistoryGroup` 加 `rollbackSteps?: number`），面板不再自己算——步数只有宿主知道（它持有 `checkpoints` 与选择序号）；② 宿主传 `canRollback={checkpoints.length > 0}`；③ 若某组已超出回滚栈（步数 > 可用快照数），该组按钮禁用并给出原因。 |
| **归属** | **宿主 + 组件（additive）**：`game-host.ts`（投影补步数 + 传 canRollback）、`history-projection.ts` / `HistoryPanel.tsx`（字段与渲染）。 |
| **依据** | 实读 `packages/runtime-ui/src/panels/HistoryPanel.tsx:96-121`、`history-projection.ts:13-28`（`HistoryGroup` 无步数字段）；实测探针 `checkpoints=5` vs `history groups=7`；grep 确认 `canRollback` 无调用点。 |

---

## B 类：接线遗漏（组件已就绪，宿主未接）

> **共性**（即 `docs/plans/open-items.md` L-1 的第 7–10 例）：引擎/组件能力完整、单测全绿，
> 但宿主的装配面少接了一根线 → 玩家侧「点了没反应 / 显示原始键」。
> **这类缺口只有「玩家视角的效果断言」（L2 层）能抓住**，引擎单测与加载器诊断都覆盖不到。

### #2 「跳过」开关打开后打字机照旧

| 项 | 内容 |
|---|---|
| **现象** | 点工具条「跳过：关」变成「跳过：开」，但后续段落**仍然逐字出现**，没有直接全显。 |
| **根因** | **宿主未把手控开关传给打字机**。`useReadingControl` 已算出 `revealInstantly`（`reading-control.ts:101`：`skipEnabled \|\| skippedSegment === segmentKey`），但 demo 的 `useRevealedChars(lastText, settings.textSpeed, phase === 'await_advance')`（`main.tsx:230`）**只吃 `textSpeed`**，没有「立即全显」这条入参——开关状态被算出来但没被消费。 |
| **修复方案** | demo 侧把 `reading.revealInstantly` 接入打字机：`revealInstantly` 为真时直接全显（等价于 `speed <= 0` 的既有分支）。 |
| **归属** | **demo 接线**（`apps/player-demo/src/main.tsx`）。组件无需改（`useReadingControl` 已提供该值）。 |
| **依据** | 实读 `packages/runtime-ui/src/narrative/reading-control.ts:94-103`、`apps/player-demo/src/main.tsx:83-111,230`。 |

### #5 历史面板显示原始文本键

| 项 | 内容 |
|---|---|
| **现象** | 打开历史面板，条目显示 `scenes.arrival.open` 这类**文本键**而不是译文。 |
| **根因** | **宿主未传 `resolveText`**。`projectHistory(entries, resolveText?)` 的第二个参数是可选的文本物化函数，**缺省时直接用键**（`history-projection.ts:72-73` 的降级分支，设计本意是「测试与降级用」）。宿主调用处 `history: () => projectHistory(session?.history() ?? [])`（`game-host.ts:768`）**没传 resolver**。 |
| **修复方案** | 宿主传入 resolver：`projectHistory(entries, (key, vars) => resolver.resolve(key, lang, vars).text)`。注意 lang 需取**当前设置的语言**（与叙事区同源）。 |
| **归属** | **宿主接线**（`packages/runtime-ui/src/app/game-host.ts`）。 |
| **依据** | 实读 `packages/runtime-ui/src/panels/history-projection.ts:39-42,67-77`、`packages/runtime-ui/src/app/game-host.ts:768`。实测探针确认当前历史文本为 `"scenes.arrival.open"`。 |

### #6 商店名/物品名显示键、价格无标注、「卖」按钮该禁用

| 项 | 内容 |
|---|---|
| **现象** | 三处小问题：① 商店标题与商品名显示**文本键**（不是译文）；② 价格显示 `3 / 1` 这样的裸数字，**分不清哪个是买价哪个是卖价**；③ 背包里没有该物品时，「卖」按钮**仍可点**。 |
| **根因** | ① **宿主未注入 `resolveName`**——`ShopPanel` 支持 `labels.resolveName`，demo 的 `OverlayPanels` 渲染 `ShopPanel` 时只传了 `session` 与回调，没传 `labels`（`main.tsx:372-388`）；② 面板把买/卖价并排显示为 `{entry.priceBuy} / {entry.priceSell}`（`ShopPanel.tsx:89-91`），**无标签**；③ 「卖」按钮没有禁用条件（`ShopPanel.tsx:108-114` 只绑 `onClick`），而「买」按钮已有 `disabled={soldOut \|\| !entry.affordable}`（第 101 行）——**同类按钮的禁用口径不一致**。 |
| **修复方案** | ① demo 传 `labels={{ resolveName: (key) => host.textOf(key) }}`；② 面板价格加标注（如「买 3 / 卖 1」，或在表头加列名）；③ 面板给「卖」按钮加禁用：持有量为 0 时禁用（需要 `ShopSessionView.entries` 增加「持有数」字段——这是**组件契约的 additive 扩展**，或由宿主投影时过滤）。 |
| **归属** | ① **demo 接线**；②③ **组件 UX**（`packages/runtime-ui/src/panels/ShopPanel.tsx`，③ 可能需 additive 扩展 `ShopSessionView`）。 |
| **依据** | 实读 `packages/runtime-ui/src/panels/ShopPanel.tsx:68-118`、`apps/player-demo/src/main.tsx:372-388`、`packages/runtime-ui/src/app/panel-wiring.ts:33-49`（`ShopSessionView` 无持有数字段）。 |

### #11 没有存读档 / 导出按钮

| 项 | 内容 |
|---|---|
| **现象** | 界面上找不到存档、读档、导出存档的入口。 |
| **根因** | **demo 未接线**。引擎侧 `SaveService` + `MemoryAdapter` 已就绪（`packages/engine/src/persistence/`），runtime-ui 侧 `DexieAdapter` 已实现并导出（`packages/runtime-ui/src/index.ts:157`），`TitleScreen` 也有存读档入口组件——但 demo 用的是自建简化主菜单 `TitleEntry`（`main.tsx:442`），**没有接任何存档 UI**。 |
| **修复方案** | demo 接最小存档面：工具条加「存档 / 读档 / 导出」按钮，背后接 `SaveService`（`MemoryAdapter` 起步，`DexieAdapter` 可选）。或改用 runtime-ui 的 `TitleScreen`（已含六项主菜单）。<br>**注意**：这是**较大的接线工作**（存档槽位 UI、读档后的状态恢复与宿主重建），建议独立成包。 |
| **归属** | **demo 接线**（`apps/player-demo/src/main.tsx`；可能需宿主补 save/load API）。 |
| **依据** | 实读 `packages/engine/src/persistence/index.ts`（导出面）、`packages/runtime-ui/src/index.ts:157,66-67`、`apps/player-demo/src/main.tsx:442-469`；`game-host.ts` 全程无 save/load 方法（grep 仅命中 `achievementStore.load()`）。 |

### #6b 战斗日志显示原始文本键（本次新发现，与 #6① 同类）

| 项 | 内容 |
|---|---|
| **现象** | 战斗面板的日志条目直接显示 `battle.log.escape_success` 这类**文本键**，不是译文。 |
| **根因** | 与 #6① **完全同类**：`BattlePanel` 支持 `labels.resolveLog`（`BattlePanel.tsx:206`：`labels.resolveLog !== undefined ? labels.resolveLog(entry) : entry.key`），**缺省时直接用键**；demo 渲染 `BattlePanel` 时**只传了 `data` props，没传 `labels`**（`main.tsx:389-424`，`nameOf` 只用于单位名，日志直接 `log={battle.log}`）。而战斗日志条目本就带 `key` + `vars`（`BattleLogEntry`），物化入口齐备。 |
| **修复方案** | demo 传 `labels={{ resolveLog: (entry) => host.textOf(entry.key, entry.vars) }}`。**与 #6① 同一次修复**（同一处 `OverlayPanels` 的 labels 注入）。 |
| **归属** | **demo 接线**（`apps/player-demo/src/main.tsx`）。 |
| **依据** | 实读 `packages/runtime-ui/src/panels/BattlePanel.tsx:201-210`、`apps/player-demo/src/main.tsx:389-424`。 |

> **合并说明**：`#6①`（商店名/物品名）与 `#6b`（战斗日志）是**同一个装配遗漏模式**——
> 宿主渲染带 `labels` 契约的面板时未注入文本物化回调。建议合并为一个修复包，
> 并顺手核查是否还有第三个面板存在同样问题（`HistoryPanel` 的 `groupTitle` 缺省模板
> 用的是 `sceneId` 而非场景译名，见 #9 相关说明——属同类表现，但它的分组标题设计本就用 id，
> 是否要物化需人类裁定）。

---

## C 类：UX 与内容（连同开发者规范一并处理）

### #1 成就面板没有退出按钮（进去出不来）

| 项 | 内容 |
|---|---|
| **现象** | 点工具条「成就」打开面板后，**面板上没有关闭按钮**，只能刷新页面才能退出。 |
| **内容是否为空** | **不是空的**。实测渲染该面板：显示「已解锁 0/11（0%）」+ 6 个分组 + 11 条成就（含隐藏项显示 `???`）。用户看到的「无内容」应是**找不到退出方式**造成的误判，或未滚动查看。 |
| **根因** | ① `AchievementGalleryPanel` 的 props **只有 `view` / `resolveName` / `labels`**（`AchievementGalleryPanel.tsx:46-51`），**根本没有 `onClose`**——组件设计上就没有关闭面；② demo 侧打开它时也没提供外部关闭手段（对比：设置面板有独立的「关闭」按钮，`main.tsx:193-199`）。 |
| **修复方案** | 组件加 `onClose?: () => void`（可选，不破坏既有受控契约），demo 传入关闭回调；同时可选：`Esc` 键已由快捷键层支持 `closePanel`，但 demo 未绑（`main.tsx:240-253` 没传 `closePanel`）。**建议一并接上 `Esc`**，让所有叠加面板都有统一的退出路径。 |
| **归属** | **组件（additive）+ demo 接线**。 |
| **依据** | 实读 `packages/runtime-ui/src/panels/AchievementGalleryPanel.tsx:46-51,128-167`；实测渲染确认面板有 11 条内容；`apps/player-demo/src/main.tsx:240-253,434-436`。 |

### #3 错误框按钮恒为「回退一步」且无法关闭

| 项 | 内容 |
|---|---|
| **现象** | 出错时红色卡片只有一个「回退一步」按钮，**无法关闭**；且某些错误（如没有回退点）下点「回退一步」**无效**。 |
| **根因** | `ErrorCard` 的按钮**硬编码**为「回退一步」（`main.tsx:146-148`），不区分错误类型。而 `NO_CHECKPOINT` 这类错误恰恰是**回退栈为空**时产生的——此时点「回退一步」必然再报同一个错，形成**无效循环**。另外卡片没有关闭入口，而 `lastError` 只在宿主 `guard()` 与 `start()` 时清空（`game-host.ts:448,664`），**玩家无法主动消掉它**。 |
| **修复方案** | ① 按错误类型区分按钮：`NO_CHECKPOINT` 时禁用或隐藏「回退一步」；② 加「关闭」按钮，宿主补 `clearError()`（清 `lastError` 并 `syncSession`）；③ 文案可读化——现在直接显示 `[CODE] detail`，对玩家不友好。 |
| **归属** | **demo UX + 宿主 additive API**（`clearError`）。 |
| **依据** | 实读 `apps/player-demo/src/main.tsx:134-151`、`packages/runtime-ui/src/app/game-host.ts:443-451,664`。 |

### #7 未与老卫兵搭话就能接任务

| 项 | 内容 |
|---|---|
| **现象** | 还没和镇口的老卫兵搭过话，就能在镇口「仔细辨认墙上的徽记」并接到任务。 |
| **根因** | **内容侧的前置不严**。`town_gate` 的 `inspect_wall` 选项 `showIf` 只要求 `attr.insight >= 2`（`town_gate.yaml:19-20`），而任务 `wall_rubbing` 的阶段一 `completeWhen` 是 `flag.wall_rubbing_taken`（由后续事件置位）。即：**接取动作本身不要求「认识老卫兵」**——叙事上「辨认徽记」确实不需要先搭话（徽记就在墙上），所以这条严格说**不是必错**，但用户认为「不认识守卫就接他的委托」不合理。 |
| **判断** | 属**内容设定问题**（叙事因果），非引擎缺陷。这与 C8 检守护的「入口与前置不同口径」是**不同**的问题——C8 关心的是「点了必失败」，而这条是「点了会成功，但剧情上不该这时能点」。 |
| **修复方案** | 内容侧收紧：`inspect_wall` 的 `showIf` 加上 `flag.old_guard_met`（即先搭话，再辨认）。注意 `greet_guard` 的 `showIf` 是 `!flag.old_guard_met`，两者天然互补，改后流程为：进镇口 → 搭话（`old_guard_met`）→ 辨认徽记（接任务）。**需同步核对 L2-A 检查里 `inspect_wall` 的 setup 步骤**（现为 `grantInsight`，改后需补 `greet_guard`）。 |
| **归属** | **内容**（`fixtures/mini-game/data/scenes/old_town/town_gate.yaml`）+ 检查用例同步。 |
| **依据** | 实读 `fixtures/mini-game/data/scenes/old_town/town_gate.yaml:17-31`、`fixtures/mini-game/data/quests/wall_rubbing.yaml`。 |

### #10 切英文后部分文案仍是中文

| 项 | 内容 |
|---|---|
| **现象** | 设置里切到 English，界面与叙事大multi变英文，但**部分文案仍为中文**。 |
| **根因** | **两处不同来源**，需分开看：<br>① **引擎内置 `ui.*` 键不在游戏包词典内**——宿主 `game-host.ts` 用的是 `ui.error.no_checkpoint` 等键（grep 出 5 个：`ui.error.internal` / `no_checkpoint` / `not_started` / `unknown_location` / `unknown_shop`），这些是**引擎侧约定键**，设计上应由引擎提供基础词典（属 i18n 边界）；demo 的 en-US 包里没有它们 → 回落到键或中文。<br>② **demo 自持中文硬编码**——标题「旧镇迷雾 · mini-game」、工具条「跳过：关」「回退一步」「历史」「成就」等，以及 `PANEL_TITLES`，都是 demo 里写死的中文（该文件注释已声明「全量 UI i18n 归 25 号 C 组」）。 |
| **判断** | ① 是**设计边界问题**（引擎 UI 键的词典归属未定义），② 是**已知的收尾项**（25C）。 |
| **修复方案** | 分两步：① **规范层**——明确「引擎内置 `ui.*` 键」的词典归属（建议：引擎随包提供基础词典 zh-CN/en-US，宿主合并游戏包词典时以游戏包优先）；② **demo 层**——把硬编码中文提为键（可先只做工具条与标题）。<br>②可与本批 C 类一起做，①建议写成规范条目后再实现。 |
| **归属** | ① **规范 + 引擎**（新增基础词典）；② **demo**。 |
| **依据** | 实读 `packages/runtime-ui/src/app/game-host.ts`（grep `ui\.[a-z_.]*` 得 5 个键）、`apps/player-demo/src/main.tsx:69-77,116,140,258-290,442-469`；`fixtures/mini-game/locales/en-US/` 无 `ui.yaml`。 |

---

## 被证伪的原登记项（重要）

### 原 T-2「`requires` / `showIf` 可见性缺陷」——**不成立**

**原记录**：`accept_survey` 的 `showIf` 为 `flag.ferryman_met && attr.insight >= 3 && quest('wall_rubbing') == 'done'`，
实测 `insight=3`、`ferryman_met=true`、`wall_rubbing` 为 `undefined` 时该选项**仍出现在列表里**。

**本次核实结论：选项实际被正确隐藏。** 实测（构造上述状态后到渡口）：

```
raw      = ["talk_ferryman","accept_survey","report_survey","ask_ferry","to_fish_market","to_embankment","back_town"]
hidden   = [["talk_ferryman",true],["accept_survey",true],["report_survey",true],["ask_ferry",false],...]
visible  = ["ask_ferry","to_fish_market","to_embankment","back_town"]
```

`accept_survey` 与 `report_survey` 的 `hiddenByFilter` 都是 `true`——**渲染层不会显示它们**。

**误报原因**：L2 检查的驱动层 `route-driver.ts` 的 `choices()` 返回的是
`session.choices.map((c) => c.id)`——**未过滤** `hiddenByFilter` 的原始列表（`route-driver.ts:143-146`）。
当时据它判定「选项仍可见」，属**检查工具的假阳性**。

**同时验证**：`questFn` 对未开始任务返回 `undefined`（`builtins.ts:193-196`），
`looseEquals(undefined, 'done')` 返回 `false`（`eval.ts:182-189`，跨类型一律不等）——
**表达式语义完全正确**，无缺陷。

**处置建议**（三条，一并纳入规范）：
1. `route-driver.ts` 的 `choices()` **改为按渲染口径过滤**（与 `OptionList` 一致），
   或拆成 `visibleChoices()` / `rawChoices()` 两个方法，**默认用可见口径**；
2. 凡「选项可见性」的断言**必须用过滤后的列表**——这条写进 `subagent-protocol.md` §6 的检查要点；
3. `open-items.md` 的 T-2 条目标注「已证伪并撤回」。

**方法教训**：这是**第 2 次**由「检查工具自身的口径」导致误判（第 1 次是 T-2 的原判本身）。
检查工具的「与被测系统同口径」应作为检查层建设的一条原则。

---

## 附：修复批次

**派发批次与文件白名单不在此处维护**（避免同一事实两处漂移，约束 1）——
见 `docs/plans/subagent-prompts.md`：批次划分、并行性分析、可直接派发的 prompt 正文。

按人类裁定的顺序：

1. **批 1 —— 真 bug**：#4 / #8 / #9（含 9b / 9c）
2. **批 2 —— 接线遗漏**：#2 / #5 / #6（含 6b）/ #11
3. **批 3 —— UX 与内容 + 规范**：#1 / #3 / #7 / #10
   （其中 #1 组件侧、#6②③ 属组件 UX，可提前到批 1 之后的任意窗口做）
