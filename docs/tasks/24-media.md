# 24 媒体解析（引擎侧）

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.10（MediaIntent，DD-05） |
| 需求映射 | FR-MEDIA-01～06（引擎半边）、FR-MEDIA-08/09 在 25 号 |
| 前置模块 | 06（mediaCatalog）、08（渲染 intent） |
| 里程碑 | M1 |

> 目标：引擎只产出媒体意图与校验存在性；播放归 runtime-ui（解耦可测）。

## 任务清单

- [x] `MediaCatalog`：assetId → {path, hash, preload, type} 解析 + 缺失 → warning + 占位 intent（FR-MEDIA-06）
- [x] 场景/区域绑定 → bg/bgm intent（进入场景时产出；区域为逐项回落层，FR-MEDIA-02）
- [x] 立绘差分：sprite intent + 变体条件表达式求值（好感/身体/服装驱动）
- [x] 段落级 CG intent + `seen.cg` 解锁位（FR-MEDIA-04，图鉴数据源）
- [x] `media` 指令（sfx 一次性播放意图）与 `notify` 分离验证
- [x] intent 序列断言测试（进入场景 → 段落 → 选项的完整 intent 流）

## 完成定义
- [x] 全部子任务勾选；intent 流测试全绿（无任何图像/音频依赖）

## 实现记录（2026-09-14）

- **任务 1**：`engine/src/media/`——`MediaResolver.decorate()` 只做存在性核对与
  缺失标记（意图形态归调用方，避免语义在解析器里分叉）；`lookup()` 免告警查询；
  告警按 assetId 去重。
- **任务 2**：`SceneRunnerDef` 增 `areas`（区域绑定）与 `npcs`（差分声明）两个
  结构化最小视图；`SceneRunner.#createFrame()` 场景声明优先、逐项回落区域
  （FR-MEDIA-02）。shared 侧 `mediaBindingSchema` 统一场景/区域绑定形态。
- **任务 3**：`spriteDeclSchema`（旧字符串形态 | `{base, variants[{when, asset}]}`）；
  选择语义 = 声明序 × 变体序首个命中 → 回落 base → 无产出（求值经
  `evalSpriteCondition` 注入，表达式复用加载期 exprCache）。
- **任务 4**：`segmentSchema` 增可选 `cg` / `sprite`（立绘只声明 npc，资产由
  NpcDef 差分声明选出——差分逻辑只有一份）；段落计划改携带源段落引用
  （`ExpandedSegment`）使媒体在揭示时可查；CG 揭示即登记 `seen.cg`
  （`GameRuntime.markCgSeen`，只读会话与屏蔽段落不登记）。
- **任务 5**：`EffectRegistryOptions.mediaResolver`（effects 侧同口径最小视图）；
  media/notify 两通道分离断言（类型不同、订阅面独立、不写状态）。
- **任务 6**：真实管线端到端测试（InMemory 包源含 assets/ 二进制 → 七步加载 →
  MediaResolver → SceneRunner），断言全 intent 序列与缺失占位路径。
- **顺带修复（管线缺口）**：`GameDefinition` 补发布八个实体域
  （npcs/items/quests/shops/achievements/perks/endings/factions）——此前 validate
  已校验、crossRef/scripts 已消费，但 freeze 组装漏发布，导致宿主无法投影装配
  运行时目录（`GameRuntimeOptions.itemDefs` 的 TSDoc 已假定可注入）。
- 设计偏差记录：FIG-GAL 图鉴域为 `seen.cg`（§3.1 勘误已将 gallery=场景回想、
  cg=插图分开）；本模块按勘误实现（任务清单原文写 `seen.gallery` 系沿用旧文）。
