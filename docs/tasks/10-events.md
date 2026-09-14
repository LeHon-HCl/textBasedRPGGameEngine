# 10 事件系统

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §4.4（评估流程 + 脏标记） |
| 需求映射 | FR-XPLR-03～08、NFR-02、FR-DEBG-05 |
| 前置模块 | 03（refs）、06（poolIndex）、09（管线挂载） |
| 里程碑 | M1 |

> 目标：事件池评估器——条件/概率/探索三类触发、冷却与互斥、refs 增量求值。

## 任务清单

- [x] `PoolIndex` 构建复用（byScope / mutexGroups / dirtyMap 由 expr.refs 生成）
- [x] 评估流程 collect：区域/地点候选 + 静态窗口过滤（slots/weekdays）
- [x] 评估流程 prune：冷却（cooldown_days/slots）、once_per_loop/once_per_save、内容过滤接入（22 号）
- [x] 评估流程 select：condition 型按 priority 全出（可配仅首个）、random 型 weighted + mutex 约束（固定种子断言）
- [x] 评估流程 dispatch：登记冷却 → SceneRunner 子会话启动
- [x] 脏标记增量：事务 TouchReport 命中 refs 才重算 require（只重算受影响事件的正确性测试）
- [x] 探索发现型子池（trigger.type=explore）：地点行动呈现交互点列表
- [x] 错过窗口丢弃语义（无排队，设计裁决）+ 文档注释
- [x] debugLog：collect/prune/select 各阶段计数与未触发原因（FR-DEBG-05）
- [x] 性能基准：1000 事件夹具、每时段 ≤3% 重算、断言 < 16ms（NFR-02，Vitest bench）

## 完成定义
- [x] 全部子任务勾选；固定种子行为矩阵 + 性能基准达标
