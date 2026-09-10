# 21 版本与存档迁移

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.7（读档管线流程图，DD-07/10） |
| 需求映射 | FR-MIGR-02～07、NFR-15/16 |
| 前置模块 | 06（IdPathRegistry）、20（备份）、02（refId） |
| 里程碑 | M2.5 |

> 目标：更新不废档——版本判定、逐级迁移链、redirects 容错、备份还原。

## 任务清单

- [ ] 版本判定：相同直载 / 低于走迁移 / 高于 VERSION_UNSUPPORTED 拒绝（不触碰数据）
- [ ] pre-migration 备份写入与失败还原（MIGRATION_FAILED 含失败步骤与原因）
- [ ] 逐级链执行：vN→vN+1 循环 + 迁移日志（每级耗时/warn）
- [ ] `MigrationCtx` 受限面验证（无 IO/无网络——迁移函数只做纯数据变换）
- [ ] redirects 定向改写：IdPathRegistry 按 refKind 走字段（场景/物品/NPC/任务）
- [ ] 三类悬空处理：场景→安全场景；物品→丢弃 warn；NPC/任务→标记 missing warn（绝不抛未处理异常）
- [ ] Zod SerializedState 终验（迁移后结构合法性）
- [ ] Profile 迁移（同 runner；achievements/endings 域 redirects）
- [ ] 旧档夹具矩阵：`fixtures/legacy-saves/v1`（M1 冻结档持续随版本携带）× {直达/逐级/缺级/破坏性步骤/悬空×3}
- [ ] **旧档回归门禁**：矩阵测试进 CI 发布必跑（proposal §7 发布门禁）

## 完成定义
- [ ] 全部子任务勾选；夹具矩阵全绿；人为破坏步骤能还原备份并给出可诊断错误
