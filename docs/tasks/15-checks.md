# 15 判定系统

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.1（CoC 阈值表 + CheckRule 接口） |
| 需求映射 | FR-CMBT-01～06 |
| 前置模块 | 03、05（check 指令）、01（Rng） |
| 里程碑 | M2 |

> 目标：可插拔检定规则——CoC 7 版内置实现 + generic 规则 + 结果路由。

## 任务清单

- [ ] `CheckRule` 接口 + `check` 指令路由：结果 → on_success/on_fail/on_critical/on_fumble 子效果（child 事务，未声明档位回退 outcome）
- [ ] coc 规则：普通/困难/极难阈值（floor 除法）
- [ ] coc 规则：大成功（≤max(1, ⌊skill/5⌋)）与 大失败（=100 或 skill<50 且 ≥96）
- [ ] coc 规则：奖励/惩罚骰池（十位取低/高 + 各位组合，链式 N 个）+ rolls 明细（表现层动画数据）
- [ ] coc 规则：对抗检定（成功等级序 → 同级低技能胜 → 再平守方胜）
- [ ] generic 规则：roll + value ≥ difficultyValue
- [ ] `check_result` EngineEvent（含 rolls/level/detail，供 UI 播放，NFR-26 可减弱）
- [ ] 边界矩阵测试：skill ∈ {1,49,50,90,95,100} × roll 端点（固定种子）全等级断言

## 完成定义
- [ ] 全部子任务勾选；阈值边界矩阵 + 对抗平局规则测试全绿
