# 17 经济与商店

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.3 |
| 需求映射 | FR-ECON-01～04 |
| 前置模块 | 04、05（money）、13（背包）、12（声望变量） |
| 里程碑 | M2 |

> 目标：多货币、定价表达式、原子交易、库存补货。

## 任务清单

- [x] `wallet` 多货币（money 指令已支持，本模块补 ShopService 集成测试）
- [x] `entries()`：show_if 过滤 + 库存投影（含无库存字段=无限）
- [x] `priceOf`：priceBuy/priceSell 表达式求值（声望/时段/周目/好感变量可用）+ modifierKeys 折扣理由
- [x] `buy/sell` 原子事务（扣钱+给物同批；钱不够/超库存回滚）
- [x] 回购价 = 当次卖价（交易会话内一致，FR-ECON-03）
- [x] 库存 restock：day_rollover 补货（管线钩子）
- [x] 交易完成效果（reputation/flag/任务进度）+ trade 事件
- [x] 定价表达式矩阵 + 原子性测试

## 完成定义
- [x] 全部子任务勾选；定价/原子性/回购一致性测试全绿

## 落地记录（2026-09-21，全单线；S0→S4）

- **S0 契约冻结**：`economy/types.ts`（ShopEntryView/ShopPrice/ShopService）+ `shop`
  指令（jump 类，emit `shop_open`）+ `meet` 指令（`npc.<id>.met` 写入口，
  人类裁定的独立指令形态）；指令表 25 → 27，RefKind 增 `shop`。
- **S1 投影定价**：`createShopProjection`——showIf 过滤 + 库存投影 + 定价表达式
  （编译缓存、buildExprScope 作用域、timeView 注入缝）。
- **S2 交易事务**：`createShopService`——buy/sell 翻译为效果指令批次交
  GameRuntime.exec（原子性由事务底座保证）；回购登记以时间片界定「当次交易」
  （同天同时段，一次性消费）；`TradeEvent`；ExecContext.where 增 `shop` 定位。
- **S3 遗留清账**：**C5 检豁免移除**（2026-09-15 登记 → 2026-09-21 实判通过，
  判定口径修正为真实指令形态 `{shop: {shop: id}}`）；crossRef 补 shop kind。
- **S4 库存与补货**：新增状态域 `world.shopStock`（键 `<shopId>/<itemId>`，
  schema/状态树/序列化三处 additive + 旧档兼容）；`__shop.restock`（跨天补货）
  与 `__shop.set_stock`（交易记账，随交易事务原子）两条内部指令；
  demo 商店开张（集市杂货铺：声望折扣定价、warm_bun 库存 5、guard_coat flag 解锁）。

### 设计偏差与缺口裁定（2026-09-23 人类审查，全部闭环）

1. **库存存储面 —— 追认**：`world.shopStock` 独立状态域（键 `<shopId>/<itemId>`；
   仅有限库存登记）；设计 §5.3 只写「stock 计数」，存放位置由本次追认补记。
2. **`restock` 条目级调度 —— 已实现**（2026-09-23）：
   - 新增 `world.shopRestock`（键同 shopStock，值 = 天×1000 + 时段的单调计时）；
   - 管线新增**步骤 4.5「shopRestock」槽位**（每次推进都调用——条目级周期需
     每时段评估，跨天钩子不够）；
   - `__shop.restock` 语义：声明 `restock: N` 的条目距上次补货 ≥ N 时段才补；
     未声明的条目每次触发即补（旧行为，向后兼容）；
   - 测试 5 例（首日即补/周期未到不补/周期到达补/无声明即补/无限库存不登记）。
3. **`item.<id>.price` 基准价 —— 方案 A 已实现**（2026-09-23）：
   - 表达式白名单 `item` 域扩 `price` 形态（`item.<id>.count` / `item.<id>.price`）；
   - `ExprScope.itemPrices`（物品目录投影，可选）；经济服务的 `items` 注入面
     填充该视图（`createShopProjection({ items })`）；
   - 缺省未注入目录或物品未声明 price → **EVAL_ERROR 显性化**（封闭域，不静默 0）；
   - 测试 4 例（按基准价计算/卖价可用/未注入目录报错/未声明 price 报错）。
   - 遗留说明：定价仍为**商店级**（ShopDef.priceBuy/priceSell 对全店生效）；
     「同一商店内不同商品各写定价」的条目级覆盖属方案 B，未实现（无真实需求）。
