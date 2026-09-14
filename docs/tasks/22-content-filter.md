# 22 内容分级与过滤

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.8 |
| 需求映射 | FR-CGRD-01～05、D13 |
| 前置模块 | 02（tags schema）、04（settings） |
| 里程碑 | M1（机制）–M4（向导与验收） |

> 目标：单点 ContentFilter——事件池/渲染/选项三应用点，设置即时生效。

## 任务清单

- [x] `ContentFilter` 构造（ContentTagsDef + disabledTags）+ `passes/eventAdmissible/placeholderFor` 谓词
- [x] 应用点 1：事件池 prune 接入（10 号配合）——本模块提供 `eventAdmissible` 判据与桩测试；真实 prune 管线接线归 10 号事件系统（设计 §5.8 / §4.4）
- [x] 应用点 2：段落渲染前占位替换（游戏提供的占位文本键）
- [x] 应用点 3：选项 `choices()` 隐藏（8 号配合）
- [x] 设置变更 → 重建实例 → 当前场景重渲染（即时生效测试）
- [x] 首启向导数据支撑：settings.wizardDone 标志 + manifest.contentWarning 文案键
  - wizardDone 数据支撑：02 号 schema + 04 号状态树承载；`ContentFilter.initialDisabledTags()` 由 `defaultOn` 投影初始开关态
  - contentWarning 读取路径：shared `manifestSchema` 已勘误增列 `contentWarning`（FR-CGRD-04）；引擎提供 `contentWarningKey(manifest)` / `resolveContentWizard(settings, manifest)`，从 `GameDefinition.manifest` 透传到宿主可用值（缺省无该键 → null）
  - 用例：`test/content/wizard-data.test.ts`（11 用例，含经真实加载器透传「有该键 / 无该键」两情形）
- [x] 任务降级属于静态校验（26 号 filter-quest-break 规则）边界说明与测试注释
- [x] 谓词矩阵测试（标签组合 × 三应用点 × 占位回退）

## 完成定义
- [x] 全部子任务勾选；谓词矩阵全绿；「屏蔽某标签后事件不触发、选项隐藏」集成用例通过
  - 谓词矩阵（`test/content/predicate-matrix.test.ts`，30 用例）与「屏蔽标签 → 事件桩不触发 + 选项隐藏」集成用例（`event-pool-stub.test.ts` / `option-filter.test.ts`）全绿
