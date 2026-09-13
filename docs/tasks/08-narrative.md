# 08 叙事运行时（SceneRunner）

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §4.2（状态机图） |
| 需求映射 | FR-NARR-01/02/04、FR-XPLR-03/04、FR-GAL-01、FR-READ-04 |
| 前置模块 | 04、05、07 |
| 里程碑 | M0 骨架–M1 完整 |

> 目标：场景会话状态机——段落渲染、宏展开、选项过滤、跳转消费、子会话栈。

## 任务清单

### A. 状态机骨架（M0）
- [x] 五相位实现（entering/await_advance/await_choice/resolving/finished）+ 全路径迁移测试
- [x] `renderList()`：段落流 → RenderSegment（键/字面量/媒体 intent）
- [x] `choices()`：show_if 过滤 + 置灰条件（enabled/disabledReasonKey）
- [x] `choose()`：执行选项效果 → 消费 ExecOutcome.jumps（scene/ending/back/loop_transition）

### B. 宏与选项（M1）
- [x] 叙事宏展开：条件文本 if/else、first/again（依据 seen.scenes）、random 权重选段（注入 Rng）、延迟插值
- [x] 一次性选项（`__choice.<scene>.<choice>` 自动 flag）+ once 测试
- [x] readonly 会话（回想重放）：不写 seen、不触发副作用

### C. 组合
- [x] 子会话挂起栈（事件场景进入/返回，深度限 3 + 超限 warning）
- [x] 历史缓冲（环形 500 段 RenderSegment + 上下文）
- [x] 场景进入条件 entry.require + 进入时媒体/场景标签处理

## 完成定义
- [x] 全部子任务勾选；状态机全路径 + 宏分支 + 子会话栈测试全绿（桩化 runtime）
