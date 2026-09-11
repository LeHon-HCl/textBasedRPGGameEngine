# 00 Monorepo 与工程基础设施

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §1（依赖规则 R1–R5）、§4.6、§10.4 |
| 需求映射 | NFR-12/13/14、D3 |
| 前置模块 | 无 |
| 里程碑 | M0 |

> 目标：建立全部后续模块的开发地基——工作区结构、测试与 lint 工具链、公共夹具、CI。

## 任务清单

### A. 工作区骨架
- [x] `pnpm-workspace.yaml` + 根 `package.json`，创建 `packages/{shared,engine,runtime-ui,editor,exporter}`、`apps/{player-demo,editor-app}`、`fixtures/` 目录骨架
- [ ] TypeScript 基线：根 `tsconfig.base.json`（strict、NodeNext/ESM）+ 各包继承；`pnpm -w build` 可跑通空包
- [ ] 按 §10.4 建立 `shared/src`、`engine/src` 子目录占位与 `index.ts` 导出约定

### B. 测试与质量工具链
- [ ] Vitest 接入 shared/engine（workspace 共享配置），第一个冒烟测试通过
- [ ] ESLint + Prettier：`no-restricted-imports` 强制依赖规则 R1/R2（shared 零依赖、engine 禁 React/DOM）
- [ ] CI（GitHub Actions）：lint + test + `node scripts/validate-docs.mjs` 三步门禁

### C. 公共夹具
- [ ] `fixtures/mini-game/` 最小游戏包 v1：manifest + 1 区域 3 场景（含跳转与文本键）+ 词典 zh-CN
- [ ] `fixtures/negatives/` 负例目录骨架（dangling-ref / dup-id / bad-expr 各 1 例）
- [ ] 夹具加载辅助测试工具（`InMemoryPackageSource` 构造器，供 06 号模块复用）

## 完成定义
- [ ] 全部子任务勾选，`pnpm -w lint && pnpm -w test` 全绿
- [ ] CI 首次运行通过
- [ ] 依赖规则违规能被 lint 阻断（写一个故意违规的临时用例验证后删除）
