# 02 shared Schema 体系

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §2.4（18 个 schema）、§2.1 refId |
| 需求映射 | D3、NFR-12、FR-L10N-02、FR-MIGR-01 |
| 前置模块 | 01 |
| 里程碑 | M0–M1 |

> 目标：游戏包全部数据域的 Zod schema 单一来源，`z.infer` 产出 TS 类型供四包共用。

## 任务清单

### A. 核心域（M0 必需）
- [x] `manifest.ts`：版本三元组、语言列表、内容标签、redirects、credits + 非法样例测试
- [x] `attrs.ts`（numeric/level/derived 三形态）+ `scene.ts`（segments/choices/effects/tags）+ `area.ts`
- [x] `event.ts`（trigger 三型/冷却/once/mutex）+ `quest.ts`（阶段/奖励/冲突）+ `npc.ts`（日程/好感阈值）+ `faction.ts`

### B. 系统域（M1 前）
- [ ] `item.ts`（类型/堆叠/装备/服装 garment）+ `body.ts`（parts/pronouns）+ `shop.ts`
- [ ] `achievement.ts` / `perk.ts` / `ending.ts` / `loop.ts` / `tags.ts` / `stats-page.ts`
- [ ] `save.ts`（SaveBlob + SerializedState 校验）+ `profile.ts`

### C. 质量门禁
- [ ] 每个 schema ≥1 正例（进入 mini-game 夹具或独立 fixture）+ ≥1 负例（fixtures/negatives 复用）
- [ ] schema 快照测试（防意外破坏，NFR-12「只增不改」的守护）
- [ ] refId 元数据在关键引用字段落位（scene 跳转、bag.itemId、npc 引用等，供 21 号迁移改写）

## 完成定义
- [ ] 全部子任务勾选，schema 测试全绿；`pnpm -w build` 产出类型可被 engine 导入
