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
| **M1 运行时 MVP** | 3 区域 / 10+ 事件 / 2 任务线 demo | 🔍 开发完成，**审查报告已出、待人工验收**（9 条验收路径全部验证通过） |
| **M2 判定战斗 + 成就周目 + QoL** | — | 🚧 阶段一–六已实现（15/16/17/18/19/23）；25B QoL 已交付；**验收四条待逐条过**（第 4 条「回滚 5 步」已通过） |
| M2.5 存档迁移机制 | 旧档回归门禁入 CI | 未开始 |
| M3 可视化编辑器 | 零手写 JSON 复刻 mini-game | 未开始 |
| M4 打磨与分发 | 导出静态包 | 未开始 |

### 已实现（有代码 + 测试覆盖）

| 层 | 模块 |
|---|---|
| shared | ID 体系 / `EngineError` 三元组 / 可复现 RNG；24 个数据域的 Zod Schema（含 JSON Schema 快照守护）；表达式 AST 规格类型 |
| engine | **22 个子系统**：表达式求值器（03）、状态树与事务（04）、效果指令系统 27 条作者可见 + 9 条内部（05）、七步加载管线（06）、文本解析与本地化（07）、叙事运行时状态机（08）、时间推进管线（09）、事件系统（10）、任务系统（11）、NPC 与阵营（12）、物品装备与多层服装（13）、身体与变身（14）、CoC 式 d100 判定（15）、回合制战斗（16）、经济与商店（17）、成就与元进度（18）、周目系统（19）、存档系统（20）、内容分级过滤（22）、作者脚本宿主（23）、媒体解析（24） |
| runtime-ui | 玩家界面（25）：渲染管线（resolve→插值→sanitize→打字机）、AppShell 响应式布局、状态/地图/任务/设置面板、Toast、首启内容向导、**阅读 QoL**（已读跳过 / 自动播放 / 回滚 / 历史回看 / 快捷键）、判定呈现与战斗面板、商店面板、成就图鉴、调试面板、Dexie 持久化适配 |
| apps | `player-demo`（React 宿主页，M1/M2 验收载体） |

进度明细见 [`docs/tasks/progress.md`](docs/tasks/progress.md)；
**已实现架构的权威描述**见 [`docs/architecture.md`](docs/architecture.md)（含数据流图与子系统索引）。

### 尚未实现

存档迁移（21，M2.5）、编辑器内核与应用（26，M3）、静态包导出（27，M4）、
25 号 C 组收尾（回想/结局/CG 图鉴、统计页、媒体播放器、Playwright E2E 扩用例）、
P2 功能包（28，M5）。

## 仓库结构

```
apps/
  player-demo/      玩家端 demo（React + Vite，验收载体）
  editor-app/       可视化编辑器应用（占位）
packages/
  shared/           基础类型、Schema、表达式、RNG、错误体系
  engine/           引擎核心（22 个子系统：加载器、状态、效果、叙事、时间、事件、任务、
                    判定、战斗、经济、成就、周目、存档、内容过滤、脚本宿主、媒体…）
  runtime-ui/       玩家界面组件（React，受控 props + Zustand store）
  editor/           编辑器内核（占位，M3）
  exporter/         静态包导出（占位，M4）
fixtures/
  mini-game/        demo 游戏包（manifest + data + locales）
  negatives/        负例夹具（每包一个预期错误码）
  helpers/          跨包测试支撑（包源实现、适配器契约套件）
docs/
  architecture.md   已实现架构（人类入口：数据流图 + 子系统索引）
  proposal.md       需求基线（FR/NFR 编号定义处）
  detail-design.md  详细设计（§ 与 DD-* 决策）
  develop.md        开发流程规范（十一条约束 + PR 自审清单）
  plans/            里程碑/阶段开发计划与子 Agent 派发材料
  reviews/          里程碑审查报告 + demo 问题清单
  retros/           事件反思报告（异常复盘）
  tasks/            任务拆分与进度
  archive/          已归档文档（不再生效，仅作溯源）
study/              新人学习目录 —— **与项目无关，日常开发请忽略**
                    （不参与任何门禁、不属文档体系；见其自带 README）
e2e/                Playwright 玩家流冒烟（里程碑验收用，非默认门禁）
scripts/
  validate-docs.mjs 文档一致性校验（编号引用 / 任务登记 / 架构与代码结构一致）
  setup-git-hooks.mjs 启用 .githooks（pnpm install 经 prepare 自动调用）
```

## 快速开始

需要 **Node ≥ 20** 与 **pnpm 10**（版本由根 `package.json` 的 `packageManager` 字段锚定）。

```bash
pnpm install
pnpm dev:player     # 启动玩家端 demo，浏览器打开提示的地址即可游玩
```

`pnpm dev:player` 会加载 `fixtures/mini-game` 这个最小游戏包（React 宿主页
`apps/player-demo`）：首启内容向导 → 三个区域探索（石板路口 / 旧镇 / 河畔）
→ 事件与任务 → CoC 式判定 → 回合制战斗 → 商店交易 → 成就图鉴，
并含阅读 QoL（跳过 / 自动播放 / 历史回看 / 回退一步 / 快捷键）。
`?dev=1` 可在 URL 上开启开发者模式（地图全量列出未解锁区域）。

```bash
pnpm dev:editor     # 启动编辑器（M3 开发中）
pnpm e2e            # Playwright 玩家流冒烟（需先 pnpm e2e:install；非默认门禁）
```

## 开发命令

| 命令 | 说明 |
|---|---|
| `pnpm test` | 全量单元测试（Vitest） |
| `pnpm test:coverage` | 带覆盖率报告（门禁标准：shared ≥ 90% / engine ≥ 80% / runtime-ui ≥ 80%） |
| `pnpm lint` | ESLint（含依赖规则 R1–R5）+ Prettier 检查 |
| `pnpm format` | Prettier 格式化 |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm build` | 递归构建所有包 |
| `node scripts/validate-docs.mjs` | 文档一致性校验 |

> **注意**：不要从 `packages/<pkg>/` 目录内直接跑 vitest——会解析到 `dist`（构建产物，
> 不入库）而非源码，产生假失败。统一从仓库根跑：
> `pnpm exec vitest run --root . packages/engine`

## 质量门禁

CI（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）在 `main` 的 push 与所有 PR 上
执行**四道门禁**：

| # | 命令 | 内容 |
|---|---|---|
| 0 | `pnpm install --frozen-lockfile` | 锁文件一致性 |
| 1 | `pnpm -w lint && pnpm -w test` | eslint + prettier；全量单元测试 |
| 2 | `pnpm -w build && pnpm -w typecheck` | 递归构建 + 全仓类型检查 |
| 3 | `node scripts/validate-docs.mjs` | 文档一致性（含架构文档与代码结构一致性校验） |

（测试规模随开发增长，不在此处维护具体数字——实时数量见 CI 输出与
[`docs/tasks/progress.md`](docs/tasks/progress.md)。）

本地提交前应跑同样的命令。开发流程与 PR 自审清单见 [`docs/develop.md`](docs/develop.md)：
改动走分支 → 严格 TDD → PR → AI 自审 + CI 绿 → rebase 合入（`main` 禁止直接提交；
该约束有 `.githooks/` 双钩子机械化兜底，`pnpm install` 自动启用）；
**里程碑收尾由人工验收把关**。

## 文档导航

按「先读哪个」排序：

1. [`README.md`](README.md) — 本文件，项目入口与快速开始
2. [`docs/architecture.md`](docs/architecture.md) — **已实现架构**：一次点击的数据流、
   加载管线、子系统索引（想改代码先看这里）
3. [`docs/proposal.md`](docs/proposal.md) — 需求基线，FR/NFR 编号定义处 + 关键决策 D1–D15
4. [`docs/detail-design.md`](docs/detail-design.md) — 详细设计，§x.y 接口签名 + DD-* 决策
5. [`docs/develop.md`](docs/develop.md) — 开发流程十一条约束 + PR 自审清单
6. [`docs/tasks/progress.md`](docs/tasks/progress.md) — 里程碑与模块进度总表
7. [`docs/reviews/`](docs/reviews/) / [`docs/retros/`](docs/retros/) — 里程碑审查 / 事件反思
8. [`docs/plans/`](docs/plans/) — 阶段开发计划、未入档事项清单、子 Agent 派发材料
9. [`docs/archive/`](docs/archive/) — 已归档文档（不再生效）

> 需求变更须先更新 `docs/proposal.md` 并单独提交，再落实现代码。
>
> `study/` 是新人学习目录，**不属于文档体系**，开发时请忽略（见
> [`study/README.md`](study/README.md) 的忽略声明）。
