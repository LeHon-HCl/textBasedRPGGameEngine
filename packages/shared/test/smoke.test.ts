import { describe, expect, it } from 'vitest';
import * as sharedEntry from '../src/index.js';

/**
 * 工具链冒烟（00 号模块 B 组）：验证「Vitest + NodeNext/ESM + TS strict 基线」
 * 能够解析并加载 shared 包源码入口。真正的 shared 功能测试由 01 号模块
 * 按设计 §2 逐域补齐。
 */
describe('shared 包工具链冒烟', () => {
  it('入口模块可被解析并加载为命名空间对象', () => {
    expect(sharedEntry).toBeTypeOf('object');
  });

  it('Vitest 断言与模块语义在 node 环境正常工作', () => {
    expect(Object.keys(sharedEntry)).toContain('refId');
  });
});
