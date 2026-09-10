# 18 成就与元进度

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.4（ProfileStore 接口，DD-04） |
| 需求映射 | FR-ACHV-01～08、D7 |
| 前置模块 | 04（事件总线）、06（refs 反查）、02（profile schema） |
| 里程碑 | M2 |

> 目标：成就增量评估、点数入账、Perk 购买两步协议、跨存档 Profile。

## 任务清单

- [ ] `AchievementEvaluator`：refs 增量评估（TouchReport 触发）+ 每时段兜底全量
- [ ] progress 型成就（progressExpr → cur/goal 投影）+ 进度条数据
- [ ] 解锁链路：AchievementUnlocked 事件 → 宿主 mutate Profile → Toast 事件（引擎不写 IO 验证）
- [ ] `ProfileStore` 接口 + 内存实现（乐观锁版本）+ Dexie 实现留 25 号
- [ ] Perk 购买两步协议：扣点 → 建档失败补偿回加（失败序覆盖测试）
- [ ] 新档 bootstrap：PerkDef.effects 执行一次（属性/物品/flag/解锁内容）
- [ ] `resetPoints` 协议（回收已购 + 余额重算；在用 Perk 策略字段）
- [ ] 隐藏成就投影（未解锁不暴露存在性）+ 收集率统计
- [ ] 回滚不回滚成就（FR-READ-03 解耦）边界测试

## 完成定义
- [ ] 全部子任务勾选；评估矩阵 + 两步协议失败序测试全绿
