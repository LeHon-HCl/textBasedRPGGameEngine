# 15 判定系统

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.1（CoC 阈值表 + CheckRule 接口） |
| 需求映射 | FR-CMBT-01～06 |
| 前置模块 | 03、05（check 指令）、01（Rng） |
| 里程碑 | M2 |

> 目标：可插拔检定规则——CoC 7 版内置实现 + generic 规则 + 结果路由。

## 任务清单

- [x] `CheckRule` 接口 + `check` 指令路由：结果 → on_success/on_fail/on_critical/on_fumble 子效果（child 事务，未声明档位回退 outcome）
- [x] coc 规则：普通/困难/极难阈值（floor 除法）
- [x] coc 规则：大成功（≤max(1, ⌊skill/5⌋)）与 大失败（=100 或 skill<50 且 ≥96）
- [x] coc 规则：奖励/惩罚骰池（十位取低/高 + 各位组合，链式 N 个）+ rolls 明细（表现层动画数据）
- [x] coc 规则：对抗检定（成功等级序 → 同级低技能胜 → 再平守方胜）
- [x] generic 规则：roll + value ≥ difficultyValue
- [x] `check_result` EngineEvent（含 rolls/level/detail，供 UI 播放，NFR-26 可减弱）
- [x] 边界矩阵测试：skill ∈ {1,49,50,90,95,100} × roll 端点（固定种子）全等级断言

## 完成定义
- [x] 全部子任务勾选；阈值边界矩阵 + 对抗平局规则测试全绿

## 落地记录（2026-09-18，M2 阶段一）

- 实现落点：`packages/engine/src/checks/`（coc / generic / 内置兜底解析器）；
  解析链「脚本规则 → 宿主解析器 → 内置 coc/generic」在 loader 管线步骤 6 合成并
  注入效果注册表——修复了此前 `ScriptStepResult.checkResolver` 返回后无人消费的
  断缝，`check` 指令开箱可用。
- **设计偏差登记（依约束 2 待人类审查确认 §5.1 是否修订）**：§5.1 表格下极难线
  与大成功线同为 ⌊skill/5⌋，故 `extreme` 等级被 `critical` 吸收、单方检定实际
  不可达；实现照表，等级枚举保留 `extreme` 为对抗比较与脚本规则扩展留位。
  若希望 extreme 可达（例如大成功线改 ⌊skill/10⌋ 或另设判据），须先改 §5.1。
- **additive 扩展**：check 指令新增可选参数 `difficultyValue`（表达式或数字字面量，
  generic 规则的难度数值；coc 忽略）——§5.1「难度数值由调用方表达式给出」的
  参数化落地；shared JSON Schema 基线已随 `schema:baselines` 再生成。
- demo 接入：山道口 `read_marks` 检定（insight × 5 折算技能值，成功解锁采石场
  的第二条路径），端到端用例见 `packages/engine/test/checks/demo-check.test.ts`。
