# 28 P2 功能包

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §8.1～8.6 |
| 需求映射 | FR-XTRA-01～06 |
| 前置模块 | 按项各异（见各任务括注）；整体依赖 M2 末的 engine API 冻结 |
| 里程碑 | M5（各项独立立项，可整体延后） |

> 目标：合成/同伴/程序化生成/Mod/主题/百科六项，接口已在 schema 冻结，逐项交付。

## 任务清单

- [ ] 物品合成：RecipeDef schema → CraftingService（原子扣料+产物）→ 制作 UI → 解锁挂成就（前置：05/13/18）
- [ ] 同伴与队伍：CompanionDef（NpcDef 超集）→ world.companions 存档域（迁移登记）→ 战斗 ally 侧（16 号预留位）→ 非战斗日程/好感（前置：12/16/21）
- [ ] 程序化内容生成：ProcTemplate schema → instantiate 纯函数（种子策略 save/session）→ 实例摘要入档 + 读档重建（前置：03/06）
- [ ] Mod 数据覆盖包：mod-manifest/兼容区间/加载顺序 → loader overlay 合并 → 冲突报告 UI → scripts/migrations 拒绝加载断言（前置：06/27；安全不变式 NFR-20）
- [ ] 游戏级 UI 主题：ThemeDef schema → `--tbgk-*` 变量契约定稿（OQ-09）→ runtime-ui 全量换用契约变量（lint 禁裸色值）→ 主题设计器 + 随包分发（前置：25）
- [ ] 百科 Codex：CodexEntryDef → refs 解锁机制复用 → 图鉴 UI（复用 25 号面板框架）（前置：06/18）

## 完成定义
- [ ] 全部子任务勾选；每项附独立验收用例与文档（proposal M5 要求）后合并
