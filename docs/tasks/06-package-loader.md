# 06 游戏包加载器

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §3.4（七步管线，DD-02/07/12） |
| 需求映射 | FR-MIGR-01、FR-SCR-04、FR-L10N-02、NFR-12 |
| 前置模块 | 02、03、05 |
| 里程碑 | M0 骨架–M1 完整 |

> 目标：三宿主（目录/静态包/编辑器内存）共用的包加载管线，产出冻结的 GameDefinition。

## 任务清单

### A. 管线 1–3（M0）
- [ ] `PackageSource` 接口 + `InMemoryPackageSource`（Record<path, content>）
- [ ] collect：DD-02 目录聚合（`scenes/<areaId>/<sceneId>.yaml`，area 字段与目录不一致 → warning）
- [ ] parse + validate：逐域 Zod、重复 ID（DUP_ID）、语言包加载与主语言缺失 warning

### B. 管线 4–7（M1）
- [ ] crossRef：refKind 元数据驱动的悬空引用检查（跳转/物品/NPC/媒体/文本键 → DANGLING_REF）
- [ ] compile：exprCache、PoolIndex（byScope/mutex）、任务与成就 refs 反查表、mediaCatalog
- [x] scripts 步骤：宿主注入 ScriptModule → 23 号注册 → 注册表冻结（此时段 `x.*` 悬空校验）
- [ ] freeze：GameDefinition 深冻结 + 运行期不可变测试

### C. 诊断与夹具
- [ ] `Diagnostic[]` 汇总（error 阻断 / warning 入 definition）；负例夹具逐个断言 ErrCode
- [ ] mini-game 加载端到端测试（夹具 → definition 断言索引内容）

## 完成定义
- [ ] 全部子任务勾选；负例夹具全红（能报出）、mini-game 全绿（能加载）
