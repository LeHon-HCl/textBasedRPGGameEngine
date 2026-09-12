# 负例夹具（fixtures/negatives）

每个子目录是一个**只含单一缺陷**的最小游戏包，供加载器/编辑器校验测试
断言诊断编码（设计 §3.4 独立测试）。纯数据，无任何可执行内容。

| 目录 | 缺陷 | 预期诊断编码（shared §2.2 ErrCode） | 严重级 | 触发方式 |
|---|---|---|---|---|
| `dangling-ref/` | 选项跳转指向不存在的场景 | `DANGLING_REF` | error（阻断） | `locked_door` 的选项 `goto: nowhere_hall` |
| `dup-id/` | 两个场景文件声明同一场景 ID | `DUP_ID` | error（阻断） | `east_gate/checkpoint.yaml` 与 `west_gate/checkpoint.yaml` 均 `id: checkpoint` |
| `bad-expr/` | 条件表达式括号不配平（非法表达式） | `EXPR_COMPILE` | error（阻断） | `shrine` 选项 `showIf` 表达式缺右括号 |
| `dangling-text-key/` | 场景段键在主语言词典缺失（§3.4 主语言缺失键） | `DANGLING_REF`（kind=text） | warning（入 definition.diagnostics） | `shrine` 段键 `scenes.shrine.missing` 无词典条目 |
| `dangling-media/` | 媒体引用指向不存在的资产（FR-MEDIA-06 占位容错） | `DANGLING_REF`（kind=media） | warning（入 definition.diagnostics） | `chapel` 场景 `media.bg: missing_chapel_bg` 且包内无 assets/ |

除目标缺陷外，各包其余结构（manifest、entryScene、区域定义、场景目录布局、
语言包键覆盖）保持合法，使校验测试能将失败精确定位到目标缺陷——其中
error 级负例在管线步骤边界阻断并抛出目标编码，warning 级负例加载成功
且 `definition.diagnostics` 恰含一条目标告警。
