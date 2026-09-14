# 20 存档系统

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.6（PersistenceAdapter，DD-04） |
| 需求映射 | FR-SAVE-01～06、FR-MIGR-01、FR-UI-08（数据源） |
| 前置模块 | 04（serialize）、06 |
| 里程碑 | M1（核心）–M2（快存等） |

> 目标：多槽位/自动存档/快存快读/导出导入，持久化经适配器注入。

## 任务清单

- [x] `PersistenceAdapter` 接口契约测试套件（任何实现必须通过的公共用例集）
- [x] `MemoryAdapter`（测试基座）+ 写前备份键语义
- [x] `SaveService.save/load`：SaveBlob 组装（versions/rngState/meta/checksum 预留）
- [x] 多槽位 listSaves + `SaveMeta` 投影（周目/位置/时间/时长/任务摘要）
- [x] autosave：触发点（slot_advance/scene_enter/event_end）+ auto_1..3 环形轮换
- [x] quicksave/quickload 独立槽位
- [x] `exportSlot/importSlot`：JSON 往返 + 导入走迁移管线入口（接 21 号）
- [x] 写入失败路径：quota 异常 → SAVE_CORRUPT 抛出（不静默）+ 备份恢复
- [x] 槽位 rename/remove（二次确认在 UI 层，服务层纯操作）

## 完成定义
- [x] 全部子任务勾选；适配器契约套件在 MemoryAdapter 全绿（Dexie 实现复用同一套件）

## 实现记录（2026-09-14）

- **契约套件位置**：`fixtures/helpers/src/persistence-contract.ts` —— engine 不得
  import 该包（§1.2 R2 对 src 与 test 同样适用），故运行点在同包的
  `test/persistence-contract.test.ts`；25 号落地 DexieAdapter 时在同一文件追加
  一行即可复用全套 14 条用例。
- **SaveMeta.activeQuests 存任务 id 而非 TextKey**：设计 §5.6 写作 `TextKey[]`，
  但任务显示名的键在 `QuestDef` 内、需随定义解析；存 id 是唯一无定义依赖的可投影
  形态（UI 侧经 GameDefinition.quests + TextResolver 取显示名）。
- **checksum 未实现**：设计标注 P2（FR-SAVE-07，M2 范围），schema 字段已预留
  （`blob.checksum` 可选），21 号迁移与 M2 校验和模块直接填充。
- **autosave 触发点不落档**：`point` 参数只影响写入时机，不进 blob——同一状态因
  触发点不同而产生档差异没有消费面（读档方无从使用该信息）。
- **迁移入口为注入缝**：`SaveServiceOptions.migrate` 由 21 号 MigrationRunner
  接入；未注入时低版本返回 `MIGRATION_FAILED` 而非静默接受。

