# 项目架构（as-built）

> **本文档是「已实现架构」的权威描述**：完整反映当前代码的逻辑架构，随代码变更同步更新（维护规则见文末）。
> 设计意图与决策依据见 `docs/detail-design.md`（引用格式 §x.y / DD-nn）；需求见 `docs/proposal.md`；进度见 `docs/tasks/progress.md`。
> 最后核对：2026-09-14，对应 feat/22（内容分级与过滤机制，M1）。

## 1. 总览

`text-based-rpg-game-engine`：纯前端文字 RPG 引擎，pnpm monorepo（pnpm@10.34.5，Node ≥20，TS ES2022 / NodeNext / strict 全开）。

```
┌──────────────────────────── 仓库布局 ────────────────────────────┐
│ packages/shared      @game/shared     类型/Schema/规则单一来源     │
│ packages/engine      @game/engine     核心运行时（无 React/DOM）   │
│ packages/runtime-ui  @game/runtime-ui 玩家界面组件库（占位，25 号） │
│ packages/editor      @game/editor     可视化编辑器（占位，26 号）   │
│ packages/exporter    @game/exporter   导出分发（占位，27 号）       │
│ apps/player-demo     player-demo      M0 验收用最小可玩页          │
│ apps/editor-app      editor-app       编辑器宿主页（占位）          │
│ fixtures/mini-game   正例游戏包夹具（约 60 个 YAML）                │
│ fixtures/negatives/  5 个单缺陷负例包（每包一个预期 ErrCode）        │
│ fixtures/helpers/    跨包测试夹具包（InMemoryPackageSource 等）      │
└──────────────────────────────────────────────────────────────────┘
```

### 包依赖规则（设计 §1.2，ESLint flat config 强制）

| 规则 | 内容 | 强制手段 |
|---|---|---|
| R1 | shared 零包依赖（仅放行 zod），是类型与规则的唯一来源 | eslint `no-restricted-imports` + package.json |
| R2 | engine 只依赖 shared；禁 React、禁 DOM/BOM 全局 | eslint import 限制 + env 白名单 |
| R3 | 禁止深路径导入：包外只能 `import from '@game/<pkg>'` | eslint（各包 src/index.ts 是唯一出口） |
| R4 | shared/engine 源码禁裸 `throw new Error`，必须抛 `EngineError`（code/where/messageKey，NFR-23） | eslint |
| R5 | engine 子系统间禁止横向 import，只允许三种交互：事务、EngineEvent、时间管线编排（DD-06） | eslint |

```
mermaid 等价依赖图：
apps/* ──> runtime-ui(未来) ──> engine ──> shared
editor ──> exporter ──> engine/shared
engine 内部：loader → (state, effects, expr) ；narrative → (state, runtime, i18n)
content 为纯谓词子系统（仅依赖 shared，无横向 import）；narrative 经结构化最小接口注入，不 import content。
```

## 2. shared 包（`packages/shared/src/`）

唯一出口 `index.ts`；零运行时依赖（仅 zod）。

- **ids.ts**：`GameId` / `Lang` / `TextKey` / `RefKind`、`refId()`、`GAME_ID_PATTERN`——全库 ID 规范的源头。
- **errors.ts**：`EngineError`（`code` / `where` / `messageKey` 三元组）、`ErrCode` 枚举、`serializeError`。全库唯一异常类型。
- **expr.ts**：表达式语言规格类型（`ExprNode` / `CompiledExpr` / `EvalContext` / `ExprScope` / `ExprFunctionRegistry` 等，DD-01）——engine 的 expr-eval 按此实现。
- **rng.ts**：`createRng` / `Rng`——注入式随机（DD-09），状态可序列化进存档。
- **schema/**（22 个域文件）：全部数据域的 Zod schema——manifest、scene、area、attrs、event、quest、npc、faction、item、body、shop、perk、achievement、ending、loop、tags、stats-page、save、profile、effects、common 等。02 号模块产物，兼作 JSON Schema 导出基线（快照测试锁定）。
- **validation/**：跨域校验辅助。

## 3. engine 包（`packages/engine/src/`）

核心运行时；只依赖 shared + immer / jsep / yaml / zod。各子系统经 `src/index.ts` 统一 re-export。

### 3.1 state/ —— 状态树与事务底座（设计 §3.1，04 号）

- **game-state.ts**：`GameState` 状态树（attrs / flags / bag / outfit / npcs / quests / seen / checkpoints / world.time 等）。
- **new-game.ts**：`newGameState()` + bootstrap（新档初始化，接受清单驱动的初始值）。
- **derived.ts**：`recomputeDerived()` 派生属性重算；`DERIVED_TRIGGER_DOMAINS` 声明哪些域变化触发重算。
- **expr-scope.ts**：`buildExprScope()`——GameState → 表达式求值作用域的投影（含 `MetaView` / `TimeViewProvider` 缝）。
- **serialize.ts**：`serializeState()` / `restoreState()`，经 shared `serializedStateSchema` 校验（20 号存档的地基）。

### 3.2 expr-eval/ —— 表达式语言与求值器（设计 §3.2，03 号）

- **parse.ts** `parseExpr()`（自研解析器）、**compile.ts** `compileExpr()`（→ `CompiledExpr`，带缓存）、**eval.ts** `evalExpr()` / `evalCondition()` / `truthy()`、**paths.ts**（`EXPR_ROOTS` 状态访问白名单根）、**builtins.ts**（`createBuiltinFunctionRegistry` 内置函数表）。

### 3.3 runtime/ —— 状态事务核心（设计 §3.1）

- **game-runtime.ts**：`GameRuntime` 类——immer draft 之上实现 `TransactionFrame`（jumps / events / patches 合并提交），支持子事务与 `checkpoint(label)` 快照栈（超限丢最旧并发出 snapshot_warn 事件）。事务后置派生器 `TransactionDeriver`（`derivers` 选项，§4.5 任务状态机首用）：指令全部执行后、提交前按本次补丁路径（`touched`）调用，状态变更 / 事件 / 子效果并入同一事务（原子性不变，11 号）。
- **exec-context.ts**：**核心抽象** `ExecContext` / `ExecOutcome`（含 `JumpTarget`）——效果执行与叙事跳转的统一通道；`EffectExecutor` 接口、`EffectContext` 与 `TransactionDeriver` / `TransactionDeriveContext` 亦定义于此。
- **engine-events.ts**：`EngineEvent` 事件集（StatChanged / Unlock / Notify / Media / FavorStageChanged / ReputationBandChanged / CheckResult / SnapshotWarn…），订阅式外泄 UI。
- **perf-guard.ts**：`PERF_GUARD` 性能预算常量（NFR-02）。

### 3.4 effects/ —— 效果指令系统（设计 §3.3，05 号）

- **registry.ts**：`EffectRegistry implements EffectExecutor`——指令注册、参数 Zod 校验、重复 ID 冲突检测。
- **types.ts**：`EffectInstructionDef`（schema / touch / execute 三件套）、`TouchReport`（事务触域报告，供增量重算）、`eraseDef`；`CheckRequest / CheckRule / CheckRuleResolver` 为 15 号判定系统预留的规则缝。
- **builtins/**（7 文件 25 条作者可见指令 + 4 条内部指令 `__time.advance` / `__outfit.save_preset` / `__items.tick` / `__quest.deadline`）：state（set/add/flag/money）、items（give/take/equip/unequip/wear/remove）、relations（favor/reputation）、flow（goto/back/ending/loop_transition）、system（advance_time/quest/unlock/notify/media）、adversarial（check/battle/set_body）、util（call）。`createBuiltinEffectRegistry()` 装配全量。quest 指令自 11 号起全量委托 `QuestMachine`（accept 校验 / advance / complete→submit 奖励 / fail）。

### 3.5 loader/ —— 游戏包加载器（设计 §3.4，06 号）

七步管线 **`pipeline.ts` `loadGamePackage()`**（DD-02）：

```
1 collect   扫描 scenes/<areaId>/<sceneId>.yaml 目录聚合（PackageSource 抽象）
2 parse     YAML → 对象
3 validate  逐域 Zod 校验 + DUP_ID / 语言包检查
4 crossRef  refKind 元数据驱动的悬空引用检查（DANGLING_REF）
5 compile   表达式编译缓存 / PoolIndex / refs 反查表 / mediaCatalog
6 scripts   宿主 ScriptModule 注入 → x.* 调用校验 → 冻结
7 freeze    deepFreeze → 不可变 GameDefinition
```

- 诊断分两类：error **阻断加载**；warning 进入 `definition.diagnostics` 随包携带。
- 负例包（fixtures/negatives）逐一对应预期 `ErrCode`，是管线的回归夹具。

### 3.6 i18n/ —— 文本解析与本地化运行时（设计 §4.1，07 号）

- **text-resolver.ts**：`createTextResolver()` → `TextResolver`——主语言 + 回退链、`{插值}`、文本变体（`alt first` / `again` 首次/重复差异）；`extractPlaceholderPaths()` 支撑翻译覆盖率。
- **translation-stats.ts**：`collectTranslationStats()` 翻译覆盖率统计。

### 3.7 items/ —— 物品与装备（设计 §4.7，13 号）

- **inventory.ts**：Inventory 纯函数集 `bagGive/bagTake/bagCount/bagSplit/bagMerge`——堆叠封顶（可堆叠条目 count ≤ stack，不可堆叠每件独占条目）、容量按条目数计（新建条目整体校验）、失败统一 EFFECT_FAILED；give/take 等指令层与 UI 投影共用。
- **equip.ts**：`equipModDetails()` 装备修正明细投影（FR-STAT-03 面板）。修正本体（`ItemDef.equipMods`）在 `state/derived.ts` 重算时按目标属性分组求和并入 `player.derived`（残影清理防重复累计）。
- **tick.ts + `__items.tick`**：耐久/时效 tick 挂时间管线步骤 2（`createItemTickProvider`）——时效按累计穿着时段（`expiresAfterSlots`）、耐久按跨天递减（`garment.durability`），触发 `item_expired` 事件并清除 `player.wornMeta`（只报一次）；引擎不自动脱下，后果由作者订阅事件决定。
- **projection.ts**：`projectBag()` 背包 UI 投影——按种类聚合、关键道具分区、id/count 排序、itemId+本地化名称搜索、容量信息。
- 换装预设：`player.outfitPresets`（设计偏差：§4.7 原定 world.flags，但 flag 值域仅标量）+ 内部指令 `__outfit.save_preset` 保存、`wear{preset}` 差量应用（缺件失败、单事务原子）。

### 3.8 narrative/ —— 叙事运行时（设计 §4.2，08 号）

- **scene-runner.ts**：`SceneRunner` 五相位状态机（`entering → await_advance → await_choice → resolving → finished`）；`renderList()` 产出 `RenderSegment` 段落流；`choices()` 产出置灰过滤后的 `ChoiceView`；`choose()` 消费 `ExecOutcome.jumps` 完成跳转。
  - `SUBSESSION_DEPTH_LIMIT = 3`：事件场景子会话挂起栈（深度超限发 warning）。
  - `NARRATIVE_HISTORY_CAPACITY = 500`：环形历史缓冲（回想/回看数据源）。
  - readonly 会话：回想重放，无副作用。
  - 内容过滤注入（22 号）：`contentFilter?: NarrativeContentFilter` 可选注入——段落渲染前占位替换/跳过、`choices()` 标签过滤收敛单点；缺省不注入时行为与 08 号一致。
- **macros.ts**：三种叙事宏 `FirstAgainMacro` / `ConditionalMacro` / `RandomMacro` + 惰性展开（延迟插值）。

### 3.8 time/ —— 时间系统与推进管线（设计 §4.3，09 号）

- **clock.ts**：`advanceClock()` 推进纯函数（slot → day → week → month 递进，返回跨天/跨周/跨月旗标）；`weekdayIndex()` / `dayOfMonth()` 日历基元；`DEFAULT_TIME_CONFIG` 宿主缺省日历（4 时段 × 7 天 × 周日起算，无月历）。week 恒启用；month 仅 `config.months` 启用时写入（循环月序，无年概念）。
- **calendar.ts**：`projectCalendar()` 日历 UI 投影纯函数（FR-TIME-05）；`createTimeViewProvider()` TimeConfig 校准的求值视图（`time.slot` = 时段 id、`time.weekday` = 星期序），经 `GameRuntimeOptions.timeViewProvider` 装配。
- **pipeline.ts**：`TimePipeline.advance(slots)` **固定次序推进管线**（DD-10）：`0 before_rollover → 1 时钟推进 → 2 状态 tick → 3 临时身体回退 → 4 day_rollover → 5 NPC 日程 → 6 事件评估 → 7 任务截止`。一次推进 = 一次 `runtime.exec` 事务 = 一个 undo 点（中途抛错整批回滚）。步骤 2/3/5/6/7 以槽位钩子注入（13/14/12/10/11 号挂载点；步骤 7 由 11 号 `createQuestDeadlineProvider` 提供 `__quest.deadline` 内部指令，在推进后时钟上做 failWhen 全量判定）；作者钩子只有 `beforeRollover` / `dayRollover` 两个前后缀槽位（跨天门控），不可插入中间。
- **内部指令 `__time.advance`**（effects/builtins/system.ts）：时钟写入的事务内载体，作者包内不可达（effectDataSchema 拒绝）；需要 `EffectRegistryOptions.timeConfig`。
- **共享 schema**：`timeConfigSchema`（shared/schema/time.ts，`data/time.yaml` 可选单对象域 → `GameDefinition.time`）；`advance_time` 指令只产 `JumpTarget.advanceTime` 意图，宿主消费后归约到 `TimePipeline.advance()`；移动消耗（`location.moveCost`，FR-XPLR-02）同径归约。

### 3.9 quests/ —— 任务系统（设计 §4.5，11 号）

- **transitions.ts**：六态（undiscovered / available / active / ready_to_submit / done / failed）+ 迁移规则表 `QUEST_TRANSITIONS`、`canTransition` / `transitionVias` / `assertTransition`（表驱动；非法迁移 EFFECT_FAILED，detail 可读）。
- **quest-machine.ts**：`QuestMachine`——与 runtime 解耦的纯状态机（经 `QuestContext` 在调用方事务 draft 上操作，DD-06 / R5）：
  - `accept`：状态门 + conflicts（对方 active/ready 互斥）+ requires（须 done）+ acceptIf 校验矩阵（拒绝原因可读，FR-QUEST-04）；
  - `advance` / `complete` / `fail`：显式迁移入口（`complete` 在 ready_to_submit 走 `submit` 结算，active 走强制完成兼容 05 号）；
  - `submit`：ready_to_submit → done，rewards 经 `ctx.child` 在同一 draft 原子执行（失败整批回滚，任务保持 ready_to_submit）；
  - `evaluateTouched`：`questRefs` 反查表（compile 产物）将条件表达式归一化为状态路径前缀，按事务补丁路径（TouchReport）判定受影响任务——命中即评估、未命中零求值（不轮询，NFR-02）；阶段可级联推进，末阶段达成 → ready_to_submit；
  - `evaluateFailures`：时间管线步骤 7 的全量 failWhen 扫描（`__quest.deadline` 载体，含时间截止）；
  - `progress`：FR-QUEST-05 目标进度投影（阶段 → objectiveKey/complete/value）。
- **deriver.ts**：`createQuestDeriver` 将 `evaluateTouched` 注册为 `GameRuntime.derivers`；`createQuestConditionEvaluator` 为缺省条件求值器（compileExpr 缓存 + buildExprScope + evalExpr）。
- **deadline.ts**：`createQuestDeadlineProvider`——时间管线步骤 7 钩子，产出 `__quest.deadline` 内部指令。
- **projection.ts**：`projectQuestLog`（FR-QUEST-03：按状态分组 + 追踪置顶；追踪为 UI 状态，引擎只投影）。
- 事件面：`quest_stage`（阶段推进，on_stage）与 `quest_state_changed`（六态迁移）加入 EngineEvent。QuestDef 无 on_* 效果字段，作者经事件订阅实现「状态变化触发效果」（on_accept / on_done / on_fail 的作者侧等价物）。

### 3.10 content/ —— 内容分级与过滤（设计 §5.8，22 号）

- **filter.ts**：`ContentFilter` 单点纯谓词（构造时快照 `settings.disabledTags` + 可选占位键；实例不可变，设置变更靠重建实例即时生效，FR-CGRD-03）：
  - `passes(tags)`：无标签恒放行，任一标签被玩家关闭即屏蔽（多标签取「任一命中」；引擎不解释标签语义，中立性红线，FR-CGRD-01/02）；
  - `eventAdmissible(event)`：应用点 1 的事件池 prune 判据（真正接线归 10 号事件系统；本模块接口预留 + 桩测试，接入零改动换实现）；
  - `placeholderFor(tags)`：应用点 2 的占位文本键（游戏配置；未配置返回 null → 调用方跳过）；放行时返回 null；
  - `initialDisabledTags()`：由 `ContentTagsDef.defaultOn` 投影初始禁用集，供首启向导/设置面板初始化（FR-CGRD-04 数据支撑）。
- **wizard.ts**：`contentWarningKey(manifest)` / `resolveContentWizard(settings, manifest)`——首启内容向导数据投影（FR-CGRD-04，§6.5）：读 `GameDefinition.manifest.contentWarning`（shared `manifestSchema` 可选字段，缺省 → null）并组合 `settings.wizardDone` 返回宿主可用值；引擎不承载向导 UI 流程。
- **应用点接线（2/3）**：`SceneRunnerOptions.contentFilter`（结构化最小接口 `NarrativeContentFilter`，避免 narrative → content 横向 import，DD-06）——段落渲染前按**场景标签**占位替换/跳过（被跳过的屏蔽内容不入历史缓冲），`choices()` 的标签过滤收敛本单点。**缺省不注入 = 08 号既有行为逐字不变**（选项沿用 `settings.disabledTags` 直查）。
- **边界**：任务可完成性属静态校验——26 号编辑器 `filter-quest-break` 可达性分析（detail-design §7.7），运行时不管控（§5.8 末段）。

## 4. 应用层（apps/）

- **player-demo**（`src/main.ts`）：M0 验收用 vanilla TS 页面。数据流：Vite `import.meta.glob(?raw)` 读 fixtures/mini-game → `InMemoryPackageSource` → `loadGamePackage` → `newGameState` + `GameRuntime` → `SceneRunner` + `TextResolver` 端到端渲染。是 runtime-ui（25 号）落地前的接线参考。
- **editor-app**：占位页（26 号）。

## 5. 测试体系

- 位置约定（vitest）：`packages/<pkg>/test/**/*.test.ts`，node 环境；workspace 包经 vitest alias 解析到**源码**（CI 不构建 dist）。
- 组织：engine/test 按子系统分目录（expr-eval、effects、loader、i18n、narrative、content、runtime、state、time、items、quests、smoke）；shared/test 按 schema + 基础。每目录有 `fixtures.ts` 局部夹具；跨包夹具在 fixtures/helpers 包。
- 规模（22 号内容分级入库后）：109 个测试文件 / 1788 个用例全绿。
- 覆盖率门禁（v8）：shared ≥ 90%，engine ≥ 80%。

## 6. 质量门禁与工具链

- **CI**（`.github/workflows/ci.yml`）：install(--frozen-lockfile) → `pnpm -w lint && pnpm -w test && pnpm -w build && pnpm -w typecheck` → `node scripts/validate-docs.mjs`。
- **lint**：eslint flat config（依赖规则 R1–R5）+ prettier check。
- **validate-docs.mjs**（零依赖）：必需文档非空/一级标题、无 TODO 占位、代码围栏闭合、FR/NFR/OQ 交叉引用一致（proposal 为权威）、DD 决策自洽、FR 模块覆盖率 100%、tasks checkbox 与 progress.md 登记一致。
- **开发流程**：见 `docs/develop.md`（主线保护 / TDD / PR 自审清单 / 文档同步）。

## 7. 维护规则（随代码变更更新本文档）

发生以下任一变更时，**同一 PR 内**必须更新本文档对应小节（约束见 `docs/develop.md` 约束 4）：

| 变更 | 必须更新的小节 |
|---|---|
| 新增/变更包或目录 | §1 布局与依赖规则 |
| shared 新增/变更类型域或 Schema | §2 |
| engine 新增/变更子系统、核心类型、导出面 | §3 对应小节（必要时 §1 依赖图） |
| 新增/删除效果指令 | §3.4 指令清单 |
| 加载管线步骤增删或次序调整 | §3.5 管线图 |
| 新增应用（apps）或数据流 | §4 |
| 测试组织/覆盖率门禁变化 | §5 |
| CI/lint/文档门禁变化 | §6 |

每次更新在文首「最后核对」行登记对应 commit 与里程碑状态。
