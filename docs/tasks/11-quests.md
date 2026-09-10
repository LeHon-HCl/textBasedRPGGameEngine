# 11 任务系统

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §4.5（状态迁移规则表） |
| 需求映射 | FR-QUEST-01～05 |
| 前置模块 | 04、05、06（refs 反查表） |
| 里程碑 | M1 |

> 目标：任务状态机——接取校验、阶段推进（refs 订阅）、奖励结算、失败判定。

## 任务清单

- [ ] `QuestMachine` 状态机 + 六态迁移规则表（undiscovered→available→active→ready_to_submit→done/failed）
- [ ] `accept`：acceptIf / requires / conflicts 校验矩阵（拒绝原因可读）
- [ ] 阶段推进：completeWhen 经 refs 反查表按 TouchReport 触发（不轮询）+ 推进事件 on_stage
- [ ] `submit`：ready_to_submit → done + rewards child 事务（原子性测试）
- [ ] `failWhen`：含时间截止条件（管线步骤 7 挂载）+ on_fail 效果
- [ ] `progress()`：目标进度投影（FR-QUEST-05 插值数据源）
- [ ] 任务日志数据源投影（按状态分组/追踪置顶数据，FR-QUEST-03）
- [ ] 表驱动测试：全迁移路径 × 校验矩阵 × 奖励原子性

## 完成定义
- [ ] 全部子任务勾选；状态机矩阵测试全绿
