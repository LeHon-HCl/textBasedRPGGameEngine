# 09 时间系统与推进管线

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §4.3（管线 0–7 固定次序，DD-10） |
| 需求映射 | FR-TIME-01～06、FR-XPLR-02 |
| 前置模块 | 04、05 |
| 里程碑 | M1 |

> 目标：可配置日历 + 固定次序推进管线（引擎内置步骤 + 作者钩子前后缀）。

## 任务清单

- [ ] `TimeConfig`（slots/weekdays/startWeekday/months 可选）解析与校验
- [ ] `Clock` 推进纯函数：slot → day → week → month 递进（跨天/跨周/跨月边界用例）
- [ ] 管线编排器：0 before_rollover → 1 推进 → 2 状态 tick → 3 临时身体回退 → 4 day_rollover → 5 NPC 日程 → 6 事件评估 → 7 任务截止（依赖模块以钩子桩注入，本模块先行用记录桩测试次序）
- [ ] 一次推进 = 一个 undo 点（各步效果合并为单事务）+ 中途抛错原子性测试
- [ ] `advance_time` 指令与 `move_cost_slots` 归约到 advance 的语义验证
- [ ] 作者钩子 API（before/after 前后缀，不可插入中间）+ 次序断言
- [ ] 日历 UI 投影纯函数（Clock + TimeConfig → 今日/星期/时段视图，FR-TIME-05）
- [ ] 日结算钩子示例（房租类，作者视角验收样例进入文档）

## 完成定义
- [ ] 全部子任务勾选；管线次序（记录桩断言）与边界测试全绿
