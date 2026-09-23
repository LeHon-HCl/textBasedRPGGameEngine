# 19 周目系统

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.5（DD-10 次序） |
| 需求映射 | FR-LOOP-01～06、D8 |
| 前置模块 | 04、06（LoopConfig）、18（Profile 边界） |
| 里程碑 | M2 |

> 目标：同存档周目切换——继承/重置清单执行器、loop 条件变量、转场摘要数据。

## 任务清单

- [x] `applyLoopTransition` 纯函数：先整体 reset → 逐类 apply 策略（inherit/reset/keepRatio 表达式/whitelist/blacklist）
- [x] `loop` 表达式变量域接通（03 号白名单）+ `loop >= 2` 条件内容验证
- [x] EndingDef.nextLoop → `loop_transition` jump → 转场摘要数据（LoopSummary：天数/事件数/成就）
- [x] 切换后强制步骤：recomputeDerived + npcLocationCache/eventCooldowns 按配置重建
- [x] 与迁移次序：读档路径「迁移 → 周目恢复」固定（DD-10）+ 集成断言
- [x] 双循环边界：结局收集入 Profile、场景回想只入存档（18 号配合）边界测试
- [x] 继承策略组合矩阵测试（含 keepRatio「保留金币 10%」与白名单例外）

## 完成定义
- [x] 全部子任务勾选；策略矩阵 + 次序断言测试全绿

## 落地记录（2026-09-21，全单线 C 线）

- `transition.ts`：纯函数五形态策略矩阵（含复合形态类别的主映射语义）；
  **类别→状态域映射修正（2026-09-23 人类追认）**：`items` 类别含背包与多货币
  钱包——设计 §5.5 的 11 类清单无 wallet 独立项，钱包归「财产面」并入 items；
  keepRatio 对 wallet 数值子面有效（「保留金币 10%」由此表达）。
  遗留：钱包与背包无法分别配置（如「钱跨周目、装备不跨」）——待真实内容需求
  出现时考虑加第 12 类 `wallet` 或子面级策略，不在本期发明。
- `controller.ts`：`runLoopTransition`（变换 + 强制重建 + 状态替换）+
  `assertLoadOrder`（DD-10 次序断言）+ `fillSummary`（成就数宿主填充）。
- `GameRuntime.replaceState`（新增装配面，**2026-09-23 人类追认**）：全量替换 +
  派生重算 + 回滚栈清空（周目切换不可回滚，设计意图——玩家可感知：切换后
  回滚按钮失效）；`loop_transition` 的 jump 消费归宿主编排。
  显式断言测试 2 例（切换前 3 个回滚点 → 切换后状态树 checkpoints 空 +
  `rollback()` 返回 `{ok:false}`；切换不可撤销的行为断言）。
  **25B 验收注意**（阶段五）：回滚功能需覆盖「刚切完周目按回滚」的边界
  （提示「无可用回滚点」而非静默失败）。
- **M2 验收标准第 3 条**：「同存档进入第二周目且继承清单生效」集成用例通过
  （真实夹具 + 真实运行时：attrs/favor 继承、flags 白名单、factions keepRatio、
  派生重算、冷却策略、回滚栈清空）。
- 双循环边界：结局收集入 Profile（宿主路由）、场景回想只入存档——由 18 号
  的 Profile/存档分野保证；本模块不触及 Profile（DD-04）。
