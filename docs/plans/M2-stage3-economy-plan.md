# M2 阶段三开发计划 —— 经济与商店（17 号）+ M1 遗留清理

> 范围：`docs/plans/M2-plan.md` 阶段 3（模块 17，8 个子任务，见 `docs/tasks/17-economy.md`）。
> 组织方式：**全单线**（2026-09-21 人类裁定：阶段三全程由 A 方完成，不启用双人分工）；
> 采用多人协作模板的**串并行结构**（`docs/plans/collaboration-template.md`）纯粹为了
> 内部工作包拆分与「认领-交付」节奏，无外部协作者参与。
> 流程约束（分支-PR、TDD、门禁、合并规程）见 `docs/develop.md`，本文不重复。

## 0. 总述

### 目标与验收（proposal §7 阶段三对应项）

- `ShopService` 全量：条目投影（showIf + 库存）、定价表达式、买卖原子事务、
  回购价一致性、补货管线钩子、交易完成效果 + trade 事件；
- **M1 遗留清账两项**（本次一并做，避免长期挂账）：
  ① 移除 `content-graph.test.ts` 的 **C5 检豁免**（shop 指令落地后恢复实判）；
  ② 新增 **`meet: { npc: '<id>' }` 指令**（人类 2026-09-21 裁定：独立指令形态，
  语义最清晰）——补 `npc.<id>.met` 的写入口，清理「只读不写」的语义缺口；
- demo 商店开张（可买可卖可回购，价格随状态变化），C1–C11 全绿。

### 工作包划分（并行结构）

```
S0 前置（串行，一次交付）
  ├── shop 指令壳 + ShopService 接口冻结（types 面）
  └── meet 指令（独立小包，与 S0 同批）
       ↓
  ├── 并行线 A：S1 条目投影 + 定价（纯函数层，零事务依赖）
  ├── 并行线 B：S2 交易事务 + 回购 + trade 事件（依赖 S0 接口，事务面）
  └── 并行线 C：S3 meet 指令补全 + C5 豁免移除（独立于 A/B，随时可做）
       ↓
  S4 收口：补货管线钩子 + demo 商店 + 连通性检查 + docs
```

| 工作包 | 内容（对应子任务） | 文件落点 | 预估 commit |
|---|---|---|---|
| **S0** 接口冻结 + 指令壳 | `ShopService` 接口与视图类型（`economy/types.ts`）；`shop` 效果指令注册（emit `shop_open` 事件，宿主 UI 消费）；`meet` 指令（`effects/builtins/relations.ts`） | `economy/types.ts`、`economy/index.ts`、`effects/builtins/shop.ts`、`effects/builtins/relations.ts`、shared `effects.ts`（指令表） | 2 |
| **S1** 条目投影 + 定价 | `entries()`（showIf 过滤 + 库存投影（无 stock = 无限））、`priceOf`（priceBuy/priceSell 表达式求值 + modifierKeys 折扣理由） | `economy/shop-service.ts`（投影与定价段） | 3 |
| **S2** 交易事务 | `buy`/`sell` 原子事务（扣钱+给物同批，钱不够/超库存回滚）、回购价 = 当次卖价（会话内一致）、trade 事件 emit | `economy/shop-service.ts`（事务段）+ `runtime/engine-events.ts`（TradeEvent） | 3 |
| **S3** M1 遗留清理 | `meet` 指令补全（写 `npc.<id>.met`）+ C5 豁免移除（content-graph 实判） | `content-graph.test.ts`、`effects/builtins/relations.ts` | 2 |
| **S4** 收口 | restock（day_rollover 管线钩子）+ demo 商店数据（`data/shops.yaml` + 场景入口 + 双语键）+ 定价矩阵/原子性测试 + docs | `economy/restock.ts`、`fixtures/mini-game` | 4 |

依赖关系：S1/S2/S3 互相独立（S2 依赖 S0 接口，S1 纯函数无依赖，S3 完全独立）；
S4 依赖 S1+S2。

### 接口草案（S0 冻结面）

```ts
// economy/types.ts —— 冻结后只增不改
export interface ShopEntryView {
  itemId: GameId;
  /** 当前买价（已求值）；不可购买（钱不够等）由 UI 侧判断，本视图只报价格 */
  priceBuy: number;
  priceSell: number;
  /** 剩余库存（undefined = 无限） */
  stock?: number;
  /** 折扣理由文本键（可选显示，FR-ECON-03） */
  modifierKeys?: readonly TextKey[];
}
export interface ShopService {
  entries(shopId: GameId): ShopEntryView[];
  priceOf(shopId: GameId, itemId: GameId, mode: 'buy' | 'sell'): { amount: number; currency: GameId };
  buy(shopId: GameId, itemId: GameId, count: number): ExecOutcome;
  sell(shopId: GameId, itemId: GameId, count: number): ExecOutcome;
}
```

- 定价上下文：每次求值注入当前状态（声望/时段/周目/好感即普通变量，§5.3）；
- 回购一致性（FR-ECON-03）：sell 时把本次卖价登记进会话内 map，
  同会话内 buy-back 用同一价格；
- trade 事件：`{ type: 'trade'; shopId; itemId; mode: 'buy'|'sell'; count; amount; currency }`。

### 验收效果

- 定价表达式矩阵（声望阈值/时段/周目变量）+ 原子性（钱不够/超库存回滚）+ 回购一致性
  测试全绿（17 号完成定义）；
- **C5 检实判全绿**（豁免移除后，demo 商店有真入口）；
- meet 指令：`npc.<id>.met` 写入后，依赖它的条件表达式真实翻转（M1 遗留闭合）；
- demo 商店可买可卖可回购，全门禁 + validate-docs 绿。

## 1. 与阶段二的经验对照（复盘报告落地检验）

| 阶段二教训 | 本阶段做法 |
|---|---|
| 契约漂移风险 | S0 先冻结 `economy/types.ts`（additive 原则） |
| 能力重叠（driver 撞车） | 开工前检索既有能力（本次：确认 ShopDef schema 已在 M1 建成，不重复发明） |
| 合并误操作 | 严格执行合并规程（显式 PR 号 / CI 绿后合 / 合后同步） |
| main 直写 | 切回 main 立即切新分支 |

## 2. 风险

| 风险 | 缓解 |
|---|---|
| 定价表达式的求值上下文需要 backpack/声望/time 全量变量域 | 复用 `buildExprScope`（叙事基座），与 battle.* 域同款做法 |
| 回购一致性跨会话语义 | 明确「当次会话内一致」（会话 = 商店界面打开期间），跨会话按当次新价——需求原文「当次交易内回购同价」 |
| C5 豁免移除后夹具可能红 | 与 demo 商店数据同批交付（S4 内先假数据后真入口） |
