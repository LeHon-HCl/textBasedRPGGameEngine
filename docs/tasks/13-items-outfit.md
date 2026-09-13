# 13 物品、装备与多层服装

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §4.7 |
| 需求映射 | FR-ITEM-01～06 |
| 前置模块 | 02（item schema）、04 |
| 里程碑 | M1 |

> 目标：背包纯函数集、装备栏、多层服装冲突规则、耐久/时效 tick。

## 任务清单

- [x] `Inventory` 纯函数集：give/take/split/merge（堆叠规则、容量上限、关键道具分区）+ 矩阵测试
- [x] 装备栏：equip/unequip + `equipMods` 并入派生属性重算（04 号配合）+ 修正明细测试（FR-STAT-03 面板数据）
- [x] `wear` 冲突规则：同 part 同 layer → swappable 决定拒绝/替换；遮挡等字段透传不解释（中立性）
- [x] 换装预设：`__outfit_preset_<name>` 快照存取 + 应用
- [x] 耐久/时效：durability / expiresAfterSlots 由管线 tick → ItemExpired 事件（作者决定后果）
- [x] 背包 UI 数据投影（分类/排序/搜索的纯函数层，FR-ITEM-02）

## 完成定义
- [x] 全部子任务勾选；Inventory 与 wear 规则矩阵全绿
