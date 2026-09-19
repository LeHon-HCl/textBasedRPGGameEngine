# M2 开发计划 —— 判定战斗 + 成就周目 + QoL

> 目标（proposal §7）：**demo 含战斗遭遇与骰子呈现；10+ 成就、3+ Perk；「同存档进入第二周目且继承清单生效」用例通过；回滚 5 步状态一致**。
> 本计划按 `docs/develop.md` 约束 5 组织：每阶段严格分「开发目标 / 影响面 / commit 拆分 / 验收效果」四节。
> 全局流程（分支-PR-合入、TDD、注释规范、文档同步）见 `docs/develop.md`，本计划不重复。
> 拆分依据：`docs/tasks/15~25` 各任务文件（子任务原文）+ `docs/detail-design.md` §5.1–5.5 / §5.9 / §6。
> 裁剪原则（proposal §7）：M2 内部按「判定→战斗→成就周目→QoL」再拆分交付——本计划据此分六阶段，**每阶段收尾都有独立可玩的价值增量**，可按阶段单独立项。

## 0. 总述

### 范围

| # | 阶段 | 模块 | 子任务数 | 前置 | 任务文件 |
|---|---|---|---|---|---|
| 1 | 判定系统 | 15 | 8 | 03/05/01（已完成） | docs/tasks/15-checks.md |
| 2 | 回合制战斗 | 16 | 10 | 04/05/**15** | docs/tasks/16-battle.md |
| 3 | 经济与商店 | 17 | 8 | 04/05/12/13（已完成，可与阶段 1/2 并行） | docs/tasks/17-economy.md |
| 4 | 成就与周目 | 18→19 | 16 | 18 无外部前置；19 需 **18** | docs/tasks/18-achievements.md / 19-loop.md |
| 5 | QoL 与面板 | 25B | 6 | 跳读/回滚/历史随时可做；判定呈现需 15、战斗面板需 16 | docs/tasks/25-runtime-ui.md（B 组） |
| 6 | 作者脚本宿主 | 23 | 9 | 05/03/06（已完成）；**API 冻结 + OQ-11 复核** | docs/tasks/23-script-host.md |

M1 已完成 12/14（NPC 声望、身体变身机制层），不在本计划内；17 号落地时消费 12 号的声望变量。
合计 6 阶段、57 个子任务、约 62 个 commit（含 demo 内容接入与每阶段 1 个 docs 收尾 commit）。

### 执行顺序与依赖理由

```
15（判定）──> 16（战斗结算/伤害/对抗） ──┐
15 ──> 25B 判定呈现；16 ──> 25B 战斗面板 │
17（经济，独立）                          ├──> 23（脚本宿主收口：registerCheckRule、
18（成就）──> 19（周目）                  │     伤害公式脚本覆盖、API 冻结）
25B 跳读/回滚/历史/快捷键（随时可插）<────┘
```

执行顺序：**15 → 16 → 17 → 18 → 19 → 25B → 23**（17 可视价值增量提前；25B 中与 15/16 无关的四项可穿插）。

### 本轮范围（2026-09-18 人类裁定）

**本轮推进到阶段 1（判定系统）收尾即停**，交人工验收后再裁定下一阶段。

### M1 遗留项的归处

| 遗留项 | 归处 |
|---|---|
| 判定挂点缺失（`check` 指令只有数据面） | 阶段 1 自然解决（路由与规则实现） |
| 商店不可用（C5 检显式豁免） | 阶段 3 落地后**必须移除豁免**（其 PR 自审清单注明） |
| `npc.<id>.met` 专用写指令 | 需设计裁定：建议随阶段 3 或 6 一并定 |
| 约束 7 文档补记（C6–C11 六检） | 拟稿已呈报，待人类点头后单独 commit |
| E2E 本机走 msedge（Chromium 下载受限） | 网络可达时 `npx playwright install chromium` 后切回默认 project |

### 全局约束（引用 develop.md）

分支-PR-合入（约束 9）、TDD（约束 6：先写红再实现）、门禁四绿 + validate-docs（约束 8）、
连通性 C1–C11（约束 7）、里程碑收尾反思报告（约束 4）、人工验收（约束 10）。

---

## 1. 阶段 1 —— 判定系统（15 号）

### 开发目标

可插拔检定规则落地：CoC 7 版内置实现（阈值/大成功大失败/奖惩骰池/对抗）+ generic 规则 +
`check` 指令结果路由（05 号已预置指令壳，本阶段补规则实现与解析器注入缝），
`check_result` 事件供 UI 播放骰子动画。demo 增加检定场景，骰子结果真实影响走向。

### 影响面

- `packages/engine/src/checks/`（新建）：coc/generic 规则与内置解析器；
- `packages/engine/src/loader/scripts.ts`：合成解析器接缝——目前 `ScriptStepResult.checkResolver`
  返回后无人消费（潜在断缝），改为把「脚本规则 → 宿主解析器 → 内置 coc/generic」的合成
  解析器注入效果注册表，`check` 指令开箱可用；
- `packages/shared/src/schema/effects.ts`：check 参数补 `difficultyValue`（generic 难度数值，
  表达式或字面量；additive，向后兼容）；
- `fixtures/mini-game`：检定场景 + 文本键（过 C1–C11 连通性检查）。

### commit 拆分（对应 15-checks.md 子任务 1–8）

1. `feat(checks)`: checks 模块骨架 + `createBuiltinCheckResolver` + loader 接缝打通（含 coc 普通阈值）+ 基础测试
2. `feat(checks)`: coc 困难/极难阈值（floor 除法）+ 阈值端点测试
3. `feat(checks)`: coc 大成功（≤max(1,⌊skill/5⌋)）与大失败（=100 或 skill<50 且 ≥96）
4. `feat(checks)`: coc 奖励/惩罚骰池（十位取低/高 + 各位组合，链式 N 个）+ rolls 明细
5. `feat(checks)`: coc 对抗检定（等级序 → 同级低技能胜 → 再平守方胜）
6. `feat(checks)`: generic 规则（roll + value ≥ difficultyValue）+ schema 参数
7. `test(checks)`: 边界矩阵（skill ∈ {1,49,50,90,95,100} × roll 端点，固定种子）+ check_result 事件契约
8. `feat(demo)`: mini-game 检定场景接入 + 文本键
9. `docs(tasks)`: 15-checks.md 勾选 + progress.md 更新

### 验收效果

- 边界矩阵 + 对抗平局规则测试全绿（15 号完成定义）；
- demo 中执行一次真实检定：骰值经固定种子可复现，成功/失败走不同分支；
- C1–C11 连通性检查全绿；四门禁 + validate-docs 绿；
- 全量测试无回归。

---

## 2. 阶段 2 —— 回合制战斗（16 号）

### 开发目标

独立 BattleSession 状态机（DD-11 会话隔离）：八相位状态机、行动序（spd 降序 + Rng 平局）、
玩家行动（skill/item/defend/flee）、结算管线（战斗子集指令复用 EffectContext）、
可插拔伤害公式、AI（weighted/scripted）、状态 tick、胜负路由与掉落、战斗日志、敌方多人。
demo 接入至少一场战斗遭遇。

### 影响面

- `packages/engine/src/battle/`（新建，目录已预留）；
- 效果指令 `battle` 的 jump 路由已有壳（05 号），补会话执行面；
- `fixtures/mini-game`：遭遇模板 + 战斗场景。

### commit 拆分（对应 16-battle.md 子任务 1–10）

1. BattleSession 骨架 + 八相位状态机 + 全路径迁移测试；2. 单位模型 + turnQueue；
3. 玩家行动四类；4. 结算管线（战斗子集指令）；5. 伤害公式可插拔预设；
6. AI 策略（weighted/scripted）；7. 状态效果 round_end tick；
8. 胜负路由 + rewards child 事务（chance 掉落）；9. 战斗日志；
10. 敌方多人 + 遭遇模板参数化 + demo 遭遇接入 + docs 收尾。

### 验收效果

- 会话级测试全绿（不依赖叙事模块，DD-11 验证）；
- demo 战斗遭遇可玩：骰子呈现（阶段 1 的 check_result）+ 战斗日志可回看；
- 全门禁绿，无回归。

---

## 3. 阶段 3 —— 经济与商店（17 号）

### 开发目标

多货币钱包已有（05 号 money 指令），本阶段补 ShopService：entries 投影（show_if 过滤 +
库存）、定价表达式（声望/时段/周目/好感变量可用 + modifierKeys 折扣理由）、buy/sell 原子事务、
回购价一致性（FR-ECON-03）、restock 补货钩子、trade 事件。demo 商店开张。

### 影响面

- `packages/engine/src/economy/`（新建）；`shop` 效果指令新增（02 号 schema + 05 号注册表）；
- **移除 content-graph.test.ts C5 检的豁免**（M1 遗留，17 号落地即清账）；
- `fixtures/mini-game`：商店定义 + 场景入口 + 文本键。

### commit 拆分（对应 17-economy.md 子任务 1–8）

1. ShopService 骨架 + `shop` 指令 + wallet 集成测试；2. entries() 投影；3. priceOf 定价表达式
+ modifierKeys；4. buy/sell 原子事务；5. 回购价一致性；6. restock 补货（day_rollover 钩子）；
7. 交易完成效果 + trade 事件；8. 移除 C5 豁免 + demo 商店接入 + docs 收尾。

### 验收效果

- 定价表达式矩阵 + 原子性 + 回购一致性测试全绿（17 号完成定义）；
- demo 商店可买卖，钱不够/超库存正确回滚；C5 检恢复实判并全绿。

---

## 4. 阶段 4 —— 成就与元进度（18 号）+ 周目系统（19 号）

### 开发目标

成就增量评估（refs + TouchReport 触发 + 每时段兜底全量）、progress 型成就、解锁链路
（引擎不写 IO，Profile 由宿主 mutate）、ProfileStore（内存 + 乐观锁）、Perk 购买两步协议
（失败补偿回加）、新档 bootstrap、resetPoints、隐藏成就投影。
周目：applyLoopTransition 纯函数（inherit/reset/keepRatio/whitelist/blacklist）、loop 变量域、
EndingDef.nextLoop 转场摘要、与迁移次序固定（DD-10）。

### 影响面

- `packages/engine/src/achievements/`、`packages/engine/src/loop/`（目录已预留）；
- 03 号表达式白名单补 `loop` 域；`loop_transition` 指令已有壳；
- `fixtures/mini-game`：10+ 成就、3+ Perk、一个可达成结局 + 周目继承清单。

### commit 拆分（对应 18-achievements.md 9 项 + 19-loop.md 7 项）

18：1. 评估器；2. progress 型投影；3. 解锁链路；4. ProfileStore；5. Perk 两步协议；
6. 新档 bootstrap；7. resetPoints；8. 隐藏成就 + 收集率；9. 回滚不回滚成就边界测试。
19：1. applyLoopTransition；2. loop 变量域；3. EndingDef.nextLoop 转场；4. 切换后强制重建；
5. 迁移次序断言；6. 双循环边界；7. 策略组合矩阵测试 + demo 成就/周目接入 + docs 收尾。

### 验收效果

- 评估矩阵 + 两步协议失败序 + 策略矩阵测试全绿（18/19 号完成定义）；
- demo：10+ 成就、3+ Perk；「同存档进入第二周目且继承清单生效」用例通过（M2 验收标准 3）。

---

## 5. 阶段 5 —— QoL 与面板（25 号 B 组）

### 开发目标

已读跳过 + 自动播放（遇选项/判定/战斗暂停）、回滚按钮 + 历史回看（**回滚 5 步状态一致**
——M2 验收标准 4，依托 M1 checkpoint 机制扩展）、快捷键映射、成就图鉴面板、调试面板
（manifest 开关）、判定呈现动画（减弱动画降级）+ 战斗面板（OQ-04 嵌入叙事区形态）。

### 影响面

- `packages/runtime-ui`：B 组六个能力/面板；engine 侧仅消费既有事件（check_result 等）。

### commit 拆分（对应 25-runtime-ui.md B 组 6 项）

1. 跳读 + 自动播放；2. 回滚按钮 + 历史回看（react-window）+ 5 步回滚一致性用例；
3. 快捷键 + 设置页说明；4. 成就图鉴面板；5. 调试面板；6. 判定呈现 + 战斗面板 + docs 收尾。

### 验收效果

- 回滚 5 步状态一致用例通过；组件测试全绿；mini-game 在界面中完整可玩（25 号完成定义 B 组部分）。

---

## 6. 阶段 6 —— 作者脚本宿主（23 号）+ API 冻结

### 开发目标

类型化注册 API 四类扩展点（registerEffect / registerFunction / registerCheckRule / onHook）、
事务约束（host.transaction 唯一状态入口）、touchState 新域 warn、悬空契约（SCRIPT_CONTRACT）。
**收尾冻结注册 API（OQ-11 复核）**——M3 编辑器与 M4 导出的前置；打通 16 号伤害公式的脚本覆盖。

### 影响面

- `packages/engine/src/scripts/`（目录已预留）+ loader 管线步骤 6 扩展；
- 架构断言：运行期无 eval/动态加载（lint + 测试）。

### commit 拆分（对应 23-script-host.md 子任务 1–9）

1. ScriptModule/ScriptSetupApi + 加载时序；2. registerEffect；3. registerFunction；
4. registerCheckRule；5. onHook；6. 事务约束（架构测试）；7. touchState 域 warn；
8. 悬空契约；9. 桩全流程测试 + 伤害公式脚本覆盖打通 + OQ-11 复核记录 + docs 收尾。

### 验收效果

- 桩测试全绿；「运行期无 eval/动态加载」架构断言通过；
- 注册 API 冻结公告写入 detail-design（按约束 2 先报审）。

---

## 7. M2 里程碑收尾（人工验收门禁）

1. proposal §7 M2 验收四条逐条过（骰子呈现/战斗遭遇、10+ 成就 3+ Perk、周目继承、回滚 5 步）；
2. 发布门禁：全量单测 + E2E 冒烟 + 旧档读取回归；
3. 反思报告（约束 4）+ M2 评审记录（约束 10，人类判定）；
4. M1 遗留清点：C5 豁免应已移除、`npc.<id>.met` 裁定落档。

## 8. 风险与缓冲

| 风险 | 缓解 |
|---|---|
| 战斗与叙事的会话嵌套（DD-11）是全期最复杂接缝 | 阶段 2 会话级测试不依赖叙事模块先行锁定；demo 接入放最后 |
| generic 难度数值接口 design 与 schema 有差（difficultyValue 未入参） | 阶段 1 以 additive 参数补齐并回写设计偏差说明 |
| 阶段 4 Profile 涉及 Dexie（宿主侧） | 引擎只定义 ProfileStore 接口（DD-04），Dexie 实现归 25 号 |
| API 冻结时点（OQ-11） | 阶段 6 独立收口，冻结前复核全部扩展点需求（编辑器 M3 依赖） |
