# M2 阶段六开发计划 —— 作者脚本宿主（23 号，M2 收尾）

> 范围：`docs/tasks/23-script-host.md` 九个子任务。
> 组织方式：**全单线 + 内部并行**（2026-09-24 人类确认沿用；协作者仍不可用）。
> 流程约束见 `docs/develop.md`。
> **本计划待人类批准后开工**（约定：显式要求开工才动手）。

## 0. 总述

### 目标与验收

- 四类扩展点全部落地：`registerEffect` / `registerFunction` / `registerCheckRule` / `onHook`；
- 事务约束：脚本唯一状态入口是 `host.transaction`（不暴露原始 draft）；
- 契约校验：命名空间（DD-08）、悬空 `call` 引用（FR-SCR-04）、`touchState` 新域 warn（FR-SCR-05）；
- **M2 末 API 冻结**（OQ-11 复核：脚本 API 能力面 —— 仅引擎事务 + 纯计算，网络/存储不开放）；
- 打通 16 号遗留的「伤害公式脚本注册覆盖」（W4 留的口子）；
- 架构断言：「运行期无 eval / 动态加载」（NFR-19，lint + 测试双保）。

### Q0 前置核实结论（2026-09-24，已执行）

| 能力 | 现状 | 本阶段工作 |
|---|---|---|
| `ScriptModule` / `ScriptSetupApi` 类型 | ✅ 已定义（`loader/types.ts`） | 迁移到 `scripts/` 子系统并补齐（additive：加 `onHook`、`transaction`） |
| `registerEffect` | ✅ 已实现（命名空间 + DUP_ID + 冻结校验） | 补测试（负例矩阵） |
| `registerFunction` | ✅ 已实现（命名空间 + pure 元数据 + 重复检测） | 同上 |
| `registerCheckRule` | ✅ 已实现（脚本规则优先的合成解析链，15 号） | 同上 |
| **`onHook`** | ❌ **无任何挂点** | **主要工作量**：四类钩子（time / loop_transition / battle_round_end / load_complete）需新增触发点 |
| **`host.transaction`** | ❌ 未实现 | 新建 `scripts/host.ts`：exec 包装 + 能力面收窄 |
| **`touchState` 新域 warn** | ❌ 未实现 | 校验器（内置域清单前缀比对）+ 诊断 |
| 悬空 `call` 引用 | ✅ 已实现（`firstXContractError`，FR-SCR-04） | 补测试 |
| 伤害公式脚本覆盖（16 号遗留） | ❌ 未打通（`createDefaultDamageFn` 是唯一预设） | 打通：预设解析器接脚本注册面 |

### 工作包划分（并行结构）

```
S0 契约冻结与迁移（串行）
  ├── scripts/types.ts：ScriptSetupApi 补 onHook / transaction（additive）
  ├── ScriptHost 骨架：模块加载 → 注册 → 冻结 → 运行期 handler 持有
  └── 旧定义（loader/types.ts）迁移为 re-export（不破坏既有导入）
       ↓
  ├── 并行线 A：A1 host.transaction 实现 → A2 能力面收窄与架构断言
  ├── 并行线 B：B1 onHook 四类挂点 → B2 钩子触发序与错误隔离
  └── 并行线 C：C1 touchState 新域 warn → C2 悬空契约补测 + 伤害公式脚本覆盖
       ↓
  S3 收口：OQ-11 复核 + API 冻结公告 + 桩全流程测试 + docs
```

| 工作包 | 内容（对应子任务） | 文件落点 | commit |
|---|---|---|---|
| **S0** | 类型与加载时序（子任务 1）：`ScriptSetupApi` 补 `onHook`/`transaction`；`ScriptHost` 骨架（构造 → setup → freeze → 运行期） | `scripts/types.ts`、`scripts/host.ts`、`loader/types.ts`（迁移） | 2 |
| **A1** | `host.transaction`：exec 包装（脚本提交效果指令批，原子事务；返回 ExecOutcome） | `scripts/host.ts` | 1 |
| **A2** | 能力面收窄（子任务 6）：架构断言（脚本 API 无 draft/无网络/无存储/无定时器）+ 运行期无 eval（lint 规则 + 测试） | `scripts/host.ts` + 架构测试 | 2 |
| **B1** | `onHook` 四类挂点（子任务 5）：`time`（**补齐 `slot_advance` 槽，共三槽**）/ `loop_transition`（切换后）/ `battle_round_end`（**整回合结束**；`battle_action_end` 按需追加）/ `load_complete`（全部恢复完成后） | `scripts/hooks.ts` + 各触发点接线 | 3 |
| **B2** | 钩子触发序（注册序）与错误隔离（单个 handler 抛错不阻断管线；错误经诊断出口显性化） | 同上 + 测试 | 2 |
| **C1** | `touchState` 新域 warn（子任务 7）：内置域前缀清单（`world.`/`player.`/`npcs`/`factions`/`quests`/`seen.`/`readStats`/`meta.`）比对，清单外 → `SCRIPT_CONTRACT` 级诊断 | `scripts/touch-audit.ts` | 2 |
| **C2** | 悬空契约补测（子任务 8）+ **伤害公式脚本覆盖打通**（16 号遗留：`registerCheckRule` 同款的注入面，接 `createDamagePresetResolver`） | `battle/damage.ts` 接线 + 测试 | 2 |
| **S3** | 桩全流程测试（子任务 9）+ **OQ-11 复核**（能力面清单定稿）+ API 冻结公告（detail-design §5.9 补冻结说明）+ docs 收尾 | 测试 + `docs/tasks/23-script-host.md` + `detail-design.md` | 3 |

依赖：A/B/C 三线共享 S0 的 `ScriptHost` 契约；B1 的挂点需要各子系统（time/loop/battle/persistence）配合，故排在 S0 后；C2 的伤害公式接通依赖 S0 的脚本注册面。

### 关键设计点（**2026-09-25 人类裁定，全部闭环**）

1. **`onHook` 四类挂点语义**：
   - `time`：**补齐 `slot_advance` 槽**（设计 `TimeHook` 为三值，M1 实现只落两槽——本次修平差异）；
     三个钩子位即 `before_rollover`（步骤 0）/ `slot_advance`（每次推进）/ `day_rollover`（步骤 4）；
   - `loop_transition`：**切换后**触发（新状态已就位，脚本初始化周目专属数据；
     切换前改状态会被整体 reset 冲掉，无实用价值）；
   - `battle_round_end`：**整回合结束**（全部单位行动完、下一轮开始前）触发，每轮一次
     ——与状态 tick（新回合开始）相邻互补（tick 管衰减，钩子管事件）；
     「每次行动后」的 `battle_action_end` **记为按需追加**（additive，不破坏冻结；
     反击/连携类需求优先走伤害公式脚本覆盖——本阶段 C2 已打通该能力）；
   - `load_complete`：**全部恢复完成之后**触发（迁移 → 周目恢复 → 状态就位，DD-10 次序末环）。
2. **`host.transaction` 的返回面与 jumps 处置**：返回 `{ events, patches }`（**不含 jumps**）；
   脚本若提交流程指令（goto/back/ending/loop_transition）→ **抛 `SCRIPT_CONTRACT` 错误**。
   边界：脚本只改状态，不控制叙事流（流程归数据层，符合 DD-11 精神）。
3. **OQ-11 复核结论**：确认设计倾向的**最小面** —— 仅引擎事务 API + 纯计算；
   网络 / 文件系统 / 定时器**均不开放**（各自的替代路径：云功能归宿主、持久化归存档、
   延迟效果归时间管线）。**未来开放路径**：若 M5 有真实需求，由**宿主注入能力**给脚本，
   引擎不开放裸 API。结论写入 API 冻结公告。

### 验收效果

- 桩全流程测试全绿（注册 → 数据 `call` 调用 → 事务生效 → 回滚一致）；
- 四类钩子各有触达测试（含触发序与错误隔离）；
- **架构断言**：「运行期无 eval/动态加载」通过（lint + 测试）；
- 伤害公式脚本覆盖：「脚本注册自定义公式 → 战斗结算采用」端到端用例通过；
- **API 冻结公告**入档（detail-design §5.9 + OQ-11 复核记录）；
- 全门禁 + validate-docs + C1–C11 绿。

## 1. 风险

| 风险 | 缓解 |
|---|---|
| `onHook` 四类挂点分散在 time/loop/battle/persistence 四个子系统，接线面广 | B1 独立工作包；每个挂点单独 commit + 单独测试（不一次性改四处） |
| 钩子的错误隔离语义（脚本抛错是否影响游戏） | B2 明确：**单个 handler 抛错只记诊断，不阻断管线**（脚本是可选增强，不应让游戏不可玩）；测试覆盖 |
| 伤害公式脚本覆盖会动 16 号已完结的代码 | additive 接线（保留 `createDefaultDamageFn` 为缺省；脚本注册优先）；battle 既有测试全绿为回归门禁 |
| API 冻结后 M3 编辑器可能需要新扩展点 | 冻结公告中明确「additive 可加，破坏性变更需里程碑评审」；M3 若需新点，走 additive |
