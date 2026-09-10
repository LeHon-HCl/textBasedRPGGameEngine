# 20 存档系统

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.6（PersistenceAdapter，DD-04） |
| 需求映射 | FR-SAVE-01～06、FR-MIGR-01、FR-UI-08（数据源） |
| 前置模块 | 04（serialize）、06 |
| 里程碑 | M1（核心）–M2（快存等） |

> 目标：多槽位/自动存档/快存快读/导出导入，持久化经适配器注入。

## 任务清单

- [ ] `PersistenceAdapter` 接口契约测试套件（任何实现必须通过的公共用例集）
- [ ] `MemoryAdapter`（测试基座）+ 写前备份键语义
- [ ] `SaveService.save/load`：SaveBlob 组装（versions/rngState/meta/checksum 预留）
- [ ] 多槽位 listSaves + `SaveMeta` 投影（周目/位置/时间/时长/任务摘要）
- [ ] autosave：触发点（slot_advance/scene_enter/event_end）+ auto_1..3 环形轮换
- [ ] quicksave/quickload 独立槽位
- [ ] `exportSlot/importSlot`：JSON 往返 + 导入走迁移管线入口（接 21 号）
- [ ] 写入失败路径：quota 异常 → SAVE_CORRUPT 抛出（不静默）+ 备份恢复
- [ ] 槽位 rename/remove（二次确认在 UI 层，服务层纯操作）

## 完成定义
- [ ] 全部子任务勾选；适配器契约套件在 MemoryAdapter 全绿（Dexie 实现复用同一套件）
