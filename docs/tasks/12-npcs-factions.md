# 12 NPC 与阵营系统

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §4.6 |
| 需求映射 | FR-NPCR-01～05 |
| 前置模块 | 04、09（日程缓存维护） |
| 里程碑 | M1 |

> 目标：NPC 日程解析、好感/关系阶段、记忆 flag、阵营声望。

## 任务清单

- [ ] `resolveNpcLocation`：按声明序匹配 schedule（slots+weekdays+showIf），无匹配 → 不在场；表驱动测试（时段×星期×条件矩阵）
- [ ] 管线步骤 5：批量解析 → `npcLocationCache` 重建（O(1) 查询）+ 失效正确性
- [ ] `favor` 指令落位：clamp（min/max）→ 阶段二分 → FavorStageChanged 事件（阈值切换测试）
- [ ] NPC 记忆：`npcs[id].flags` 命名空间 + 表达式 `npc.<id>.flag_xxx` 映射（03 号白名单配合）
- [ ] `npc.<id>.at` 缓存映射（同地点交互条件，FR-NPCR-01 交互入口）
- [ ] `reputation` 指令 + 阈值带 ReputationBandChanged 事件
- [ ] 关系面板数据投影（已结识/阶段/显隐策略字段，FR-NPCR-05）

## 完成定义
- [ ] 全部子任务勾选；日程/好感/声望测试全绿
