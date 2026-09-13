# 00 Monorepo 与工程基础设施

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §1（依赖规则 R1–R5）、§10.4；proposal §4.3（游戏包目录规范） |
| 需求映射 | NFR-12/13/14、D3 |
| 前置模块 | 无 |
| 里程碑 | M0 |

> 目标：建立全部后续模块的开发地基——工作区结构、测试与 lint 工具链、公共夹具、CI。

## 任务清单

### A. 工作区骨架
- [x] `pnpm-workspace.yaml` + 根 `package.json`，创建 `packages/{shared,engine,runtime-ui,editor,exporter}`、`apps/{player-demo,editor-app}`、`fixtures/` 目录骨架
- [x] TypeScript 基线：根 `tsconfig.base.json`（strict、NodeNext/ESM）+ 各包继承；`pnpm -w build` 可跑通空包
- [x] 按 §10.4 建立 `shared/src`、`engine/src` 子目录占位与 `index.ts` 导出约定

### B. 测试与质量工具链
- [x] Vitest 接入 shared/engine（workspace 共享配置），第一个冒烟测试通过
- [x] ESLint + Prettier：`no-restricted-imports` 强制依赖规则 R1/R2（shared 零依赖、engine 禁 React/DOM）
- [x] CI（GitHub Actions）：lint + test + `node scripts/validate-docs.mjs` 三步门禁

### C. 公共夹具
- [x] `fixtures/mini-game/` 最小游戏包 v1：manifest + 1 区域 3 场景（含跳转与文本键）+ 词典 zh-CN
- [x] `fixtures/negatives/` 负例目录骨架（dangling-ref / dup-id / bad-expr 各 1 例）
- [x] 夹具加载辅助测试工具（`InMemoryPackageSource` 构造器，供 06 号模块复用）

## 完成定义
- [x] 全部子任务勾选，`pnpm -w lint && pnpm -w test` 全绿
- [x] CI 首次运行通过
- [x] 依赖规则违规能被 lint 阻断（写一个故意违规的临时用例验证后删除）

> **CI 首次通过记录（2026-09-13，run 34765433178）**：仓库首次推送到 GitHub 后，
> CI 门禁 1 以 59 个套件失败暴露了一个此前只在本地验证、从未在真实 runner 上跑通的缺陷——
> 各包 `exports` 指向 `./dist`，而 `dist/` 不入库，`pnpm install --frozen-lockfile` 后
> 跨包导入无法解析（本地能过仅因工作区留有历史构建产物）。修复见 commit 17a9d48：
> vitest 与 player-demo 的 vite 配置把 `@game/*` 解析到各包源码，使门禁 0/1/2
> 在全新检出的无 dist 环境下依次通过。本项据此勾选。
