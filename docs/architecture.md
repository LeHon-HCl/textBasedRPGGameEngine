# 项目架构（as-built）

> **本文档是「已实现架构」的权威描述**：完整反映当前代码的逻辑架构，随代码变更同步更新（维护规则见文末）。
> 设计意图与决策依据见 `docs/detail-design.md`（引用格式 §x.y / DD-nn）；需求见 `docs/proposal.md`；进度见 `docs/tasks/progress.md`。
> 最后核对：2026-09-13，对应 main@b99e9ba（M0 完成态）。

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

核心运行时；只依赖 shared + immer / jsep / yaml / zod。六个子系统经 `src/index.ts` 统一 re-export。

### 3.1 state/ —— 状态树与事务底座（设计 §3.1，04 号）

- **game-state.ts**：`GameState` 状态树（attrs / flags / bag / outfit / npcs / quests / seen / checkpoints / world.time 等）。
- **new-game.ts**：`newGameState()` + bootstrap（新档初始化，接受清单驱动的初始值）。
- **derived.ts**：`recomputeDerived()` 派生属性重算；`DERIVED_TRIGGER_DOMAINS` 声明哪些域变化触发重算。
- **expr-scope.ts**：`buildExprScope()`——GameState → 表达式求值作用域的投影（含 `MetaView` / `TimeViewProvider` 缝）。
- **serialize.ts**：`serializeState()` / `restoreState()`，经 shared `serializedStateSchema` 校验（20 号存档的地基）。

### 3.2 expr-eval/ —— 表达式语言与求值器（设计 §3.2，03 号）

- **parse.ts** `parseExpr()`（自研解析器）、**compile.ts** `compileExpr()`（→ `CompiledExpr`，带缓存）、**eval.ts** `evalExpr()` / `evalCondition()` / `truthy()`、**paths.ts**（`EXPR_ROOTS` 状态访问白名单根）、**builtins.ts**（`createBuiltinFunctionRegistry` 内置函数表）。

### 3.3 runtime/ —— 状态事务核心（设计 §3.1）

- **game-runtime.ts**：`GameRuntime` 类——immer draft 之上实现 `TransactionFrame`（jumps / events / patches 合并提交），支持子事务与 `checkpoint(label)` 快照栈（超限丢最旧并发出 snapshot_warn 事件）。
- **exec-context.ts**：**核心抽象** `ExecContext` / `ExecOutcome`（含 `JumpTarget`）——效果执行与叙事跳转的统一通道；`EffectExecutor` 接口与 `EffectContext` 亦定义于此。
- **engine-events.ts**：`EngineEvent` 事件集（StatChanged / Unlock / Notify / Media / FavorStageChanged / ReputationBandChanged / CheckResult / SnapshotWarn…），订阅式外泄 UI。
- **perf-guard.ts**：`PERF_GUARD` 性能预算常量（NFR-02）。

### 3.4 effects/ —— 效果指令系统（设计 §3.3，05 号）

- **registry.ts**：`EffectRegistry implements EffectExecutor`——指令注册、参数 Zod 校验、重复 ID 冲突检测。
- **types.ts**：`EffectInstructionDef`（schema / touch / execute 三件套）、`TouchReport`（事务触域报告，供增量重算）、`eraseDef`；`CheckRequest / CheckRule / CheckRuleResolver` 为 15 号判定系统预留的规则缝。
- **builtins/**（7 文件 25 条指令）：state（set/add/flag/money）、items（give/take/equip/unequip/wear/remove）、relations（favor/reputation）、flow（goto/back/ending/loop_transition）、system（advance_time/quest/unlock/notify/media）、adversarial（check/battle/set_body）、util（call）。`createBuiltinEffectRegistry()` 装配全量。

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

### 3.7 narrative/ —— 叙事运行时（设计 §4.2，08 号）

- **scene-runner.ts**：`SceneRunner` 五相位状态机（`entering → await_advance → await_choice → resolving → finished`）；`renderList()` 产出 `RenderSegment` 段落流；`choices()` 产出置灰过滤后的 `ChoiceView`；`choose()` 消费 `ExecOutcome.jumps` 完成跳转。
  - `SUBSESSION_DEPTH_LIMIT = 3`：事件场景子会话挂起栈（深度超限发 warning）。
  - `NARRATIVE_HISTORY_CAPACITY = 500`：环形历史缓冲（回想/回看数据源）。
  - readonly 会话：回想重放，无副作用。
- **macros.ts**：三种叙事宏 `FirstAgainMacro` / `ConditionalMacro` / `RandomMacro` + 惰性展开（延迟插值）。

## 4. 应用层（apps/）

- **player-demo**（`src/main.ts`）：M0 验收用 vanilla TS 页面。数据流：Vite `import.meta.glob(?raw)` 读 fixtures/mini-game → `InMemoryPackageSource` → `loadGamePackage` → `newGameState` + `GameRuntime` → `SceneRunner` + `TextResolver` 端到端渲染。是 runtime-ui（25 号）落地前的接线参考。
- **editor-app**：占位页（26 号）。

## 5. 测试体系

- 位置约定（vitest）：`packages/<pkg>/test/**/*.test.ts`，node 环境；workspace 包经 vitest alias 解析到**源码**（CI 不构建 dist）。
- 组织：engine/test 按子系统分目录（expr-eval 12、effects 12、loader、i18n 7、narrative 12、runtime 8、state 3、smoke）；shared/test 按 schema 10 + 基础。每目录有 `fixtures.ts` 局部夹具；跨包夹具在 fixtures/helpers 包。
- 规模（M0 完成态）：77 个测试文件 / 1544 个用例全绿。
- 覆盖率门禁（v8）：shared ≥ 90%，engine ≥ 80%。

## 6. 质量门禁与工具链

- **CI**（`.github/workflows/ci.yml`）：install(--frozen-lockfile) → `pnpm -w lint && pnpm -w test` → `node scripts/validate-docs.mjs`。
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
