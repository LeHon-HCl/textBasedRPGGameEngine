# 16 回合制战斗

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.2（状态机图，DD-11 会话隔离） |
| 需求映射 | FR-CMBT-07～13 |
| 前置模块 | 04、05、15 |
| 里程碑 | M2 |

> 目标：独立 BattleSession 状态机——行动序、AI、结算、胜负路由、战斗日志。

## 任务清单

- [ ] `BattleSession` 骨架 + 八相位状态机 + 全路径迁移测试
- [ ] 单位模型（player/enemy/ally[P2 预留]）+ `turnQueue`（spd 降序、平局 Rng）
- [ ] 玩家行动：skill / item / defend / flee（逃跑成功率 Rng 判定、可配置）
- [ ] 结算管线：技能效果 = 战斗子集指令（伤害/治疗/状态）复用 EffectContext（source='battle'）
- [x] 伤害公式可插拔预设（默认 atk*mult − def，作者可脚本注册覆盖）
- [x] AI 策略：weighted（权重+when 过滤）与 scripted（表达式序列首中）；决策只用会话内状态
- [x] 战斗内状态效果 round_end tick（复用 StatusInstance）+ 到期/叠层断言
- [ ] 胜负路由：victory → rewards child 事务（chance 掉落 + 表达式金额）→ on_victory/on_defeat/on_escape 效果与跳转（战败≠终局）
- [x] 战斗日志：BattleLogEntry（i18n 键 + 数值，可回看）+ 全程 log/phase 序列断言
- [ ] 敌方多人（目标选择）+ 遭遇模板参数化（FR-CMBT-12/13）

## 完成定义
- [ ] 全部子任务勾选；会话级测试全绿（不依赖叙事模块，DD-11 验证）
