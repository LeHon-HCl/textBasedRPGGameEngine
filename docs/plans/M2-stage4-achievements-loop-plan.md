# M2 阶段四开发计划 —— 成就与元进度（18 号）+ 周目系统（19 号）

> 范围：`docs/plans/M2-plan.md` 阶段 4（模块 18 九个子任务 + 模块 19 七个子任务，见
> `docs/tasks/18-achievements.md` / `19-loop.md`）。
> 组织方式：**全单线**（2026-09-21 人类裁定）+ **并行工作包**（同批用
> `docs/plans/collaboration-template.md` 的结构做内部拆分，无外部协作者）。
> 流程约束见 `docs/develop.md`（含合并规程）。

## 0. 总述

### 目标与验收（proposal §7 阶段四对应项）

- 成就：`AchievementEvaluator`（增量 + 兜底全量）、progress 型投影、解锁链路
  （引擎不写 IO）、`ProfileStore`（含内存实现）、Perk 购买两步协议、新档 bootstrap、
  `resetPoints`、隐藏成就投影、回滚不回滚成就；
- 周目：`applyLoopTransition` 纯函数（五形态策略）、`loop` 变量域、`EndingDef.nextLoop`
  转场摘要、切换后强制重建、与迁移次序、双循环边界；
- **M2 验收标准**：demo「10+ 成就、3+ Perk」「同存档进入第二周目且继承清单生效」用例通过。

### 工作包划分（并行结构）

```
P0 契约冻结 + 前置（串行，一次交付）
  ├── achievements/types.ts（AchievementUnlocked / ProfileStore / Profile 视图）
  ├── loop/types.ts（LoopTransitionResult / LoopSummary）
  └── 两处 schema 复核（achievement/perk/loop 已由 M1 建，确认字段够用）
       ↓
  ├── 并行线 A：A1 评估器 → A2 progress 型 → A3 解锁链路 + 隐藏成就
  ├── 并行线 B：B1 ProfileStore（内存 + 乐观锁）→ B2 两步协议 → B3 resetPoints + 新档 bootstrap
  └── 并行线 C：C1 applyLoopTransition 纯函数 → C2 loop 变量域 + 转场摘要 → C3 重建与次序
       ↓
  P4 收口：demo 内容（10+ 成就 / 3+ Perk / 周目继承清单）+ 双循环边界 + docs + E2E
```

| 工作包 | 内容（子任务） | 文件落点 | commit |
|---|---|---|---|
| **P0** | 两子系统契约冻结（类型 + 视图面）；schema 复核结论 | `achievements/types.ts`、`loop/types.ts` | 1 |
| **A1** | `AchievementEvaluator`：refs 增量评估（TouchReport）+ 每时段兜底全量 | `achievements/evaluator.ts` | 2 |
| **A2** | progress 型成就（progressExpr → cur/goal）+ 进度条数据 | 同上 | 1 |
| **A3** | 解锁链路（事件 → 宿主 mutate 验证）+ 隐藏成就投影 + 收集率 + 回滚不滚成就 | 同上 + 边界测试 | 2 |
| **B1** | `ProfileStore` 接口 + 内存实现（乐观锁版本） | `achievements/profile.ts` | 1 |
| **B2** | Perk 购买两步协议（扣点 → 建档失败补偿回加，失败序覆盖） | `achievements/perks.ts` | 2 |
| **B3** | `resetPoints` 协议 + 新档 bootstrap（PerkDef.effects 执行一次） | 同上 | 2 |
| **C1** | `applyLoopTransition` 纯函数（先 reset → 逐类 apply；五形态策略） | `loop/transition.ts` | 2 |
| **C2** | `loop` 变量域接通 + `EndingDef.nextLoop` → 转场摘要（LoopSummary） | `loop/summary.ts` | 1 |
| **C3** | 切换后强制步骤（recomputeDerived + 缓存重建）+ 与迁移次序（DD-10） | 同上 + 集成断言 | 2 |
| **P4** | demo 内容 + 双循环边界 + docs 收尾 + E2E | `fixtures/mini-game` | 3 |

依赖：A 线与 B 线共享 `achievements/types.ts`（P0 冻结）；B2 依赖 B1；C 线独立于 A/B
（仅 C3 的「双循环边界」需 A3 的结局收集面）；P4 依赖全部。

### 接口草案（P0 冻结面）

```ts
// achievements/types.ts
export interface AchievementUnlocked { id: GameId; points: number; progress?: { cur: number; goal: number } }
export interface Profile { schemaVersion: number; achievements: Record<GameId, {...}>; points: number; purchasedPerks: { id: GameId; at: number }[]; endings: GameId[] }
export interface ProfileStore { load(): Promise<Profile>; mutate(fn: (p: Draft<Profile>) => void): Promise<void> }

// loop/types.ts
export interface LoopSummary { loop: number; days: number; events: number; achievements: number }
export interface LoopTransitionResult { nextState: GameState; summary: LoopSummary; openingScene: GameId }
```

### 验收效果

- 18 号：评估矩阵 + 两步协议失败序测试全绿；demo 10+ 成就 / 3+ Perk 可解锁可购买；
- 19 号：策略矩阵（含 keepRatio 与白名单例外）+ 次序断言测试全绿；
- **「同存档进入第二周目且继承清单生效」用例通过**（M2 验收标准第 3 条）；
- 全门禁 + validate-docs + C1–C11 绿。

## 1. 风险

| 风险 | 缓解 |
|---|---|
| Profile 是引擎外（宿主 Dexie），接口边界易混 | 严格按 DD-04：engine 只定接口 + 内存实现，Dexie 归 25 号 |
| 周目继承涉及全部状态类别，易漏 | C1 用策略矩阵测试逐类覆盖；类别清单以 `loopCategorySchema` 为准 |
| 成就评估的性能（每事务全量） | A1 走 refs 增量 + 时段兜底（与任务系统同机制） |
| 19 号与 21 号迁移次序耦合 | C3 只做断言与文档口径（迁移实现归 M2.5），不提前实现迁移 |
