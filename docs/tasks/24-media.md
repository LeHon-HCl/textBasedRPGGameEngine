# 24 媒体解析（引擎侧）

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.10（MediaIntent，DD-05） |
| 需求映射 | FR-MEDIA-01～06（引擎半边）、FR-MEDIA-08/09 在 25 号 |
| 前置模块 | 06（mediaCatalog）、08（渲染 intent） |
| 里程碑 | M1 |

> 目标：引擎只产出媒体意图与校验存在性；播放归 runtime-ui（解耦可测）。

## 任务清单

- [ ] `MediaCatalog`：assetId → {path, hash, preload, type} 解析 + 缺失 → warning + 占位 intent（FR-MEDIA-06）
- [ ] 场景/区域绑定 → bg/bgm intent（进入场景时产出）
- [ ] 立绘差分：sprite intent + 变体条件表达式求值（好感/身体/服装驱动）
- [ ] 段落级 CG intent + `seen.gallery` 解锁位（FR-MEDIA-04，图鉴数据源）
- [ ] `media` 指令（sfx 一次性播放意图）与 `notify` 分离验证
- [ ] intent 序列断言测试（进入场景 → 段落 → 选项的完整 intent 流）

## 完成定义
- [ ] 全部子任务勾选；intent 流测试全绿（无任何图像/音频依赖）
