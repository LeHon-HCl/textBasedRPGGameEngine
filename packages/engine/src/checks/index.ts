import type { CheckRule, CheckRuleResolver } from '../effects/index.js';
import { cocRule } from './coc.js';
import { genericRule } from './generic.js';

/**
 * 判定系统（detail-design §5.1，15 号）：内置规则 + 解析器。
 *
 * - 内置规则：`coc`（CoC 7 版，§5.1 表格全量）、`generic`（roll + value ≥
 *   difficultyValue）；
 * - {@link createBuiltinCheckResolver} 是**兜底解析器**：loader 管线步骤 6 把
 *   「脚本规则 → 宿主解析器 → 本内置解析器」合成一条解析链注入效果注册表
 *   （`runScriptStep`），使 `check` 指令开箱可用；宿主注入自定义解析器时，
 *   其对同名规则的返回值优先生效（宿主权威，测试桩可整体替换 coc 语义）。
 */

/** 内置规则注册表（id 固定，§5.1 表格） */
const BUILTIN_RULES: ReadonlyMap<string, CheckRule> = new Map([
  [cocRule.id, cocRule],
  [genericRule.id, genericRule],
]);

/** 创建内置规则兜底解析器（每次调用返回新实例，无共享状态） */
export function createBuiltinCheckResolver(): CheckRuleResolver {
  return {
    resolve(ruleId: string) {
      return BUILTIN_RULES.get(ruleId);
    },
  };
}

export { cocRule, genericRule };
