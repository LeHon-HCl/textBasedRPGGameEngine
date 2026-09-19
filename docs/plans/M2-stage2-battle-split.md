# M2 阶段二分工 —— 回合制战斗（16 号）双人协作

> 范围：`docs/plans/M2-plan.md` 阶段 2（模块 16，10 个子任务，见 `docs/tasks/16-battle.md`）。
> 本文档只管**分工与认领**；开发目标 / 影响面 / 验收效果以 M2-plan 阶段 2 为准，
> 流程约束（分支-PR、TDD、门禁）见 `docs/develop.md`，均不重复。
> 参与方：**A 方**（现主开发者 + 人类审查人）、**B 方**（协作开发者）。人名在认领时填入。

## 0. 防重复劳动的三条硬规则（先读这个）

1. **先认领后动工**：开工前必须按 §3 规则完成认领（开 draft PR 占位）。
   没有认领记录的改动，对方有权拒绝 review。
2. **文件所有权**（§2）：每人只写自己名下的文件；要动对方名下的文件
   （含公共类型 `battle/types.ts`）必须走对方的 PR review，不许直接改。
3. **公共类型冻结**：`battle/types.ts` 在 W0 合入后冻结为稳定契约；
   任何破坏性变更（改字段/改签名）必须对方 review 同意 + 在 PR 描述里
   说明迁移方式，否则宁加不改（additive）。

## 1. 工作包划分（子任务 → 工作包映射）

依赖关系决定串并行：W0 是所有人的前置；W1/W2 与 W4/W5 两条线**并行**；
W6 收口串行。

```
W0 接口冻结 + 状态机骨架（A）
   ├──> [A 线] W1 行动序与玩家行动 ──> W2 结算主线（结算+胜负路由）
   ├──> [B 线] W4 伤害公式 + AI（与 A 线并行，只依赖 W0 类型）
   │           W5 战斗内状态 tick + 战斗日志（接 W4）
   └──> W6 收口：敌方多人 + 遭遇参数化 + demo 接入（B 主刀，A 配合串联测试）
```

| 工作包 | 对应子任务（16-battle.md） | 内容 | 文件落点（所有权） | 预估 commit |
|---|---|---|---|---|
| **W0** 接口冻结 + 状态机 | 子任务 1 | `battle/types.ts` 公共契约（相位枚举 / Unit / BattleEvent / DamageFn 签名 / AI 决策输入 / 日志条目）；`BattleSession` 骨架 + 八相位状态机 + 全路径迁移测试。**两位开发者的共同前置** | `battle/types.ts` `battle/session.ts`（A） | 2 |
| **W1** 行动序与玩家行动 | 子任务 2、3 | 单位模型（player/enemy/ally 预留）+ `turnQueue`（spd 降序、平局 Rng）；玩家行动 skill / item / defend / flee（逃跑成功率 Rng 判定、可配置） | `battle/turn-queue.ts` `battle/actions.ts`（A） | 3 |
| **W2** 结算主线 | 子任务 4、8 | 技能效果 = 战斗子集指令（伤害/治疗/状态）复用 EffectContext（source='battle'）；胜负路由：victory → rewards child 事务（chance 掉落 + 表达式金额）→ on_victory/on_defeat/on_escape（战败≠终局）+ 效果注册表 `battle` jump 路由的会话执行面 | `battle/resolution.ts` + `runtime` 接线（A） | 3 |
| **W4** 伤害与 AI | 子任务 5、6 | 伤害公式可插拔预设（默认 `atk*mult − def`，作者可脚本注册覆盖——注册接线随 M2 阶段六 23 号）；AI 策略 weighted（权重+when 过滤）与 scripted（表达式序列首中），决策只用会话内状态 | `battle/damage.ts` `battle/ai.ts`（B） | 3 |
| **W5** 状态 tick + 日志 | 子任务 7、9 | 战斗内状态效果 round_end tick（复用 StatusInstance）+ 到期/叠层断言；`BattleLogEntry`（i18n 键 + 数值，可回看）+ 全程 log/phase 序列断言 | `battle/status-tick.ts` `battle/log.ts`（B） | 3 |
| **W6** 收口 | 子任务 10 + demo | 敌方多人（目标选择）+ 遭遇模板参数化（FR-CMBT-12/13）；mini-game 战斗遭遇接入（数据 + 场景入口 + 双语键）；全流程集成串联测试（`battle-flow.test.ts`，唯一跨工作包用例）；16 号 docs 收尾 + E2E 扩一条战斗流 | `battle/targeting.ts` + `fixtures/mini-game`（B）；串联测试 A review | 4 |

工作量粗估：A 线 8 commit（含 W0），B 线 10 commit；两侧体量相当（A 侧含最重的
状态机与接线，B 侧含 demo 内容与文档收尾）。

## 2. 文件所有权明细（防冲突）

| 文件 | 所有者 | 说明 |
|---|---|---|
| `packages/engine/src/battle/types.ts` | A（W0 起草） | **公共契约**：变更须对方 review |
| `packages/engine/src/battle/session.ts` | A | 状态机 + 相位迁移 |
| `packages/engine/src/battle/turn-queue.ts` / `actions.ts` | A | W1 |
| `packages/engine/src/battle/resolution.ts` | A | W2 |
| `packages/engine/src/battle/damage.ts` / `ai.ts` | B | W4 |
| `packages/engine/src/battle/status-tick.ts` / `log.ts` | B | W5 |
| `packages/engine/src/battle/index.ts` | 收口时合并 | 出口聚合，W6 一并整理 |
| `packages/engine/test/battle/…` | 各自文件各自写 | 测试文件名与实现文件对应；`battle-flow.test.ts` 归 A |
| `fixtures/mini-game`（遭遇数据 + 文本键） | B（W6） | A review |

约定：`battle/` 内**子系统间禁横向 import 之外**允许包内互相引用（同包模块，
DD-06 不适用于包内）；但依赖方向必须单向：`actions/resolution → damage/ai/log`，
禁止反向（B 线不得 import A 线实现文件，只用 `types.ts` 契约与构造注入）。

## 3. 认领规则

1. **认领动作**：从最新 main 切分支 `feat/battle-<工作包>`（如 `feat/battle-w4-damage-ai`），
   **立即开 draft PR**，标题格式 `[battle-W4] 伤害公式与 AI`，描述里写：
   「认领 W4（见 docs/plans/M2-stage2-battle-split.md）」。**draft PR 的创建时间即认领时间，先到先得。**
2. **认领表更新**：认领后在下方认领表填入认领人与日期，随该工作包的
   首个 commit 一起带上（不必单独提 PR）。
3. **冲突裁决**：同一工作包被双方先后认领 → 后开 PR 者主动放弃并换包；
   若确实都已开工，协商拆分并在 PR 描述记录拆分结果。
4. **换人 / 转让**：认领人可在认领表改名为转让，但须在原 draft PR 里 @ 对方确认。
5. **串行包的认领**：W0 合入前，W1/W2/W4/W5 只能认领不能开工（写代码）；
   提前认领占位允许。

## 4. 认领表（开工前填写）

| 工作包 | 认领人 | 认领时间 | draft PR | 状态 |
|---|---|---|---|---|
| W0 接口冻结 + 状态机 | 待认领 | — | — | 待认领 |
| W1 行动序与玩家行动 | 待认领 | — | — | 待认领 |
| W2 结算主线 | 待认领 | — | — | 待认领 |
| W4 伤害与 AI | 待认领 | — | — | 待认领 |
| W5 状态 tick + 日志 | 待认领 | — | — | 待认领 |
| W6 收口（多人/遭遇/demo/集成） | 待认领 | — | — | 待认领 |

## 5. 协作与验收约定

- **review 义务**：每个工作包的 PR 由**另一位开发者** review（A 的 PR 由 B review，
  反之亦然）；公共类型 `battle/types.ts` 的变更 review 是硬性前置。
- **完成定义**（每工作包）：对应子任务在 `docs/tasks/16-battle.md` 勾选 +
  各自测试全绿 + 四门禁 + validate-docs 绿 + 自审清单（develop.md 约束 8）填全。
- **模块完成定义**（W6 收口时统一核）：16 号子任务全部勾选；会话级测试全绿
  且**不依赖叙事模块**（DD-11 验证）；demo 战斗遭遇可玩；E2E 扩战斗流用例绿。
- **收尾**：16 号 docs 收尾 commit（B 方主刀）+ M2-plan 阶段 2 验收效果逐条过
  + 里程碑收尾按 develop.md 约束 4/10（反思报告 + 人工验收）。
