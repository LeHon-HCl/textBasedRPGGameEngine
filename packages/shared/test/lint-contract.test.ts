import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * lint 契约测试（01 任务 B2）：验证根 eslint.config.js 确实在
 * packages/shared/src 与 packages/engine/src 范围启用了
 * 「禁止裸 throw new Error」的 no-restricted-syntax 规则
 * （设计 §2.2 / NFR-23），并用从配置中提取的真实 selector 做行为化验证。
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const configText = readFileSync(join(REPO_ROOT, 'eslint.config.js'), 'utf8');

const BARE_THROW_SELECTOR = "ThrowStatement > NewExpression[callee.name='Error']";

/** 从根配置文本中提取裸 throw 拦截 selector，保证测试对象是真实配置而非镜像副本 */
function extractSelectorFromConfig(source: string): string {
  const matched = source.match(/selector:\s*"([^"]*ThrowStatement[^"]*)"/);
  const selector = matched?.[1];
  expect(selector, 'eslint.config.js 中应存在 ThrowStatement 拦截 selector').toBeTypeOf('string');
  return selector as string;
}

/** 用提取出的 selector 构造最小 flat config 并 lint 目标代码片段 */
function lintWithSelector(code: string, selector: string) {
  const linter = new Linter();
  return linter.verify(code, {
    rules: {
      'no-restricted-syntax': ['error', { selector, message: 'bare throw' }],
    },
  });
}

describe('lint 契约：包内禁止裸 throw new Error（设计 §2.2，NFR-23）', () => {
  it('eslint.config.js 定义了裸 throw 拦截 selector', () => {
    expect(configText).toContain(BARE_THROW_SELECTOR);
  });

  it('约束范围限定在 packages/shared/src 与 packages/engine/src', () => {
    expect(configText).toContain("'packages/shared/src/**/*.ts'");
    expect(configText).toContain("'packages/engine/src/**/*.ts'");
  });

  it('行为化验证：throw new Error 命中 no-restricted-syntax', () => {
    const messages = lintWithSelector(
      'throw new Error("boom");',
      extractSelectorFromConfig(configText),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe('no-restricted-syntax');
  });

  it('行为化验证：throw new EngineError 不受限（三元组错误是唯一放行路径）', () => {
    const code = ['class EngineError extends Error {}', 'throw new EngineError();'].join('\n');
    const messages = lintWithSelector(code, extractSelectorFromConfig(configText));
    expect(messages).toHaveLength(0);
  });
});
