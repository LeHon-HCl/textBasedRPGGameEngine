# M1 里程碑审查报告

> 依据 `docs/develop.md` 约束 10「里程碑审查」产出。**验收结论待用户人工判定**
> ——AI 不自行宣布里程碑达成。

| 项 | 内容 |
|---|---|
| 里程碑 | M1 运行时 MVP |
| 目标（proposal §7） | 官方 demo：3 区域、10+ 事件、2 条任务线，桌面+移动可玩；zh/en 切换；存档导出导入往返一致 |
| 审查日期 | 2026-09-14 |
| 审查者 | 主 Agent（自检）+ 用户（人工验收，待办） |
| 分支 / PR | `feat/m1-finale` → PR 待建 |

---

## 1. 交付范围

### 已完成模块（14 项中的 13 项，含本轮的 25A 与 M1 收尾）

| 模块 | 交付内容 | PR |
|---|---|---|
| 02 shared Schema | 21 份 Zod schema + JSON Schema 快照守护 | — |
| 05 效果指令 | 25 条作者指令 + 注册表（touch 元数据） | — |
| 06 包加载器 | 七步管线（collect→parse→validate→crossRef→compile→scripts→freeze） | — |
| 08 叙事运行时 | 五相位状态机、宏展开、子会话栈、readonly 回想 | — |
| 09 时间系统 | TimeConfig、推进管线 8 步、作者钩子、日历投影 | PR #2 |
| 10 事件系统 | 池评估（collect/prune/select/dispatch）、脏标记增量、性能基准 | PR #11 |
| 11 任务系统 | QuestMachine 六态机、refs 反查推进、奖励 child 事务 | PR #4 |
| 12 NPC 与阵营 | 日程解析、好感阶段、记忆命名空间、关系投影 | PR #8 |
| 13 物品与服装 | Inventory、装备修正、多层服装冲突、耐久时效 | PR #3 |
| 14 身体与变身 | set_body 校验、临时回退、代词注入 | PR #10 |
| 20 存档系统 | PersistenceAdapter 契约、MemoryAdapter、SaveService、版本闸门 | PR #13 |
| 22 内容过滤 | ContentFilter 三谓词、渲染/选项注入、首启向导数据面 | PR #7 |
| 24 媒体解析 | MediaIntent 流、缺失占位、立绘差分、GameDefinition 发布面 | PR #12 |
| 25 runtime-ui（A 组） | UiStore/AppShell/渲染管线（sanitize）/叙事视图/四面板/Dexie/Toast/向导 | PR #16 |

### 本分支（M1 收尾）新增

| commit | 内容 |
|---|---|
| `c47cd16` | **缺陷修复**：新增 `data/time.yaml` —— 时段窗口失效 |
| `a979e25` | riverside 河畔区域（4 地点 / 7 场景 / 3 事件 / 1 NPC）+ 宿主 `initialWallet`（TDD 红绿） |
| `0afc871` | hillside 山丘区域（3 地点 / 6 场景 / 3 事件）+ 第 2 条任务线 `hillside_survey` |
| `5a5a332` | 规模断言改语义口径 + **缺陷修复**：宿主缺省解锁区域 |
| `7d5b18b` | en-US 英文词典全量对齐（40 文件 / 171 键） |

---

## 2. 门禁证据（约束 10 七项自检）

| # | 检查项 | 命令 | 结果 |
|---|---|---|---|
| 1 | 全量测试 | `npx vitest run` | ✅ **157 文件 / 2289 用例全绿**（M1 起始 1959 → +330） |
| 2 | 覆盖率 | `pnpm -w test:coverage` | ✅ exit 0；All files 94.18% stmts / 85.85% branch / 95.1% funcs / 95.43% lines；shared 98.86%、engine ≥80%、runtime-ui ≥80%、fixtures/helpers 96.68% |
| 3 | 静态检查 | `pnpm -w lint && pnpm -w build && pnpm -w typecheck` | ✅ 全绿（typecheck 0 错误；含 e2e 独立 tsconfig） |
| 4 | 文档一致性 | `node scripts/validate-docs.mjs` | ✅ 全绿（含 architecture.md 子系统覆盖检查） |
| 5 | 文档对账 | `architecture.md` vs `ls packages/engine/src/` | ✅ 见 §3 |
| 6 | 验收 demo（路径覆盖） | 逐条执行 M1 计划 §11 的验收路径 | ⚠️ **9 条路径：4 已验证 / 2 部分 / 3 未验证**（事件触发与任务推进经执行确认不可达）——见 §4 |
| 7 | 遗留登记 | 各任务书「实现记录」与 PR 风险段 | ✅ 见 §5 |

### 夹具规模（M1 验收口径）

| 项 | 要求 | 实测 | 结论 |
|---|---|---|---|
| 区域 | 3 | **3**（old_town / riverside / hillside） | ✅ |
| 事件 | 10+ | **10** | ✅ |
| 任务线 | 2 | **2**（wall_rubbing / hillside_survey） | ✅ |
| 场景 | — | 20 | — |
| NPC | — | 3（old_guard / hawker / ferryman） | — |
| 语言 | zh/en 切换 | **zh-CN 171 键 / en-US 171 键，零缺失** | ✅ |
| 加载健康 | 零诊断 | `diagnostics = []`（无悬空引用/无重复 ID/无目录不一致） | ✅ |

---

## 3. 对账结果（architecture.md vs 代码结构）

| 核对项 | 结论 |
|---|---|
| engine 子系统目录 | 22 个目录（achievements/body/battle/checks/content/economy/effects/events/expr-eval/i18n/items/loader/loop/media/migration/narrative/npcs/persistence/quests/runtime/scripts/state/time）与 `architecture.md §5.1` 索引表一致 |
| runtime-ui 切片 | store/text/narrative/panels/notifications/settings/onboarding/persistence 与 §5.4 一致 |
| 空占位目录 | M2+ 待实现的 achievements/battle/checks/economy/loop/migration/scripts **均有目录无实现**，§5.3 已登记为占位 |
| 已知偏差 | `dexie-adapter.ts` 覆盖率排除（jsdom 无 IndexedDB）、`GameDefinition` 未发布 attrs/contentTags（宿主显式注入补齐）——两项均在 §5.4 与 vitest 配置注释中登记 |

---

## 4. 验收路径覆盖（约束 10 第 6 项）

> **本节写法于 2026-09-15 修订**：原版以「E2E 3/3 绿」笼统代表验收通过，违反约束 10
> 「未覆盖的路径必须显式登记为未验证」。经内容完整性反思报告
> （`docs/retros/content-integrity-postmortem.md`）后按下表逐条登记。

M1 计划（`docs/plans/M1-plan.md` §11 第 3 条）要求的验收路径与实测状态：

| # | 验收路径 | 状态 | 证据 / 原因 |
|---|---|---|---|
| 1 | 新游戏 → 叙事渲染 | ✅ 已验证 | E2E 用例 1（入口段落「石板路」入 DOM）；浏览器实测 |
| 2 | 推进行动 → 选项分支 | ✅ 已验证 | E2E 用例 1（`go_gate` → 镇口 → `go_riverside` → 渡口） |
| 3 | 跨区域移动 | ✅ 已验证 | 同上（`arrival → town_gate → riverside_ferry`） |
| 4 | 语言切换 zh/en | ✅ 已验证 | E2E 用例 2（切 en-US 后叙事文案为英文） |
| 5 | 存/读档 | ⚠️ 部分验证 | 仅验证 IndexedDB 可用（E2E 用例 3）；**写入→读取往返未端到端验证** |
| 6 | 内容过滤生效 | ❌ **未验证** | 无 E2E 用例、无人工实测记录 |
| 7 | 推进时间（时段推进） | ⚠️ 部分验证 | 时间徽标渲染正常；**跨时段推进未验证** |
| 8 | **触发事件** | ❌ **未验证** | **宿主未配置 `eventEval`（时间管线步骤 6），10 条事件全部不触发**（见 §6） |
| 9 | **任务推进** | ❌ **未验证** | **无任何场景调用 `quest: accept`，两条任务线均停在 `undiscovered`**（见 §6） |

**结论**：9 条路径中 **4 条已验证、2 条部分验证、3 条未验证**；
其中第 8、9 条经执行确认**功能不通**（不只是"没测"）。

### 自动化（Playwright）

- **已引入并跑通**：`playwright.config.ts` + `e2e/player-flow.spec.ts`（3 用例）+ `pnpm e2e` 脚本 + `e2e` 独立 tsconfig（DOM lib）。
- **实测结果：3/3 全绿**（约 9–32 秒，`--project=msedge`）：

| 用例 | 断言要点 | 结果 |
|---|---|---|
| 首启向导 → 新游戏 → 跨区域探索 | 向导通过 → 入口渲染（`石板路`）→ 属性名显示「生命」而非 `attrs.hp.name` → `go_gate` → 镇口 → `go_riverside` → 渡口 → 河畔交互选项齐备；**应用级控制台零错误** | ✅ |
| 语言切换 | 设置抽屉语言下拉含 `en-US`（来自 manifest.langs）→ 选中后新游戏叙事文案为英文（`flagstones/Old Town`） | ✅ |
| 存档槽位 | IndexedDB 可用（DexieAdapter 真实环境探测） | ✅ |

> **断言深度缺陷（2026-09-15 记录）**：用例 1 对河畔交互**只断言选项可见、未点击验证结果**——
> 因此 `talk_ferryman` 的 `set npc.ferryman.met` 语法错误（该选项必然抛 `EFFECT_FAILED`）
> 当时完全漏网。约束 10 已据此补充「E2E 必须断言交互结果，禁止只断言可见性」。

> **环境说明**：本机 Playwright 自带 Chromium 二进制下载受网络限制持续失败
> （`chromium_headless_shell` 缺失）。故 `playwright.config.ts` 增加 `msedge`
> project 走**系统 Edge**（同 Chromium 内核，Windows 预装）；`chromium` project
> 保留给能正常下载的环境与 CI。这是配置层的 fallback，非测试降级。

### 人工实测（浏览器）

- ✅ M0 阶段已实测 3 场景分支走通；A 组（PR #16）落地后界面为完整 React 宿主页。
- ✅ 3 区域移动链路实测走通（`arrival → town_gate → riverside_ferry`）、
  属性名与时段徽标渲染正常。
- ❌ 事件触发与任务推进**实测确认不可达**（事件从不发生、任务日志恒空）——
  归因见 §6 与 `docs/retros/content-integrity-postmortem.md`。

**建议的人工验收步骤**：

```
pnpm dev:player            # 启动后访问 http://localhost:5173
1. 新游戏 → 入口场景文本渲染（zh-CN）
2. 推进段落 → 选项出现 → 选「去集市」/「往镇口」
3. 镇口 → 「出镇门去河畔」→ 渡口/渔市/货栈/河堤（4 地点）
4. 与摆渡人搭话（npc.met 置位）→ 渔市「买一尾河鲜」（钱包 -5）
5. 时间推进至傍晚/夜晚（面板或调试入口）→ 触发时段事件
6. 主菜单「设置」切换语言 zh-CN ↔ en-US → 叙事文案切换
7. 存档 → 读档 → 状态一致
8. 内容标签开关（设置面板）→ 相关选项/段落隐藏
```

---

## 5. 遗留与风险

### 本轮修复的 11 个真实缺陷（全部由收尾验收暴露）

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| 1 | **时段窗口失效**：`when.slots`/`at.slots` 与 `TimeConfig.slots[].id` 口径不一致（数据写 `morning`，引擎缺省日历为 `slot_morning`），且夹具无 `data/time.yaml` | **所有事件永不触发、NPC 日程全部落空**——M1「走通事件触发」的致命阻塞 | 新增 `data/time.yaml` 声明与数据一致的时段 id（`c47cd16`） |
| 2 | **钱包读取崩溃**：`wallet` 是表达式封闭域（缺 key 即 EVAL_ERROR），而游戏包无钱包初值声明面 | 任何 `wallet.<currency>` 读取抛错 | 宿主新增 `initialWallet` 选项（TDD 红/绿，`a979e25`） |
| 3 | **缺省解锁区域依赖字典序**：原取 `areas.keys()` 首项 | 多区域下解锁字母序最前的区域（`hillside`）而非玩家起步的 `old_town` | 改为**入口场景所在区域**（语义口径，`5a5a332`） |
| 4 | **未建档 NPC 条件抛错**：`npc.<id>.*` 是封闭域，但宿主未播种 NPC | 新档读 `!npc.ferryman.met` 等条件即抛错 → 跨区域跳转被静默阻断 | 宿主按 NpcDef 播种全部 NPC（`6dd5375`；先试图放宽引擎语义，与 03/12 号刻意测试冲突后回退为宿主播种） |
| 5 | **attrs 词典缺失**：StatusPanel 按 `attrs.<id>.name` 取值，词典无该命名空间 | 界面显示原始键 `attrs.hp.name` | 双语补 `attrs.yaml`（`550a7f8`） |
| 6 | **宿主 textOf 固定 mainLang** | 切换语言后除叙事外的组件文案不变（FR-L10N-05 失效） | 改为按当前 settings.lang 解析（`a5e3a58`） |
| 7 | **设置镜像未预初始化** | 首启向导屏白屏（向导在 start 前读设置 → requireRuntime 抛错） | `settingsMirror` 以缺省设置立即初始化（`5038568`） |
| 8 | **versions() 开局前不可读** | 主菜单打开设置抽屉抛「宿主未启动」 | 改用 `ENGINE_VERSION` 常量（`a410c04`） |
| 9 | **SettingsDrawer 违反 Rules of Hooks**：hook 前提前 `return null` | 「关闭 → 打开」设置抽屉即 `Rendered more hooks` → 整树白屏 | 全部 hook 提到条件返回之前（`a410c04`） |
| 10 | **设置无回流路径**：settingsMirror 是普通变量，受控 select 把改动弹回旧值 | 主菜单改语言无效（面板显示仍为旧值） | 新增 `UiStore.settings` 切片 + `setSettings` 动作（`a410c04`） |
| 11 | **开局丢弃玩家设置** | 主菜单改的语言在开始游戏瞬间被重置 | bootstrap 注入镜像，跨开局保留（`a410c04`） |

> **这 11 个缺陷全部通过了此前的 2287+ 单元测试**——它们属于「模块内行为正确、
> 但跨层口径/时序/React 规则失配」的类型，只有**端到端实测**（约束 10 第 6 项）
> 才能暴露。这是本轮收尾最大的产出，也是里程碑审查机制价值的直接证据。


### 已知妥协与后续依赖

| 项 | 说明 | 后续 |
|---|---|---|
| **判定挂点未演示** | M1 验收要求「覆盖判定挂点」，但判定系统（15 号）属 M2 且未实现（0 文件）。demo 中无判定演示，只有 `check_result` 事件类型预留 | M2 的 15 号实现后补判定演示与 E2E 用例 |
| E2E 环境 | 本机 Chromium 下载受限；已配 msedge project 走系统 Edge | 能联网的环境可 `npx playwright install chromium` 后用默认 project |
| `dexie-adapter.ts` 无单测覆盖 | jsdom 无 IndexedDB，`fake-indexeddb` 未引入 | **已由 E2E 承接真实覆盖**（IndexedDB 可用性用例通过）；或后续补 `fake-indexeddb` |
| 25 号 B/C 组未做 | QoL（跳读/自动/回滚/历史/快捷键）、成就图鉴、调试面板、图鉴/统计/媒体播放器 | 按 plan 属 M2/M4 |
| 模块 20 与 25A 的接口对接 | DexieAdapter 已改为导入 engine 真实类型（本分支 `c9f0bfe` 已完成） | 无遗留 |

---

## 6. 根因与后续（2026-09-15 追加）

本节记录 M1 验收路径中 **3 条「未验证」项**的根因——经执行确认，前两条不是"没测"，
而是**功能不通**；根因分析与改进结论见 `docs/retros/content-integrity-postmortem.md`。

| 未验证项 | 根因（经执行验证） | 归属约束 | 状态 |
|---|---|---|---|
| 触发事件（路径 8） | 宿主 `createGameHost` 构造 `TimePipeline` 时**未配置 `eventEval`**（步骤 6）→ 10 条事件零触发；另 `npc.<id>.met` 恒假使 3 条事件条件永不满足 | 约束 8（接线完整性） | 待修（独立工作项） |
| 任务推进（路径 9） | **无任何场景调用 `quest: accept`**；且 `hillside_survey` 的 `acceptIf` 依赖恒假的 `npc.ferryman.met` | 约束 7（内容连通性） | 待修（独立工作项） |
| 内容过滤生效（路径 6） | 未编写对应 E2E 用例、无人工实测记录 | 约束 10（路径覆盖） | 待补测 |
| 第 3 区域 hillside 不可达 | 全包无 goto 指向 `hillside_trailhead`（入口从未接上） | 约束 7 | 待修 |
| `talk_ferryman` 点击抛错 | `set { key: 'npc.ferryman.met' }` 非法 key 形态（`set` 只接受 attr/flag/counter 与 npc.<id>.flags.<名>），且该校验只在运行期 | 约束 8（加载期校验） | **已修**（`3706fe5`） |

**因此 M1 不能判「通过」**：里程碑目标「3 区域 / 10+ 事件 / 2 任务线可玩」中，
区域数量达标但**事件与任务两条主线功能不通**。建议按下方之一处置（待用户裁定）：

- **方案 A（推荐）**：M1 判「有条件通过」——前提是补齐约束 7/8 的**检查实现**
  （content-graph 测试 + 加载期指令校验 + 宿主接线自检），并用它抓出的清单修完内容断点，
  再重跑验收路径；
- **方案 B**：M1 判「未通过」，把上述断点修复与检查实现合并为一个「M1 补完」工作项，
  完成后再提交审查。

## 7. M1 收尾完成度复核（2026-09-15，按新约束）

约束文档修订完成后，按**新约束 7（内容连通性五检）**对 `fixtures/mini-game` 做机械复核
（临时脚本，BFS 遍历 `goto` 图 + 入口点扫描；正式实现属约束 7 的落地工作项）：

| # | 检查项 | 结果 | 具体缺口 |
|---|---|---|---|
| C1 | 区域可达 | ❌ | 3 区域中 **hillside 不可达**（全包无 `goto` 指向 `hillside_trailhead`） |
| C2 | 事件可触发 | ❌ | 10 条事件中 **3 条不可达**（`ev_quarry_echo` / `ev_shrine_dream` / `ev_trail_wanderer`——均在 hillside）；**另 7 条虽区域可达，但因宿主未接 `eventEval` 仍不会触发**（约束 8 缺口） |
| C3 | 任务可接取 | ❌ | 2 条任务**均无 `quest: accept` 调用点**（`wall_rubbing` / `hillside_survey`） |
| C4 | 结局可达成 | ❌ | 无任何 `ending` 触发点（`quiet_town` 永不可达） |
| C5 | 商店可进入 | ❌ | `market_stall` 在场景中**零引用** |

**场景可达率：7 / 20**（7 个 = old_town 3 场景 + riverside 4 场景；其余 13 个含全部事件场景与 hillside 6 场景）。

**复核结论：M1 收尾未完成。** M1 目标的「3 区域 / 10+ 事件 / 2 任务线」在
**内容数量**上达标（3/10/2），但按新约束 7 的口径，**连通性不达标**——
区域缺 1 个入口、事件缺宿主接线、任务/结局/商店缺触发点。

### 待办清单（按约束归属）

| # | 待办 | 归属约束 | 前置 |
|---|---|---|---|
| 1 | 实现约束 7 的连通性检查（`content-graph.test.ts`，五检进 CI） | 约束 7 | 无 |
| 2 | 实现约束 8 的加载期指令校验（`validateArg` 钩子 + 加载器挂载） | 约束 8 | 设计已就绪（§3.3/§7.7） |
| 3 | 实现约束 8 的宿主接线自检（`eventEval` 缺失告警） | 约束 8 | 无 |
| 4 | 修内容断点：hillside 加入口、任务加 `accept` 调用点、结局加触发点、商店加入口 | 约束 7 | 建议先做 1（否则无法验证） |
| 5 | 修 `npc.<id>.met` 能力缺口（补写入口指令，或全部改用 flag 表达） | 约束 8 第 3 条 | 需设计裁定 |
| 6 | 补 E2E：事件触发、任务推进、内容过滤三条路径（断言交互结果） | 约束 10 | 待 1–5 完成后 |

> 建议顺序：**1 → 3 → 5 → 4 → 6**（先有检查、再有修复、最后补验收路径）；
> 第 2 项可在 1 之后并行。以上均为**独立工作项，需用户批准后排期**（约束 2 精神）。

## 8. 验收结论

```
[x] 待人工验收（§7 复核结论：M1 收尾未完成，不具备"通过"条件）
[ ] 通过
[ ] 有条件通过（附条件）
```

**结论依据**：§7 按新约束 7 的机械复核显示 5 项连通性检查**全部不达标**
（区域缺 1 入口、事件缺宿主接线、任务/结局/商店无触发点），
故 M1 **当前不可判通过**——不是"待测"，是"功能不通"。

**待用户裁定事项**：

1. **处置方案**（§6 已列出）：方案 A「有条件通过」（前提是补齐约束 7/8 的检查实现
   并修完断点后重跑验收）vs 方案 B「未通过，合并为 M1 补完工作项」。
2. **§7 待办清单排期**：6 项待办（检查实现 2 项、修复 4 项）是否批准开工、按何顺序
   （建议 1 → 3 → 5 → 4 → 6）。
3. **判定挂点**（§5）处置方式：M1 目标含"判定挂点"，但 15 号判定系统属 M2 且未实现——
   建议登记为 M2 内容，不计入 M1。
4. 完成上述修复并重跑验收路径后，由**用户**（非 AI）勾选 `docs/tasks/progress.md`
   的 M1 里程碑项并写入验收记录（约束 10 明确要求）。
