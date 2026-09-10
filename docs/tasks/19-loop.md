# 19 周目系统

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.5（DD-10 次序） |
| 需求映射 | FR-LOOP-01～06、D8 |
| 前置模块 | 04、06（LoopConfig）、18（Profile 边界） |
| 里程碑 | M2 |

> 目标：同存档周目切换——继承/重置清单执行器、loop 条件变量、转场摘要数据。

## 任务清单

- [ ] `applyLoopTransition` 纯函数：先整体 reset → 逐类 apply 策略（inherit/reset/keepRatio 表达式/whitelist/blacklist）
- [ ] `loop` 表达式变量域接通（03 号白名单）+ `loop >= 2` 条件内容验证
- [ ] EndingDef.nextLoop → `loop_transition` jump → 转场摘要数据（LoopSummary：天数/事件数/成就）
- [ ] 切换后强制步骤：recomputeDerived + npcLocationCache/eventCooldowns 按配置重建
- [ ] 与迁移次序：读档路径「迁移 → 周目恢复」固定（DD-10）+ 集成断言
- [ ] 双循环边界：结局收集入 Profile、场景回想只入存档（18 号配合）边界测试
- [ ] 继承策略组合矩阵测试（含 keepRatio「保留金币 10%」与白名单例外）

## 完成定义
- [ ] 全部子任务勾选；策略矩阵 + 次序断言测试全绿
