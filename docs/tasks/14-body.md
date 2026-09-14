# 14 身体与变身

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §4.8 |
| 需求映射 | FR-BODY-01～04（05 为 P2 预留） |
| 前置模块 | 02（body schema）、05（set_body）、09（revert tick） |
| 里程碑 | M1 |

> 目标：部位→值映射的校验变更、临时变身回退、代词注入；引擎零语义（中立性）。

## 任务清单

- [x] `set_body` 指令：part/value ∈ BodyDef 校验（违例 EFFECT_FAILED）+ 永久变更
- [x] 临时变身：`revertAfter`（slots/days）登记 `__body_temp` 域 + 管线步骤 3 回退 + BodyReverted 事件
- [x] 代词注入器：pronouns 规则（by_part 映射）→ InterpVars（`{player.they}` 等）+ 映射测试
- [x] `progress` 字段预留（0..100，表达式可读，不进冻结范围）
- [x] 描写组合验收样例：宏 `if body.tail == 'fluffy'` 走通（与 08 号联测）

## 完成定义
- [x] 全部子任务勾选；校验矩阵/回退/代词测试全绿
