# 负例夹具（fixtures/negatives）

每个子目录是一个**只含单一缺陷**的最小游戏包，供加载器/编辑器校验测试
断言诊断编码（设计 §3.4 独立测试）。纯数据，无任何可执行内容。

| 目录 | 缺陷 | 预期诊断编码（shared §2.2 ErrCode） | 触发方式 |
|---|---|---|---|
| `dangling-ref/` | 选项跳转指向不存在的场景 | `DANGLING_REF` | `locked_door` 的选项 `goto: nowhere_hall` |
| `dup-id/` | 两个场景文件声明同一场景 ID | `DUP_ID` | `east_gate/checkpoint.yaml` 与 `west_gate/checkpoint.yaml` 均 `id: checkpoint` |
| `bad-expr/` | 条件表达式括号不配平（非法表达式） | `EXPR_COMPILE` | `shrine` 选项 `showIf` 表达式缺右括号 |

除目标缺陷外，各包其余结构（manifest、entryScene、场景目录布局）保持
合法，使校验测试能将失败精确定位到目标缺陷。
