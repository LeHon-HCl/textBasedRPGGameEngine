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
- [x] ESLint 自定义规则或约束：包内禁止裸 `throw new Error`（已落地于 eslint.config.js `no-restricted-syntax`，限定 shared/engine 的 src，01-B2 曾以探针文件实证命中/放行；2026-09-14 补勾）
- [x] 错误序列化（诊断导出用，脱敏）+ 单测

### C. 随机数（§2.5，DD-09）
- [x] `Rng` 接口 + `createRng`（mulberry32）：确定性序列测试（固定种子断言前 100 值）
- [x] `int/pick/weighted/chance` 边界（min=max、空池、权重 0、p=0/1）测试
- [x] `getState/setState` 往返一致性测试
- [x] `fork()` 分叉不回写语义测试

## 完成定义
- [x] 全部子任务勾选，shared 覆盖率 ≥ 90%（§10.1 门禁）
- [x] `shared/src/index.ts` 公开 API 冻结清单初版（semver 标注）
