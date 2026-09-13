# 开发流程规范（develop.md）

> 本文档约束 TextGameEngine 所有开发活动（AI 代理与人类协作者）。与根目录 `AGENTS.md`、`docs/prompt.md` 冲突时，以更严格者为准。
> 生效日期：2026-09-13。修订须走标准 PR 流程。

## 四条核心约束

### 约束 1 —— 计划约束

一切开发计划（里程碑计划、模块计划、修复计划）**必须**严格按以下四节组织，缺一不可：

1. **开发目标**：做什么、达成什么可观察的结果。
2. **影响面**：涉及哪些包/模块/文档/夹具，可能破坏什么既有行为。
3. **commit 拆分**：列出每个 commit 的内容与边界（默认粒度：一个子任务 = 一次 commit）。
4. **验收效果**：可执行的验收标准（测试断言、门禁命令、人工验收步骤）。

不满足四节结构的计划不得进入实现阶段。

### 约束 2 —— 质量约束

**严格 TDD**：

- 每个子任务先写**失败测试**（红），再写实现使其通过（绿），必要时重构。
- 交付前全量测试与 lint 必须全绿；未通过不算完成。
- 修 bug 时必须先写一个能复现该 bug 的失败测试，再修复（禁止试错式打补丁）。

**分级注释规范**：

- **必须注释**：所有导出符号与公共 API——JSDoc，说明用途与约束（不变量、副作用、抛错条件）。
- **必须注释**：复杂局部变量——魔法值、非自明的中间结果、绕开直觉的逻辑分支。
- **不强制**：自明的局部变量。禁止为「下一行在做什么」写噪音注释。
- 注释使用中文；技术术语与代码标识符保留原文。

### 约束 3 —— git 主线保护

**main 分支禁止直接提交**。一切改动（含文档）按以下顺序进行：

```
git checkout -b <type>/<slug>   # 从最新 main 切出，如 feat/09-time-system
   ↓
开发（严格 TDD，子任务粒度 commit）
   ↓
git push -u origin <branch>
   ↓
gh pr create                     # PR 正文附 AI 自审清单（见下）
   ↓
review：AI 自审 checklist + CI 全绿（lint / test / validate-docs）
   ↓
gh pr merge --rebase --delete-branch   # 保持线性历史，保留子任务粒度 commit
```

- 分支命名：`<type>/<模块号>-<slug>`，如 `feat/09-time-system`、`docs/dev-process`、`fix/07-resolver-fallback`。
- commit 规范：Conventional Commits + 任务编号，沿用现有格式 `feat(engine): xxx（09 任务 A1）`。
- 本仓库当前无 GitHub branch protection（操作账号非仓库 admin），主线保护靠本约定自律；**里程碑收尾由用户人工验收把关**作为兜底。
- 若合入后发现问题，修复同样走新分支 + PR，禁止 force push main。

### 约束 4 —— 维护文档 > 维护代码

文档是人工验收代码的重要桥梁，**必须正确反映项目状态**：

- 代码变更时同步更新对应文档，与代码同一 PR 交付：
  - 新增/修改子系统、指令、管线步骤、依赖关系 → 更新 `docs/architecture.md`（见其「维护规则」一节）；
  - 完成子任务 → 勾选 `docs/tasks/NN-*.md` 对应项；模块完成 → 勾选 `docs/tasks/progress.md`；
  - 行为语义变更（超出原设计）→ 先改 `docs/proposal.md` 或 `docs/detail-design.md` 并单独提交，再落代码。
- 提交前运行 `node scripts/validate-docs.mjs` 确保文档门禁通过。

## PR 自审清单模板

每个 PR 正文附带以下清单，逐项勾选：

```markdown
## AI 自审清单
- [ ] 改动点说明：<本 PR 改了什么，为什么>
- [ ] 测试证据：<新增/更新的测试文件与用例数，全量测试输出结论>
- [ ] 影响面核查：<是否触碰依赖规则 / 公共导出面 / 冻结对象；既有行为是否兼容>
- [ ] 文档已同步：architecture.md / tasks 勾选 / progress.md / 上游设计文档（不适用打 N/A）
- [ ] 门禁：lint ✓ / test ✓ / validate-docs ✓（CI 绿链贴此处）
- [ ] 风险与遗留：<已知妥协、后续要跟进的事项；无则写「无」>
```

## 与既有文档的关系

- `AGENTS.md`：改动必带 commit、必带测试——本文件在其上细化流程，不放松任何一条。
- `docs/prompt.md`：主控循环与验收协议继续适用；本文件补充的 PR 流程在其「工作循环」之上叠加。
- `docs/tasks/progress.md`：里程碑与模块进度的唯一权威登记处。
