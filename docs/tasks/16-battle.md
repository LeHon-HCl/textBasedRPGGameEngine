# 16 回合制战斗

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.2（状态机图，DD-11 会话隔离） |
| 需求映射 | FR-CMBT-07～13 |
| 前置模块 | 04、05、15 |
| 里程碑 | M2 |

> 目标：独立 BattleSession 状态机——行动序、AI、结算、胜负路由、战斗日志。

## 任务清单

- [x] `BattleSession` 骨架 + 八相位状态机 + 全路径迁移测试
- [x] 单位模型（player/enemy/ally[P2 预留]）+ `turnQueue`（spd 降序、平局 Rng）
- [x] 玩家行动：skill / item / defend / flee（逃跑成功率 Rng 判定、可配置）
- [x] 结算管线：技能效果 = 战斗子集指令（伤害/治疗/状态）复用 EffectContext（source='battle'）
- [x] 伤害公式可插拔预设（默认 atk*mult − def，作者可脚本注册覆盖）
- [x] AI 策略：weighted（权重+when 过滤）与 scripted（表达式序列首中）；决策只用会话内状态
- [x] 战斗内状态效果 round_end tick（复用 StatusInstance）+ 到期/叠层断言
- [x] 胜负路由：victory → rewards child 事务（chance 掉落 + 表达式金额）→ on_victory/on_defeat/on_escape 效果与跳转（战败≠终局）
- [x] 战斗日志：BattleLogEntry（i18n 键 + 数值，可回看）+ 全程 log/phase 序列断言
- [x] 敌方多人（目标选择）+ 遭遇模板参数化（FR-CMBT-12/13）

## 完成定义
- [x] 全部子任务勾选；会话级测试全绿（不依赖叙事模块，DD-11 验证）

## W6 收尾记录（2026-09-19，B 方）

- **子任务 10**：`battle/targeting.ts`（selectTarget：simple 缺省/self 显式/
  explicit 优先，确定性不消耗随机）+ resolution 回退接线（缺 targetUid 的
  attack 回退对立面首个存活——#28 反馈的动态目标缺口闭环；A 方「无目标 = 自身
  增益」语义零破坏）。
- **FR-CMBT-13（P2）口径**：`instantiateEncounter` 即最小参数化面（遭遇模板 +
  运行时状态 → 实例）；更丰富的模板库（倍率/等级缩放）按 P2 定位不提前发明
  ——避免为完成清单而设计无消费面的 schema。
- **JumpTarget.branches 提案撤回**：曾提议分支随 jump 携带，#33 落地为
  `battle_start` 事件通道（宿主唯一参数通道），本方按事件契约实现并对齐。
- **demo 接入（mini-game）**：attrs 增战斗三件套 atk/def/spd（双语显示名齐备，
  C6 检通过）；`data/enemies.yaml`（岩鼠）+ `data/encounters.yaml`（两只同种 =
  FR-CMBT-12 多敌人）；hillside_quarry 增战斗入口选项（showIf 清除后消失，
  battle 指令携带 onVictory/onDefeat/onEscape 三分支）。
- **battle-flow.test.ts**（唯一跨工作包用例，A 方改派 B 方）：真实管线全链——
  mini-game 加载 → 场景选项触发 battle 指令 → battle_start 事件携带分支 →
  createBattleController → 会话驱动至 victory → rewards（+10 town_silver）与
  on_victory child 事务真实入账 → 幂等复验 → 路由 jumps 注回叙事；
  另有防御拖延用例（战败≠终局）。
- **AI when 桥接**：接线层 evalCondition 缺省恒真，demo 数据不使用 when 声明；
  战斗内作用域桥接登记待 25B 战斗面板（原计划口径不变）。
- **遗留登记**：E2E 战斗流用例依赖宿主战斗 UI（25B 战斗面板），登记为 25 号
  B 组验收面——引擎级全链已由 battle-flow.test.ts 覆盖。

## 落地记录（2026-09-19，双人协作进行中）

- **已合入**：W0 契约冻结 + 八相位状态机（#28，A）、W1 行动序/行动校验/防御态（#28，A）、
  W2 结算执行器 + 附加效果缝 + 遭遇实例化 + 胜负路由数据面 + battle 指令接线层
  （#31/#33，A）、W4 伤害公式预设 + AI 双策略（#27 起，B）、W5 状态 tick + 日志投影
  （#30，B）、W6 第一片目标选择（#34，B）；数据域回填（#29，B）+ battle_start
  宿主事件通道（#33，A）。
- **设计偏差裁定（2026-09-19 人类审查通过，约束 2 闭环）**：
  ① BattleSession 构造接受已实例化单位（BattleInit），EncounterDef → 单位实例化
  拆为独立纯函数（DD-11 会话级测试不依赖叙事）；
  ② 状态 tick 挂「新回合开始」每轮一次（§5.2「tick 在 round_end」按真回合边界
  解释——round_end 相位是单次行动收敛点，逐行动 tick 会让高速单位双倍速衰减）；
  ③ AI `when` 表达式的战斗内作用域桥接：**已立项**（2026-09-19 人类批准）——
  变量清单草案见下，清单经人类确认后接线（随 W6 第二片或阶段六，约半天）；
  落地前 demo 数据不写 `when`（接线层 evalCondition 缺省恒真）。

### 战斗表达式域草案（偏差③，待人类确认清单）

目的：AI `when` 条件引用**会话内状态**（§5.2「决策只用会话内状态」）。
v1 最小集（域名 `battle.`，进 03 号表达式白名单）：

| 变量 | 语义 |
|---|---|
| `battle.self.hp` / `battle.self.maxHp` | 行动者当前/最大 HP |
| `battle.self.<attr>` | 行动者战斗面板属性（atk/def/spd 等，Attrs 快照） |
| `battle.enemies.alive` | 行动者对立面存活数（敌方视角 = 玩家侧人数） |
| `battle.allies.alive` | 行动者同侧存活数 |
| `battle.round` | 当前回合序号（从 1 起） |

明确排除（v1 不做）：target.*（when 阶段目标未选，目标选择在条件之后）、
随机量（DD-09：AI 决策不消耗骰序列）、叙事域（DD-11 隔离）。
写法示例：`when: 'battle.self.hp < battle.self.maxHp * 0.3'`。
- **剩余**：子任务 10 的 demo 接入片（W6 第二片，B 主刀：mini-game 遭遇数据 +
  game-host 接线 + 最小战斗页 + E2E 战斗流），完成后勾选完成定义。
