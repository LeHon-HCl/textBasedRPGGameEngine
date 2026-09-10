# 04 GameState 与状态事务

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §3.1（含执行时序图） |
| 需求映射 | FR-READ-03、FR-STAT-01/05、FR-MIGR-01、DD-06 |
| 前置模块 | 01、02、03 |
| 里程碑 | M0 |

> 目标：运行时心脏——状态树、原子事务、回滚快照、事件总线。

## 任务清单

### A. 状态树
- [ ] `GameState` 类型全量（§3.1 字段清单）+ `newGameState(def, perkEffects)` 初始化（含 bootstrap.perks）
- [ ] `SerializedState` 投影与 schema 对齐（save.ts）+ 往返测试
- [ ] 派生属性 `recomputeDerived`（触碰域触发 + 循环依赖已在加载期排除）+ 单测

### B. 事务与事件
- [ ] `GameRuntime.exec`：immer produce、逐指令执行、失败反向回滚（EFFECT_FAILED 含 instruction 序号）
- [ ] `ExecOutcome` 组装：patches / jumps / events；`EngineEvent` 联合类型全集 + on/emit 总线
- [ ] ExecContext（source/where/rng）贯穿与调试字段验证

### C. 快照与序列化
- [ ] `checkpoint/rollback`：structuredClone 快照栈（默认深 5）、恢复后状态一致性测试
- [ ] 快照体积 > 5MB 告警分支测试
- [ ] `serialize/restore`（含 rngState，DD-09）+ 回放测试（同种子同操作序列 → 同终态）

## 完成定义
- [ ] 全部子任务勾选；事务原子性/回滚/序列化测试全绿（不依赖其他子系统）
