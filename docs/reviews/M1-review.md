# M1 里程碑审查报告

> 依据 `docs/develop.md` 约束 5「里程碑审查」产出。**验收结论待用户人工判定**
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

## 2. 门禁证据（约束 5 七项自检）

| # | 检查项 | 命令 | 结果 |
|---|---|---|---|
| 1 | 全量测试 | `npx vitest run` | ✅ **157 文件 / 2287 用例全绿**（M1 起始 1959 → +328） |
| 2 | 覆盖率 | `pnpm -w test:coverage` | ✅ exit 0；All files 94.18% stmts / 85.85% branch / 95.1% funcs / 95.43% lines；shared 98.86%、engine ≥80%、runtime-ui ≥80%、fixtures/helpers 96.68% |
| 3 | 静态检查 | `pnpm -w lint && pnpm -w build && pnpm -w typecheck` | ✅ 全绿（typecheck 0 错误；含 e2e 独立 tsconfig） |
| 4 | 文档一致性 | `node scripts/validate-docs.mjs` | ✅ 全绿（含 architecture.md 子系统覆盖检查） |
| 5 | 文档对账 | `architecture.md` vs `ls packages/engine/src/` | ✅ 见 §3 |
| 6 | 验收 demo | `pnpm dev:player` 走通 3 区域 / 10+ 事件 / 2 任务线 | ⏳ 见 §4（Playwright 引入中，浏览器实测待办） |
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

## 4. 验收 demo 状态

### 自动化（Playwright）

- **已引入**：`playwright.config.ts` + `e2e/player-flow.spec.ts`（3 个用例：新游戏→推进→分支；存/读档；语言切换）+ `pnpm e2e` 脚本 + `e2e` 独立 tsconfig（DOM lib）。
- **未执行**：Chromium 二进制下载在当前网络环境下持续失败（多次重试 + 清锁无效），因此**本轮 E2E 未实际跑通**。CI 四门禁亦未纳入 E2E（设计上按里程碑手动触发）。

> **这是本里程碑最主要的未完成项**，需在人工验收前补跑：`npx playwright install chromium && pnpm e2e`。

### 人工实测（浏览器）

- ✅ 此前 M0 阶段已实测 3 场景分支走通；A 组（PR #16）落地后界面为完整 React 宿主页（含状态/地图/任务/设置面板）。
- ⏳ **本轮扩充后的 3 区域/10 事件/2 任务线尚未人工实测**——需用户按下方步骤验收。

**建议的人工验收步骤**：

```
pnpm dev:player            # 启动后访问 http://localhost:5173
1. 新游戏 → 入口场景文本渲染（zh-CN）
2. 推进段落 → 选项出现 → 选「去集市」/「往镇口」
3. 镇口 → 「出镇门去河畔」→ 渡口/渔市/货栈/河堤（4 地点）
4. 与摆渡人搭话（npc.met 置位）→ 渔市「买一尾河鲜」（钱包 -5）
5. 时间推进至傍晚/夜晚（面板或调试入口）→ 触发时段事件
6. 设置面板切换语言 zh-CN ↔ en-US → 全界面文案切换
7. 存档 → 读档 → 状态一致
8. 内容标签开关（设置面板）→ 相关选项/段落隐藏
```

---

## 5. 遗留与风险

### 本轮修复的三个真实缺陷（均由收尾工作暴露）

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| 1 | **时段窗口失效**：`when.slots`/`at.slots` 与 `TimeConfig.slots[].id` 口径不一致（数据写 `morning`，引擎缺省日历为 `slot_morning`），且夹具无 `data/time.yaml` | **所有事件永不触发、NPC 日程全部落空**——M1「走通事件触发」的致命阻塞 | 新增 `data/time.yaml` 声明与数据一致的时段 id（`c47cd16`） |
| 2 | **钱包读取崩溃**：`wallet` 是表达式封闭域（缺 key 即 EVAL_ERROR），而游戏包无钱包初值声明面 | 任何 `wallet.<currency>` 读取抛错 | 宿主新增 `initialWallet` 选项（TDD 红/绿，`a979e25`） |
| 3 | **缺省解锁区域依赖字典序**：原取 `areas.keys()` 首项 | 多区域下解锁字母序最前的区域（`hillside`）而非玩家起步的 `old_town` | 改为**入口场景所在区域**（语义口径，`5a5a332`） |

> 缺陷 1 尤其值得注意：**单元测试全绿也未能发现**（每个模块单独测都正确，是夹具数据与引擎缺省值的口径错配）。这正是约束 5 第 6 项「验收 demo」不可替代的原因。

### 已知妥协与后续依赖

| 项 | 说明 | 后续 |
|---|---|---|
| **判定挂点未演示** | M1 验收要求「覆盖判定挂点」，但判定系统（15 号）属 M2 且未实现（0 文件）。demo 中无判定演示，只有 `check_result` 事件类型预留 | M2 的 15 号实现后补判定演示与 E2E 用例 |
| E2E 未跑通 | Chromium 下载失败（见 §4） | 网络可用时执行 `pnpm e2e` 补证据 |
| `dexie-adapter.ts` 无单测覆盖 | jsdom 无 IndexedDB，`fake-indexeddb` 未引入 | 已由 E2E 承接真实覆盖；或后续补 `fake-indexeddb` 依赖 |
| 25 号 B/C 组未做 | QoL（跳读/自动/回滚/历史/快捷键）、成就图鉴、调试面板、图鉴/统计/媒体播放器 | 按 plan 属 M2/M4 |
| 模块 20 与 25A 的接口对接 | DexieAdapter 已改为导入 engine 真实类型（本分支 `c9f0bfe` 已完成） | 无遗留 |

---

## 6. 验收结论

```
[x] 待人工验收
[ ] 通过
[ ] 有条件通过（附条件）
```

**待用户确认事项**：

1. 按 §4 的步骤在浏览器实测 3 区域/10 事件/2 任务线（或先补跑 `pnpm e2e`）。
2. 确认 §5「判定挂点未演示」的处置方式（推荐：M1 通过并在 M2 补判定演示）。
3. 确认验收通过后，由**用户**（非 AI）勾选 `docs/tasks/progress.md` 的 M1 里程碑项并写入验收记录（约束 5 明确要求）。
