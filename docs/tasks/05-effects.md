# 05 效果指令系统

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §3.3（指令表 + EffectContext） |
| 需求映射 | FR-NARR-03、DD-08、FR-SCR-05 |
| 前置模块 | 04 |
| 里程碑 | M0（状态类）–M1（全量） |

> 目标：约 20 个内置指令的注册表与执行器；流程类只产 jumps 的分界约束。

## 任务清单

### A. 注册表机制
- [ ] `EffectInstructionDef`（schema/touch/execute）+ 注册/重复 ID 冲突 + 参数 Zod 校验测试
- [ ] `EffectContext`（draft/rng/evalExpr/emit/child/where）生命周期测试（draft 越界访问报错）
- [ ] `call` 指令与 `x.<script>.<name>` 命名空间预留（DD-08）

### B. 内置指令（每条一个 commit + 单测）
- [ ] 状态类：`set` / `add` / `flag` / `money`（表达式值、负值校验）
- [ ] 物品类：`give` / `take` / `equip` / `unequip` / `wear` / `remove`（容量/冲突走 13 号纯函数）
- [ ] 关系类：`favor` / `reputation`（clamp + 阶段事件，接 12 号）
- [ ] 流程类：`goto` / `back` / `ending` / `loop_transition`（只产 jumps，不改状态——分界测试）
- [ ] 系统类：`advance_time`（接 09 号）、`quest`（接 11 号）、`unlock` / `notify` / `media`
- [ ] 对抗类：`check`（子效果路由，接 15 号）、`battle`（jump 类，接 16 号）、`set_body`（接 14 号）

### C. 错误与元数据
- [ ] `touch` 声明覆盖全部写域（迁移登记/调试监视/订阅触发三方复用验证）
- [ ] 失败定位：EFFECT_FAILED 的 where（scene/instruction/sourceExpr）测试

## 完成定义
- [ ] 全部子任务勾选；指令矩阵测试全绿；每指令 touch 与实际写域一致（抽查断言）
