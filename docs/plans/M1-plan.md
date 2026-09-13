# M1 开发计划 —— 运行时 MVP

> 目标（proposal §7）：**3 区域 / 10+ 事件 / 2 任务线 demo 可玩**。
> 本计划按 `docs/develop.md` 约束 1 组织：每模块严格分「开发目标 / 影响面 / commit 拆分 / 验收效果」四节。
> 全局流程（分支-PR-合入、TDD、注释规范、文档同步）见 `docs/develop.md`，本计划不重复。
> 拆分依据：`docs/tasks/09~25` 各任务文件（子任务原文）+ `docs/detail-design.md` §4.3–4.8 / §5.6 / §5.8 / §5.10 / §6。

## 0. 总述

### 范围

| # | 模块 | 子任务数 | 前置 | 任务文件 |
|---|---|---|---|---|
| 1 | 09 时间系统与推进管线 | 8 | 04、05（已完成） | docs/tasks/09-time.md |
| 2 | 13 物品、装备与多层服装 | 6 | 02、04（已完成） | docs/tasks/13-items-outfit.md |
| 3 | 11 任务系统 | 8 | 04、05、06（已完成） | docs/tasks/11-quests.md |
| 4 | 22 内容分级与过滤 | 8 | 02、04（已完成） | docs/tasks/22-content-filter.md |
| 5 | 12 NPC 与阵营系统 | 7 | 04、09 | docs/tasks/12-npcs-factions.md |
| 6 | 14 身体与变身 | 5 | 02、05、09 | docs/tasks/14-body.md |
| 7 | 10 事件系统 | 10 | 03、06、09、22 | docs/tasks/10-events.md |
| 8 | 24 媒体解析（引擎侧） | 6 | 06、08（已完成） | docs/tasks/24-media.md |
| 9 | 20 存档系统 | 9 | 04、06（已完成） | docs/tasks/20-save.md |
| 10 | 25 runtime-ui 玩家界面（A 组） | 12 | 运行时全家、20、22 | docs/tasks/25-runtime-ui.md |

M1 中 02（系统域）/ 05（全量指令）/ 06（管线 4–7）/ 08（宏/选项/子会话）已完成并核实（progress.md 已勾选），不在本计划内。
合计 10 个模块、79 个子任务、约 90 个 commit（含每模块 1 个 docs 收尾 commit）。

### 模块顺序与依赖理由

```
09 ──┬──> 12（管线步骤5 日程）   ┌──> 10（22 接入 + 09 挂载）
     ├──> 14（管线步骤3 回退）   22 ──┘
     └──> 10（管线挂载点）
13 ──> 管线 tick（09 之后就绪即可做，故紧随 09）
11 ──> 管线步骤7 任务截止（需 09）
20 ──> 依赖 04/06，但放在 24 之后、25A 之前（25A 需要存读档）
25A ──> 依赖最广（04-08、20、22），最后收口
```

执行顺序：**09 → 13 → 11 → 22 → 12 → 14 → 10 → 24 → 20 → 25A**。

### 全局约束（引用 develop.md）

- 每子任务 = 1 commit（TDD：先失败测试后实现）；模块收尾 1 个 docs commit（architecture.md 对应小节 + 任务勾选 + progress.md）。
- 每模块一个分支 `feat/<NN>-<slug>`，PR 自审 + CI 绿后 `--rebase` 合入。
- 覆盖率门禁全程维持：shared ≥ 90%、engine ≥ 80%。

---

## 1. 模块 09 —— 时间系统与推进管线

### 开发目标
可配置日历（slots/weekdays/startWeekday/months）+ 固定次序推进管线（0 before_rollover → 1 推进 → 2 状态 tick → 3 临时身体回退 → 4 day_rollover → 5 NPC 日程 → 6 事件评估 → 7 任务截止）。一次推进 = 一个 undo 点；依赖模块以钩子桩注入。

### 影响面
- 新增 `packages/engine/src/time/` 子系统（TimeConfig 解析、Clock 推进、管线编排器）。
- `effects/builtins/system.ts` 的 `advance_time` 指令接入真实推进语义；`move_cost_slots` 归约验证。
- `GameRuntime` 需暴露管线编排所需的事务与钩子挂点；`state/expr-scope.ts` 的 `TimeViewProvider` 缝落实。
- 09–14/10/11 号后续模块将在此挂载（桩接口即它们的扩展点）；docs/architecture.md §3 新增 time 小节。

### commit 拆分
1. `TimeConfig`（slots/weekdays/startWeekday/months 可选）解析与校验。
2. `Clock` 推进纯函数：slot → day → week → month 递进（跨天/跨周/跨月边界用例）。
3. 管线编排器：八步固定次序，依赖模块以记录桩注入（次序断言测试）。
4. 一次推进 = 一个 undo 点（各步效果合并为单事务）+ 中途抛错原子性测试。
5. `advance_time` 指令与 `move_cost_slots` 归约到 advance 的语义验证。
6. 作者钩子 API（before/after 前后缀，不可插入中间）+ 次序断言。
7. 日历 UI 投影纯函数（Clock + TimeConfig → 今日/星期/时段视图，FR-TIME-05）。
8. 日结算钩子示例（房租类，作者视角样例写入 docs/tasks/09-time.md 附录）。
9. docs 收尾：勾选 09-time.md、progress.md、architecture.md。

### 验收效果
- 八步次序用记录桩断言全绿；跨天/跨周/跨月边界矩阵全绿。
- 推进中途任一步抛错 → 状态回滚到推进前（原子性测试）。
- 覆盖率门禁维持；CI 绿。

---

## 2. 模块 13 —— 物品、装备与多层服装

### 开发目标
背包纯函数集（堆叠/容量/关键道具分区）、装备栏并入派生重算、多层服装冲突规则（swappable）、换装预设、耐久/时效 tick（挂 09 管线）、背包 UI 数据投影。

### 影响面
- 新增 `packages/engine/src/inventory/`（纯函数集，无副作用，供指令层与 UI 投影复用）。
- `effects/builtins/items.ts` 的 give/take/equip/unequip/wear/remove 从占位语义升级为调用 Inventory 纯函数。
- `state/derived.ts`：equipMods 并入派生重算。
- 耐久/时效 tick 挂 09 管线步骤 2；`ItemExpired` 事件加入 EngineEvent。
- wear 规则只做冲突判定，遮挡等字段**透传不解释**（引擎中立性红线）。

### commit 拆分
1. `Inventory` 纯函数集：give/take/split/merge（堆叠、容量上限、关键道具分区）+ 矩阵测试。
2. 装备栏：equip/unequip + `equipMods` 并入派生属性重算 + 修正明细测试（FR-STAT-03）。
3. `wear` 冲突规则：同 part 同 layer → swappable 决定拒绝/替换；中立性透传测试。
4. 换装预设：`__outfit_preset_<name>` 快照存取 + 应用。
5. 耐久/时效：durability / expiresAfterSlots 管线 tick → `ItemExpired` 事件。
6. 背包 UI 数据投影（分类/排序/搜索纯函数层，FR-ITEM-02）。
7. docs 收尾：勾选 + architecture.md §3.4（items 指令升级）/新增 inventory 小节。

### 验收效果
- Inventory give/take/split/merge 矩阵与 wear 冲突规则矩阵全绿。
- 现有 items 指令测试更新后全绿（行为增强不破坏既有签名）。
- 覆盖率门禁维持；CI 绿。

---

## 3. 模块 11 —— 任务系统

### 开发目标
`QuestMachine` 六态状态机（undiscovered→available→active→ready_to_submit→done/failed）、接取校验矩阵、refs 反查驱动阶段推进（不轮询）、奖励子事务原子结算、失败判定（含时间截止）、任务日志数据源投影。

### 影响面
- 新增 `packages/engine/src/quests/`。
- refs 反查表（06 号 compile 步骤产物）首次被消费：completeWhen 表达式变更经 `TouchReport` 触发推进。
- 管线步骤 7（任务截止）从桩换为实现；`on_stage` 推进事件加入 EngineEvent。
- `effects/builtins/system.ts` 的 `quest` 指令接入 QuestMachine。

### commit 拆分
1. `QuestMachine` 状态机 + 六态迁移规则表。
2. `accept`：acceptIf / requires / conflicts 校验矩阵（拒绝原因可读）。
3. 阶段推进：completeWhen 经 refs 反查表按 TouchReport 触发 + on_stage 事件。
4. `submit`：ready_to_submit → done + rewards child 事务（原子性测试）。
5. `failWhen`：含时间截止条件（管线步骤 7 挂载）+ on_fail 效果。
6. `progress()`：目标进度投影（FR-QUEST-05 插值数据源）。
7. 任务日志数据源投影（按状态分组/追踪置顶，FR-QUEST-03）。
8. docs 收尾：勾选 + architecture.md。

### 验收效果
- 表驱动测试：全迁移路径 × 校验矩阵 × 奖励原子性全绿。
- 阶段推进只由 TouchReport 命中触发（正确性 + 不轮询断言）。
- 覆盖率门禁维持；CI 绿。

---

## 4. 模块 22 —— 内容分级与过滤

### 开发目标
单点 `ContentFilter`（ContentTagsDef + disabledTags）：`passes/eventAdmissible/placeholderFor` 谓词；应用点 2（段落渲染前占位替换）与应用点 3（选项隐藏）先行；应用点 1（事件池 prune）留接口待 10 号接入；设置即时生效。

### 影响面
- 新增 `packages/engine/src/filter/`（纯谓词，无渲染依赖）。
- `narrative/scene-runner.ts` 渲染与 `choices()` 增加过滤注入点（可选注入，缺省不过滤——向后兼容）。
- 首启向导数据支撑：`settings.wizardDone` 标志 + manifest.contentWarning 文案键。
- 任务降级（filter-quest-break）属静态校验，归 26 号编辑器：边界说明写入测试注释与任务文件。

### commit 拆分
1. `ContentFilter` 构造 + `passes/eventAdmissible/placeholderFor` 谓词。
2. 应用点 2：段落渲染前占位替换（占位文本键由游戏包提供）。
3. 应用点 3：选项 `choices()` 隐藏。
4. 设置变更 → 重建实例 → 当前场景重渲染（即时生效测试）。
5. 首启向导数据支撑：wizardDone 标志 + contentWarning 文案键。
6. 任务降级边界说明（26 号规则）+ 测试注释。
7. 谓词矩阵测试（标签组合 × 三应用点 × 占位回退）。
8. docs 收尾：勾选 + architecture.md（narrative 注入点说明）。

### 验收效果
- 谓词矩阵全绿；「屏蔽某标签后事件不触发（桩）、选项隐藏」集成用例通过。
- 应用点 1 的接口预留有类型与桩测试（10 号接入时零改动换实现）。
- 覆盖率门禁维持；CI 绿。

---

## 5. 模块 12 —— NPC 与阵营系统

### 开发目标
NPC 日程解析（声明序匹配 schedule）、管线步骤 5 批量解析与 `npcLocationCache`、好感阶段（clamp → 阶段二分 → FavorStageChanged）、记忆 flag 表达式映射、阵营声望带事件、关系面板数据投影。

### 影响面
- 新增 `packages/engine/src/npcs/`。
- 管线步骤 5 从桩换为实现；`npcs[id].flags` 命名空间进入 GameState（与 03 号 `EXPR_ROOTS` 白名单的 `npc.<id>.flag_xxx` 映射配合）。
- `favor` / `reputation` 指令从占位语义升级（clamp、阈值事件）。

### commit 拆分
1. `resolveNpcLocation`：声明序匹配 schedule（slots+weekdays+showIf），无匹配 → 不在场；表驱动（时段×星期×条件矩阵）。
2. 管线步骤 5：批量解析 → `npcLocationCache` 重建（O(1) 查询）+ 失效正确性。
3. `favor` 指令落位：clamp（min/max）→ 阶段二分 → FavorStageChanged（阈值切换测试）。
4. NPC 记忆：`npcs[id].flags` 命名空间 + 表达式 `npc.<id>.flag_xxx` 映射。
5. `npc.<id>.at` 缓存映射（同地点交互条件，FR-NPCR-01）。
6. `reputation` 指令 + 阈值带 ReputationBandChanged 事件。
7. 关系面板数据投影（已结识/阶段/显隐策略，FR-NPCR-05）+ docs 收尾。

### 验收效果
- 日程矩阵 / 好感阈值 / 声望带测试全绿；缓存失效正确性测试通过。
- 覆盖率门禁维持；CI 绿。

---

## 6. 模块 14 —— 身体与变身

### 开发目标
`set_body` 部位/值校验变更（永久）、临时变身 `revertAfter` 登记与管线步骤 3 回退（BodyReverted 事件）、代词注入器（pronouns → InterpVars）、`progress` 字段预留、与 08 号宏的联测样例。引擎对身体语义零解释（中立性红线）。

### 影响面
- 新增 `packages/engine/src/body/`。
- `effects/builtins/adversarial.ts` 的 `set_body` 从占位语义升级为校验变更（违例 → EFFECT_FAILED）。
- 管线步骤 3 从桩换为实现；`__body_temp` 域进入 GameState；BodyReverted 事件。
- i18n 插值变量扩展（`{player.they}` 等代词来自 by_part 映射）。

### commit 拆分
1. `set_body` 指令：part/value ∈ BodyDef 校验（违例 EFFECT_FAILED）+ 永久变更。
2. 临时变身：`revertAfter` 登记 `__body_temp` 域 + 管线步骤 3 回退 + BodyReverted 事件。
3. 代词注入器：pronouns 规则（by_part 映射）→ InterpVars + 映射测试。
4. `progress` 字段预留（0..100，表达式可读，不进冻结范围）。
5. 描写组合验收样例：宏 `if body.tail == 'fluffy'` 走通（与 08 号联测）+ docs 收尾。

### 验收效果
- 校验矩阵 / 回退 / 代词映射测试全绿；联测样例进入文档。
- 中立性：引擎代码与测试中无任何身体语义解释性分支（评审检查项）。
- 覆盖率门禁维持；CI 绿。

---

## 7. 模块 10 —— 事件系统

### 开发目标
事件池评估器：PoolIndex 增量评估（脏标记只重算受影响事件）、collect/prune/select/dispatch 四流程（条件/概率/探索三类触发、冷却、互斥、内容过滤接入）、错过窗口丢弃语义、debugLog 阶段计数、性能基准（1000 事件每时段 ≤3% 重算、<16ms）。

### 影响面
- 新增 `packages/engine/src/events/`。
- 22 号 ContentFilter 应用点 1 正式接入 prune；管线步骤 6 从桩换为实现。
- dispatch 经 SceneRunner 子会话启动事件场景（08 号 SUBSESSION 栈的第二个消费方）。
- 冷却状态进入 GameState（`cooldowns`）；固定种子行为矩阵依赖 01 号 RNG。

### commit 拆分
1. `PoolIndex` 构建复用（byScope / mutexGroups / dirtyMap 由 expr.refs 生成）。
2. collect：区域/地点候选 + 静态窗口过滤（slots/weekdays）。
3. prune：冷却（cooldown_days/slots）、once_per_loop/once_per_save、ContentFilter 接入。
4. select：condition 型按 priority 全出（可配仅首个）、random 型 weighted + mutex 约束（固定种子断言）。
5. dispatch：登记冷却 → SceneRunner 子会话启动。
6. 脏标记增量：TouchReport 命中 refs 才重算 require（只重算受影响事件的正确性测试）。
7. 探索发现型子池（trigger.type=explore）：地点行动呈现交互点列表。
8. 错过窗口丢弃语义（无排队，设计裁决）+ 文档注释。
9. debugLog：collect/prune/select 各阶段计数与未触发原因（FR-DEBG-05）。
10. 性能基准：1000 事件夹具、每时段 ≤3% 重算、断言 < 16ms（NFR-02）+ docs 收尾（合并入本 commit 或独立 docs commit，按实际改动定）。

### 验收效果
- 固定种子行为矩阵全绿；增量重算正确性测试（受影响/不受影响事件分野）通过。
- 性能基准达标且纳入常规测试（防回归）。
- 覆盖率门禁维持；CI 绿。

---

## 8. 模块 24 —— 媒体解析（引擎侧）

### 开发目标
引擎只产出媒体意图（intent）并校验资源存在性；播放归 runtime-ui。MediaCatalog 解析、场景/区域 bg/bgm intent、立绘差分条件求值、段落级 CG intent + 图鉴解锁位、`media` 指令与 `notify` 分离。

### 影响面
- 新增 `packages/engine/src/media/`（或在 narrative 内扩展 intent 产出——按最小接缝定，PR 说明）。
- 06 号 compile 步骤的 `mediaCatalog` 首次被消费；缺失资源 → warning + 占位 intent（FR-MEDIA-06）。
- `seen.gallery` 解锁位进入 GameState（图鉴数据源，FR-MEDIA-04）。
- 零图像/音频依赖（红线）：产出纯数据 intent。

### commit 拆分
1. `MediaCatalog`：assetId → {path, hash, preload, type} 解析 + 缺失 → warning + 占位 intent。
2. 场景/区域绑定 → bg/bgm intent（进入场景时产出）。
3. 立绘差分：sprite intent + 变体条件表达式求值（好感/身体/服装驱动）。
4. 段落级 CG intent + `seen.gallery` 解锁位（图鉴数据源）。
5. `media` 指令（sfx 一次性意图）与 `notify` 分离验证。
6. intent 序列断言测试（进入场景 → 段落 → 选项完整 intent 流）+ docs 收尾。

### 验收效果
- intent 流测试全绿；测试与实现中无任何图像/音频库依赖。
- 覆盖率门禁维持；CI 绿。

---

## 9. 模块 20 —— 存档系统

### 开发目标
多槽位/自动存档/快存快读/导出导入；持久化经 `PersistenceAdapter` 注入（引擎零平台依赖）；契约测试套件任何实现必须全过。

### 影响面
- 新增 `packages/engine/src/save/`。
- 消费 04 号 `serializeState/restoreState`；SaveBlob 含 versions/rngState/meta/checksum（checksum 完整校验可延后至 21 号，先预留字段）。
- `autosave` 触发点挂 runtime 事件（slot_advance/scene_enter/event_end）；auto_1..3 环形轮换。
- DexieAdapter 属 25 号 A 组（浏览器侧），本模块只交付 MemoryAdapter + 契约套件。

### commit 拆分
1. `PersistenceAdapter` 接口契约测试套件（公共用例集，任何实现复用）。
2. `MemoryAdapter`（测试基座）+ 写前备份键语义。
3. `SaveService.save/load`：SaveBlob 组装（versions/rngState/meta/checksum 预留）。
4. 多槽位 listSaves + `SaveMeta` 投影（周目/位置/时间/时长/任务摘要）。
5. autosave：触发点（slot_advance/scene_enter/event_end）+ auto_1..3 环形轮换。
6. quicksave/quickload 独立槽位。
7. `exportSlot/importSlot`：JSON 往返 + 导入走迁移管线入口（接 21 号）。
8. 写入失败路径：quota 异常 → SAVE_CORRUPT 抛出（不静默）+ 备份恢复。
9. 槽位 rename/remove（服务层纯操作，二次确认在 UI 层）+ docs 收尾。

### 验收效果
- 契约套件在 MemoryAdapter 全绿（Dexie 实现复用同一套件）。
- 写入失败不静默：SAVE_CORRUPT 可抛、备份可恢复。
- 覆盖率门禁维持；CI 绿。

---

## 10. 模块 25 —— runtime-ui 玩家界面（A 组，12 项）

### 开发目标
React 通用游玩界面基础：Zustand UiStore + 事件订阅桥、响应式 AppShell、主菜单、渲染管线（resolve→插值→sanitize→ReactNode + 打字机）、叙事视图与选项列表、状态/地图/任务/设置面板、DexieAdapter（复用 20 号契约套件）、Toast、首启内容向导。全部组件 props 受控可测。

### 影响面
- `packages/runtime-ui` 从占位包变为实体包（首次引入 React 依赖与 eslint 环境扩展——R2 只约束 engine，PR 中说明）。
- 消费 engine 全部公开导出面（04-08、09-14、20、22、24）；发现导出面缺口时在 engine 补导出（最小变更）。
- apps/player-demo 改造为 runtime-ui 的宿主（或新增挂载页，PR 内定）。
- vitest 环境扩展（jsdom / Testing Library）；新增依赖（zustand、react、dexie、dompurify 类）需在 PR 影响面中列明。

### commit 拆分（对应 25-runtime-ui.md A 组 12 项）
1. `UiStore`（Zustand）+ GameRuntime 事件订阅桥 + selector 细粒度订阅模式。
2. AppShell 响应式布局（≥900px 双栏 / 移动折叠 Tab，FR-UI-01/09）。
3. 主菜单（继续/新游戏/读档/成就/设置/关于，FR-UI-06）。
4. 渲染管线：resolve→插值→sanitize（白名单+转义）→ReactNode + 打字机效果（reduced-motion 自动关）。
5. NarrativeView/OptionList（advance/choose 挂接 + 选择前 checkpoint）。
6. 状态面板（属性/技能/状态/钱包/着装概要 + 数值变化高亮动画，FR-UI-03）。
7. 地图导航面板（区域图+移动消耗+解锁提示，FR-UI-02）。
8. 任务日志面板（分组/追踪置顶，FR-QUEST-03 UI 侧）。
9. 设置面板（语言/文本/媒体开关/标签开关/快捷键说明/三版本号，FR-UI-05）。
10. DexieAdapter（复用 20 号契约套件）+ 隐私模式降级横幅（NFR-10）。
11. 通知 Toast 系统（合并策略 500ms，FR-UI-07）。
12. 首启内容向导（警告页+标签开关，FR-CGRD-04）。
13. docs 收尾：勾选 + architecture.md（§1 依赖图加 runtime-ui、新增 §runtime-ui 小节）。

### 验收效果
- 组件测试（Testing Library）全绿；DexieAdapter 通过 20 号契约套件。
- mini-game 在界面中完整可玩（延续 M0 浏览器实测方式人工过一遍）。
- engine 覆盖率门禁不受影响；CI 绿。

---

## 11. M1 里程碑收尾（人工验收门禁）

1. **发布门禁**（proposal §7）：全量测试 + lint + validate-docs 全绿；E2E 冒烟。
2. **demo 扩充**：fixtures/mini-game 扩展为 M1 验收 demo——3 区域 / 10+ 事件 / 2 条任务线，覆盖时间推进、存读档、内容过滤、NPC 日程、判定挂点。
3. **浏览器实测**：`pnpm dev:player` 走通新游戏 → 推进时间 → 触发事件 → 任务推进 → 存/读档 → 内容过滤生效。
4. 更新 progress.md 的 M1 验收记录（勾选模块项 + 记录），**交用户人工验收**——AI 不擅自宣布 M1 完成。

## 12. 风险与缓冲

- **性能基准（10 号）**：若 1000 事件基准不达标，先优化 dirtyMap 剪枝再考虑放宽夹具规模；不允许直接改阈值（NFR-02 是需求）。
- **runtime-ui 依赖引入（25A）**：react/zustand/dexie/dompurify 等版本选择在开工时的 PR 中定案并锁定 lockfile。
- **导出面缺口**：各模块消费 engine 时若需新增导出，遵循「最小导出 + index.ts 统一出口 + 同 PR 更新 architecture.md」。
- **里程碑节奏**：AI 自审 + CI 绿即合（develop.md 约束 3），用户在 M1 收尾统一人工验收；期间任何红线违规（中立性、引擎零 DOM、裸 throw）在自审清单中一票否决。
