# 26 可视化编辑器

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §7.1～7.9（DD-03/12） |
| 需求映射 | FR-EDTR-01～19 |
| 前置模块 | engine 全家（试玩嵌入）、02（表单源）、shared validation |
| 里程碑 | M3（M4 收发布向导） |

> 目标：作者工具全链路——FS 适配、DocModel、表单引擎、画布、校验中心、翻译管理、发布向导。

## 任务清单

### A. 地基（M3 前 half）
- [ ] `FsAdapter` 三实现：Electron fs / File System Access API / 只读目录+zip 导出降级（caps 标注）
- [ ] `DocModel`：内存镜像、update lens、YAML 稳定序列化（键序/diff 友好）、保存写盘
- [ ] 自动快照到 `.editor-backups/`（环形 20）+ 崩溃恢复 diff
- [ ] 项目管理：新建（模板/空白）/打开/最近列表（FR-EDTR-01）

### B. 编辑能力（M3 中）
- [ ] Zod→表单引擎（FieldSpec 走查 + widget meta）+ 8 类控件（text-input/text-key/expr-editor/id-ref/effect-list/asset-picker/tag-picker/expr-or-value）
- [ ] 数据库编辑器：全部数据域零逐表定制接入 + Zod 即时报错（FR-EDTR-07）
- [ ] 场景画布：节点/边派生自场景数据、区域分组、minimap、折叠+视口虚拟化（2000 节点基准，FR-EDTR-05）
- [ ] 大纲树 + 双击定位 + 拖拽改归属（area 变更文件移动确认）
- [ ] 表达式编辑器：CodeMirror 语法包 + 上下文补全 + 错误标注 + 试算（FR-EDTR-08）
- [ ] 效果构建器：指令编排/排序/条件包裹/子表单 + 源码视图切换（FR-EDTR-09）
- [ ] 素材库：导入/预览/引用计数/未使用清单（FR-EDTR-02）

### C. 预览与质量（M3 后 half）
- [ ] 试玩嵌入 `<PlayerShell>` + 增量热更新（软重载保留 GameState）
- [ ] 预览调试：变量监视/跳转/时间快进/周目模拟/直发事件战斗结局/作弊面板（FR-EDTR-11）
- [ ] 多语言预览 + 缺失键高亮（FR-EDTR-12）+ 身体状态快捷位预览（FR-BODY-03）
- [ ] 校验中心 UI：12 条 shared 规则诊断列表 + 定位跳转 + error 门禁视图（DD-12 复用验证）
- [ ] ID 稳定性检查：删除/改名警告 + redirects 建议生成（FR-EDTR-16）
- [ ] 翻译管理：字符串总表（缺失/过期/占位符不一致）+ CSV/XLIFF 往返幂等（FR-EDTR-13/14）
- [ ] 发布向导：semver+changelog → ID diff → 迁移脚手架生成 → 阻断门禁（touchState/error/ID）→ 调 exporter（FR-EDTR-17）
- [ ] 编辑器自身 i18n（中/英）+ 文本键变更对比报告（FR-EDTR-18/19）
- [ ] 测试：DocModel 往返/表单生成/规则单测/翻译幂等 + Playwright 编辑器流（建项→编辑→校验→导出）

## 完成定义
- [ ] 全部子任务勾选；「零手写 JSON 完全用编辑器复刻 mini-game」验收达成（M3 验收标准）
