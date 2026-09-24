# 23 作者脚本宿主

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.9（ScriptSetupApi，DD-06/08） |
| 需求映射 | FR-SCR-01～06、NFR-19/20、D15 |
| 前置模块 | 05（指令注册表）、03（函数注册表）、06（步骤 6） |
| 里程碑 | M2（API 冻结，OQ-11 同步复核） |

> 目标：类型化注册 API——四类扩展点、事务约束、命名空间与契约校验；运行期零解释。

## 任务清单

- [x] `ScriptModule` / `ScriptSetupApi` 类型与加载时序（管线步骤 6：先注册后冻结）
- [x] `registerEffect`：`x.<script>.<name>` 命名空间强制 + 重复检测 + 内置 ID 冲突拒绝
- [x] `registerFunction`：同命名空间约束 + `pure` 元数据传递（事件缓存敏感性）
- [x] `registerCheckRule`：自定义检定规则接入（15 号路由）
- [x] `onHook`：time/loop_transition/battle_round_end/load_complete 钩子注册与触发序
- [x] 事务约束：脚本唯一状态入口 `host.transaction`（内部 exec 包装）——不暴露原始 draft 的架构测试
- [x] `touchState` 新域 warn（内置清单外前缀 → SCRIPT_CONTRACT 级提示，26 号发布门禁联动）
- [x] 悬空契约：数据 `call` 引用未注册指令 → SCRIPT_CONTRACT error（FR-SCR-04）
- [x] 手工 ScriptModule 桩全流程测试（注册→数据调用→事务生效→回滚一致）

## 完成定义
- [x] 全部子任务勾选；桩测试全绿；「运行期无 eval/动态加载」架构断言（lint + 测试）通过

## 落地记录（2026-09-25，全单线；S0→A/B/C→S3）

- **S0 契约与骨架**：`scripts/types.ts`（ScriptSetupApi 补 onHook/registerDamagePreset；
  ScriptHost.transaction 返回 {events, patches} 不含 jumps）+ `scripts/host.ts`
  （事务门面 + **流程指令拒绝** + HookRegistry 注册序/错误隔离/collect）；
  ScriptSetupApi/ScriptModule 权威定义迁移至 scripts（loader 侧 re-export 消漂移）。
- **A 线**：能力面收窄——eslint 增 SCRIPT_FORBIDDEN_GLOBALS（14 项：网络/定时器/
  文件/process）+ 源码扫描测试三层（无 eval/动态加载、能力面、draft 不外泄）。
- **B 线**：四类钩子挂点接通——time **补齐 slot_advance 槽**（设计三值，M1 漏一；
  挂管线步骤 1.5）/ loop_transition（runLoopTransition 内，**切换后**）/
  battle_round_end（BattleSession.onRoundEnd，**整回合结束**）/
  load_complete（SaveService.onLoadComplete，**恢复完成后**）。
- **C 线**：touch-audit（KNOWN_STATE_DOMAINS **从测试提升为引擎权威清单** +
  写域校验）+ **伤害公式脚本覆盖打通**（16 号 W4 遗留：registerDamagePreset →
  loader 收集 → BattleWiringInput.damagePresetName，未注册一律 EFFECT_FAILED）。
- **S3 收口**：桩全流程（注册 → 数据 call 调用 → 事务生效 → 回滚一致）+
  判定规则解析链 + 钩子接线形态 + 预设收集，四组 10 例。
- **API 冻结**（OQ-11 复核，2026-09-25 人类裁定）：见 `detail-design.md` §5.9 冻结公告。
