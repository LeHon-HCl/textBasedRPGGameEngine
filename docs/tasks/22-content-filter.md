# 22 内容分级与过滤

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.8 |
| 需求映射 | FR-CGRD-01～05、D13 |
| 前置模块 | 02（tags schema）、04（settings） |
| 里程碑 | M1（机制）–M4（向导与验收） |

> 目标：单点 ContentFilter——事件池/渲染/选项三应用点，设置即时生效。

## 任务清单

- [ ] `ContentFilter` 构造（ContentTagsDef + disabledTags）+ `passes/eventAdmissible/placeholderFor` 谓词
- [ ] 应用点 1：事件池 prune 接入（10 号配合）
- [ ] 应用点 2：段落渲染前占位替换（游戏提供的占位文本键）
- [ ] 应用点 3：选项 `choices()` 隐藏（8 号配合）
- [ ] 设置变更 → 重建实例 → 当前场景重渲染（即时生效测试）
- [ ] 首启向导数据支撑：settings.wizardDone 标志 + manifest.contentWarning 文案键
- [ ] 任务降级属于静态校验（26 号 filter-quest-break 规则）边界说明与测试注释
- [ ] 谓词矩阵测试（标签组合 × 三应用点 × 占位回退）

## 完成定义
- [ ] 全部子任务勾选；谓词矩阵全绿；「屏蔽某标签后事件不触发、选项隐藏」集成用例通过
