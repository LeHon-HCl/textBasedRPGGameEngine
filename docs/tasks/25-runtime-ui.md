# 25 runtime-ui 玩家界面

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §6.1～6.8 |
| 需求映射 | FR-UI、FR-READ、FR-GAL、FR-STAP、FR-DEBG、FR-L10N-09、FR-MEDIA-08/09 |
| 前置模块 | 04/05/06/07/08（运行时全家）、20（存档）、22（过滤） |
| 里程碑 | M1（外壳+核心面板）–M2（QoL/调试）–M4（图鉴/统计收尾） |

> 目标：React 通用游玩界面——渲染管线、面板体系、QoL、调试；全部组件 props 受控可测。

## 任务清单

### A. 基础（M1）
- [x] `UiStore`（Zustand）+ GameRuntime 事件订阅桥 + selector 细粒度订阅模式
- [x] AppShell 响应式布局（≥900px 双栏 / 移动折叠 Tab，FR-UI-01/09）
- [x] 主菜单（继续/新游戏/读档/成就/设置/关于，FR-UI-06）
- [x] 渲染管线：resolve→插值→sanitize（白名单+转义）→ReactNode + 打字机效果（reduced-motion 自动关）
- [x] NarrativeView/OptionList（advance/choose 挂接 + 选择前 checkpoint）
- [x] 状态面板（属性/技能/状态/钱包/着装概要 + 数值变化高亮动画，FR-UI-03）
- [x] 地图导航面板（区域图+移动消耗+解锁提示，FR-UI-02）
- [x] 任务日志面板（分组/追踪置顶，FR-QUEST-03 UI 侧）
- [x] 设置面板（语言/文本/媒体开关/标签开关/快捷键说明/三版本号，FR-UI-05）
- [x] DexieAdapter（复用 20 号契约套件）+ 隐私模式降级横幅（NFR-10）
- [x] 通知 Toast 系统（合并策略 500ms，FR-UI-07）
- [x] 首启内容向导（警告页+标签开关，FR-CGRD-04）

### B. QoL 与面板（M2）——2026-09-23 完成（全单线 + 内部并行）
- [x] 已读跳过 + 自动播放（遇选项/判定/战斗暂停）
- [x] 回滚按钮（rollback + session 重建）+ 历史回看（react-window）
- [x] 快捷键映射（1-9 选项/S/L 快存读/H 历史）+ 设置页说明
- [x] 成就图鉴面板（隐藏占位/进度条/收集率）
- [x] 调试面板（变量监视/跳转/时间快进/表达式控制台/评估日志，manifest 开关）
- [x] 判定呈现（check_result 动画，减弱动画降级）+ 战斗面板（OQ-04：嵌入叙事区形态）

### C. 图鉴与收尾（M4）
- [ ] 回想/结局/CG 图鉴（readonly SceneRunner + Profile.endings + gallery 解锁位）
- [ ] 统计页渲染器（StatsPageDef → SVG 条形/雷达）+ 角色卡模板 + 游玩统计
- [ ] 版本不兼容提示界面（VERSION_UNSUPPORTED/MIGRATION_FAILED 卡片 + 导出备份入口，FR-UI-08）
- [ ] 媒体播放器：howler 封装（BGM 淡入淡出/同曲续播）+ 动图静态帧降级 + 同屏 >2 降级（FR-MEDIA-07/09）
- [ ] Testing Library 组件测试全覆盖 + Playwright 玩家流冒烟（新游戏→游玩→存读→周目）

## B 组落地记录（2026-09-23）

- **A 线**：`narrative/reading-control.ts`（useReadingControl：跳过开关 / 一次性跳过 /
  自动播放；**仅 await_advance 计时**——遇选项/判定/战斗暂停，FR-READ-02 安全边界）
  + `app/keyboard.ts`（1-9/Space·Enter/H/S/L/R/Esc + `KEY_BINDING_DOCS` 键位唯一事实源；
  输入焦点/修饰键/相位三重保护）；
- **B 线**：宿主 `rollback(steps)` 多步回滚（步数前置校验：超栈深 → NO_CHECKPOINT
  显性化，不静默 clamp）+ `history()` 投影 + `panels/history-projection.ts`
  （场景+游戏日分组）+ `HistoryPanel`；**M2 验收第 4 条通过**（口径甲）；
  **重要边界**：回滚栈深上限 = PERF_GUARD.checkpointStackDepth = 5——「回滚 5 步」
  需 6 次选择（见 M2-stage5-qol-plan §2，两个选项待人类裁定）；
- **C 线**：`CheckResultPanel`（六档徽标 + 减弱动画降级）+ `BattlePanel`
  （OQ-04 嵌入形态：三段布局 + 血条 + 日志 + 行动菜单 + 目标两步点选）+
  `AchievementGalleryPanel`（隐藏占位零泄露 + 进度条 + 收集率）；
- **Q3**：`DebugPanel`（变量监视/跳转/时间快进/表达式控制台/评估日志 +
  「不可回滚」提示）+ manifest `debug` 字段（additive）；宿主据此决定是否启用；
- **引擎侧顺带修复**：battle/achievements/loop/economy 四子系统的根入口导出补齐
  （此前宿主无法从 `@game/engine` 消费，属阶段二/三/四的导出遗漏）；
- 测试净增 45 例（8 回滚/历史 + 8 读速 + 11 快捷键 + 9 图鉴 + 11 判定与战斗 + 6 调试）。

## 遗留

- E2E 冒烟扩用例（回滚 5 步 + 战斗面板）——待宿主把面板接进 AppShell 后补；
- 历史回看虚拟化（react-window）——500 段规模下普通列表够用，内容增长后再引入；
- 口径乙（叙事位置精确还原）登记为 M4 打磨项。

## 完成定义
- [ ] 全部子任务勾选；组件测试与 E2E 冒烟全绿；mini-game 在界面中完整可玩
