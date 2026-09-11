# 01 shared 基础类型与错误/随机体系

| 项 | 内容 |
|---|---|
| 设计依据 | detail-design §2.1、§2.2、§2.5 |
| 需求映射 | D3、NFR-23、DD-09 |
| 前置模块 | 00 |
| 里程碑 | M0 |

> 目标：ID/引用类型、错误三元组体系、可注入种子 RNG——后续所有模块的类型地基。

## 任务清单

### A. ID 与引用类型（§2.1）
- [x] `GameId` / `TextKey` / `Lang` / `ExprSource` / `RefKind` 类型与 `refId(kind)` Zod 辅助器
- [x] ID 命名规则校验函数（`[a-z][a-z0-9_]*`）+ 单测（合法/非法样例）

### B. 错误体系（§2.2）
- [x] `ErrCode` 全集 + `EngineError` 构造器（code/where/messageKey 三元组）
- [ ] ESLint 自定义规则或约束：包内禁止裸 `throw new Error`（先以 review 约定 + 测试占位，规则随 00 收尾）
- [x] 错误序列化（诊断导出用，脱敏）+ 单测

### C. 随机数（§2.5，DD-09）
- [x] `Rng` 接口 + `createRng`（mulberry32）：确定性序列测试（固定种子断言前 100 值）
- [ ] `int/pick/weighted/chance` 边界（min=max、空池、权重 0、p=0/1）测试
- [ ] `getState/setState` 往返一致性测试
- [ ] `fork()` 分叉不回写语义测试

## 完成定义
- [ ] 全部子任务勾选，shared 覆盖率 ≥ 90%（§10.1 门禁）
- [ ] `shared/src/index.ts` 公开 API 冻结清单初版（semver 标注）
