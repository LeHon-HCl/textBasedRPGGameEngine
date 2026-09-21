# 18 成就与元进度

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.4（ProfileStore 接口，DD-04） |
| 需求映射 | FR-ACHV-01～08、D7 |
| 前置模块 | 04（事件总线）、06（refs 反查）、02（profile schema） |
| 里程碑 | M2 |

> 目标：成就增量评估、点数入账、Perk 购买两步协议、跨存档 Profile。

## 任务清单

- [x] `AchievementEvaluator`：refs 增量评估（TouchReport 触发）+ 每时段兜底全量
- [x] progress 型成就（progressExpr → cur/goal 投影）+ 进度条数据
- [x] 解锁链路：AchievementUnlocked 事件 → 宿主 mutate Profile → Toast 事件（引擎不写 IO 验证）
- [x] `ProfileStore` 接口 + 内存实现（乐观锁版本）+ Dexie 实现留 25 号
- [x] Perk 购买两步协议：扣点 → 建档失败补偿回加（失败序覆盖测试）
- [x] 新档 bootstrap：PerkDef.effects 执行一次（属性/物品/flag/解锁内容）
- [x] `resetPoints` 协议（回收已购 + 余额重算；在用 Perk 策略字段）
- [x] 隐藏成就投影（未解锁不暴露存在性）+ 收集率统计
- [x] 回滚不回滚成就（FR-READ-03 解耦）边界测试

## 完成定义
- [x] 全部子任务勾选；评估矩阵 + 两步协议失败序测试全绿

## 落地记录（2026-09-21，全单线 A/B 并行）

- `evaluator.ts`：增量（refs 脏标记，touched 空短路）+ 全量（每时段兜底）+
  progressOf + gallery（hidden 未解锁仅占位）+ collectionRate；解锁单调
  （已解锁集合由宿主注入，DD-04）。
- `profile.ts`：内存 ProfileStore（乐观锁 = 串行队列）+ 四类购买校验 +
  chargePerk/compensatePerk（幂等补偿）+ resetPoints + recordAchievements（幂等）。
- `perks.ts`：applyPerkEffects + bootstrapPerks（OQ-06 仅新档）+ purchasePerk
  两步协议（失败序：扣点成功→建档失败→补偿回加 + 错误冒泡）。
- 回滚解耦（A3）：回滚状态不撤销 Profile 成就、重新评估幂等不入账。
- **demo**：11 成就（normal 7 / progress 2 / hidden 1）、4 Perk（含
  requires/conflicts 示例）、双语键齐备——覆盖 M2 验收「10+ 成就、3+ Perk」。
