# 09 时间系统与推进管线

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §4.3（管线 0–7 固定次序，DD-10） |
| 需求映射 | FR-TIME-01～06、FR-XPLR-02 |
| 前置模块 | 04、05 |
| 里程碑 | M1 |

> 目标：可配置日历 + 固定次序推进管线（引擎内置步骤 + 作者钩子前后缀）。

## 任务清单

- [x] `TimeConfig`（slots/weekdays/startWeekday/months 可选）解析与校验
- [x] `Clock` 推进纯函数：slot → day → week → month 递进（跨天/跨周/跨月边界用例）
- [x] 管线编排器：0 before_rollover → 1 推进 → 2 状态 tick → 3 临时身体回退 → 4 day_rollover → 5 NPC 日程 → 6 事件评估 → 7 任务截止（依赖模块以钩子桩注入，本模块先行用记录桩测试次序）
- [x] 一次推进 = 一个 undo 点（各步效果合并为单事务）+ 中途抛错原子性测试
- [x] `advance_time` 指令与 `move_cost_slots` 归约到 advance 的语义验证
- [x] 作者钩子 API（before/after 前后缀，不可插入中间）+ 次序断言
- [x] 日历 UI 投影纯函数（Clock + TimeConfig → 今日/星期/时段视图，FR-TIME-05）
- [x] 日结算钩子示例（房租类，作者视角验收样例进入文档）

## 完成定义
- [x] 全部子任务勾选；管线次序（记录桩断言）与边界测试全绿

## 附录：日结算钩子示例（房租类，作者视角）

一次 `pipeline.advance(slots)` = 一个 undo 点；跨天时引擎依固定次序调用作者钩子（效果与引擎步骤同事务，任一失败整批回滚）。日结算（房租/惩罚/总结）挂 **day_rollover**（步骤 4，身体回退后、NPC 日程前）；跨天预警/预扣挂 **before_rollover**（步骤 0，时钟前）。

宿主装配（作者以效果指令声明钩子效果，运行时无条件原子执行）：

```ts
import { TimePipeline, createTimeViewProvider, DEFAULT_TIME_CONFIG } from '@game/engine';

const time = definition.time ?? DEFAULT_TIME_CONFIG;

// 求值视图校准（表达式 time.slot == "slot_morning"）经 GameRuntime 构造注入：
// new GameRuntime({ ..., timeViewProvider: createTimeViewProvider(time) })

const pipeline = new TimePipeline({
  runtime,                                   // GameRuntime 实例
  config: time,                              // data/time.yaml 或引擎缺省日历
  hooks: {
    // 步骤 0：跨天预警（进哪天由 ctx 预计算旗标可见：crossedDay/crossedWeek/crossedMonth）
    beforeRollover: (ctx) => [
      { notify: { textKey: 'ui.day_rollover_warning', vars: { slots: ctx.slots } } },
    ],
    // 步骤 4：日结算——房租（多货币 money 指令可负值）+ 结算通知
    dayRollover: () => [
      { money: { town_silver: -20 } },       // 每跨一天扣 20 银币房租
      { notify: { textKey: 'quests.rent_charged' } },
    ],
  },
});

// 推进入口（移动消耗 / 行动消耗 / advance_time 意图最终都归约到这里）：
pipeline.advance(moveCost);                  // FR-XPLR-02 location.moveCost
// 或消费叙事事务产出的意图：
for (const jump of outcome.jumps) {
  if (jump.type === 'advanceTime') pipeline.advance(jump.slots);
}
```

条件化房租（仅受租约 flag 保护时扣）由 23 号作者脚本宿主以 `x.*` 指令承载（钩子效果列表为数据面，分支逻辑走脚本或事件系统）；月度结算（`crossedMonth` 门控）与房租类日结算法一致。

作者可预期的固定次序（DD-10，作者钩子只有步骤 0/4 两个合法位置）：

```
0 before_rollover（跨天时） → 1 时钟推进 → 2 状态 tick → 3 临时身体回退
→ 4 day_rollover（跨天时） → 5 NPC 日程 → 6 事件评估 → 7 任务截止
```
