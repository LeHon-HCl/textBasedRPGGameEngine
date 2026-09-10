# 23 作者脚本宿主

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §5.9（ScriptSetupApi，DD-06/08） |
| 需求映射 | FR-SCR-01～06、NFR-19/20、D15 |
| 前置模块 | 05（指令注册表）、03（函数注册表）、06（步骤 6） |
| 里程碑 | M2（API 冻结，OQ-11 同步复核） |

> 目标：类型化注册 API——四类扩展点、事务约束、命名空间与契约校验；运行期零解释。

## 任务清单

- [ ] `ScriptModule` / `ScriptSetupApi` 类型与加载时序（管线步骤 6：先注册后冻结）
- [ ] `registerEffect`：`x.<script>.<name>` 命名空间强制 + 重复检测 + 内置 ID 冲突拒绝
- [ ] `registerFunction`：同命名空间约束 + `pure` 元数据传递（事件缓存敏感性）
- [ ] `registerCheckRule`：自定义检定规则接入（15 号路由）
- [ ] `onHook`：time/loop_transition/battle_round_end/load_complete 钩子注册与触发序
- [ ] 事务约束：脚本唯一状态入口 `host.transaction`（内部 exec 包装）——不暴露原始 draft 的架构测试
- [ ] `touchState` 新域 warn（内置清单外前缀 → SCRIPT_CONTRACT 级提示，26 号发布门禁联动）
- [ ] 悬空契约：数据 `call` 引用未注册指令 → SCRIPT_CONTRACT error（FR-SCR-04）
- [ ] 手工 ScriptModule 桩全流程测试（注册→数据调用→事务生效→回滚一致）

## 完成定义
- [ ] 全部子任务勾选；桩测试全绿；「运行期无 eval/动态加载」架构断言（lint + 测试）通过
