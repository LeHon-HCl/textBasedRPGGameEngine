# 文字 RPG 冒险游戏引擎（textBasedRPGGameEngine）

一个纯前端的**文字冒险 / 文字 RPG 引擎 + 可视化编辑器**：数据驱动、高自由度多区域探索、
事件/任务驱动、CoC 式 d100 判定与回合制战斗、双循环进度（同存档周目 + 跨存档成就增益）、
原生多语言、长线版本演进（引擎更新不废档）。

技术基线：**React + TypeScript，纯前端，无后端**。游戏包为 JSON/YAML 数据文件 + 受限表达式语言，
剧本文本与逻辑彻底解耦（文本键引用 + 按语言分包），导出后是静态文件包，任意静态托管即可游玩。

> 目标定位接近 Twine/SugarCube 的创作体验，但把系统深度（时间、日程、服装、好感、事件池）、
> 工程化（i18n / 存档兼容 / 内容分级）作为引擎内置能力，让作者只需关心剧情与设计。

## 当前状态

| 里程碑 | 目标 | 状态 |
|---|---|---|
| **M0 技术验证** | 3 场景分支 demo 浏览器可玩 | ✅ 已完成（2026-09-13 验收通过） |
| M1 运行时 MVP | 3 区域 / 10+ 事件 / 2 任务线 demo | 🚧 进行中 |
| M2 判定战斗 + 成就周目 + QoL | — | 未开始 |
| M2.5 存档迁移机制 | 旧档回归门禁入 CI | 未开始 |
| M3 可视化编辑器 | 零手写 JSON 复刻 mini-game | 未开始 |
| M4 打磨与分发 | 导出静态包 | 未开始 |

已实现（有实现代码并覆盖测试）：

- **shared** — ID / 错误体系 / 可复现 RNG、Schema 体系与校验、表达式 AST 与类型定义
- **engine/expr-eval** — 受限表达式语言求值器（白名单 + 内置函数）
- **engine/state** — GameState 与状态事务
- **engine/effects** — 效果指令系统（状态类指令）
- **engine/loader** — 游戏包加载器（七步管线，含静态表达式报错）
- **engine/i18n** — 文本解析与本地化运行时（文本键、变体、插值、词典矩阵）
- **engine/narrative** — 叙事运行时状态机（段落推进、选项分支、场景进入条件、历史缓冲）
- **engine/runtime** — 运行时装配

其余模块（时间、事件、任务、NPC/阵营、物品/装备/服装、身体、判定、战斗、经济、成就、周目、
存档、迁移、内容过滤、脚本宿主、媒体、runtime-ui、编辑器、导出）已在计划中，尚未实现。

进度明细见 [`docs/tasks/progress.md`](docs/tasks/progress.md)。

## 仓库结构

```
apps/
  player-demo/      玩家端 demo（Vite，M0 验收入口）
  editor-app/       可视化编辑器应用
packages/
  shared/           基础类型、Schema、表达式、RNG、错误体系
  engine/           引擎核心（加载器、状态、效果、叙事、i18n…）
  runtime-ui/       玩家界面组件
  editor/           编辑器内核
  exporter/         静态包导出
fixtures/
  mini-game/        demo 游戏包（manifest + data + locales）
  negatives/        负例夹具（校验/表达式报错的期望输入）
docs/
  proposal.md       需求文档（基线）
  detail-design.md  详细设计
  tasks/            任务拆分与进度
scripts/
  validate-docs.mjs 文档一致性校验
```

## 快速开始

需要 **Node ≥ 20** 与 **pnpm 10**（版本由根 `package.json` 的 `packageManager` 字段锚定）。

```bash
pnpm install
pnpm dev:player     # 启动玩家端 demo，浏览器打开提示的地址即可游玩
```

`pnpm dev:player` 会加载 `fixtures/mini-game` 这个最小游戏包：走完加载管线和文本解析，
在 `arrival` 场景渲染文本，推进段落后出现选项（「去集市看看」/「往镇口去」），
分别分支到 `market_street`（可二级分支返回）与 `town_gate`。

```bash
pnpm dev:editor     # 启动编辑器（开发中）
```

## 开发命令

| 命令 | 说明 |
|---|---|
| `pnpm test` | 全量单元测试（Vitest） |
| `pnpm test:coverage` | 带覆盖率 |
| `pnpm lint` | ESLint + Prettier 检查 |
| `pnpm format` | Prettier 格式化 |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm build` | 递归构建所有包 |
| `node scripts/validate-docs.mjs` | 文档一致性校验（编号交叉引用、任务登记、占位符） |

## 质量门禁

CI（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）在 `main` 的 push 与所有 PR 上执行三步门禁：

1. `pnpm install --frozen-lockfile`
2. `pnpm -w lint && pnpm -w test`
3. `node scripts/validate-docs.mjs`

本地提交前应跑同样的命令。仓库约定（见 [`AGENTS.md`](AGENTS.md)）：每次改动都要带对应 commit，
并且必须补/改测试、确保全部测试与校验通过后才交付。

## 文档导航

- [`docs/proposal.md`](docs/proposal.md) — 需求文档，含全部关键决策记录（D1–D15），是需求基线
- [`docs/detail-design.md`](docs/detail-design.md) — 详细设计，模块清单与设计决策（DD-*）
- [`docs/tasks/progress.md`](docs/tasks/progress.md) — 里程碑与模块进度总表
- [`AGENTS.md`](AGENTS.md) — 协作与提交约定

> 需求变更须先更新 `docs/proposal.md` 并单独提交，再落实现代码。
