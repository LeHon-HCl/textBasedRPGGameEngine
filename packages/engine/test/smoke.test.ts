import { describe, expect, it } from 'vitest';
import * as engineEntry from '../src/index.js';

/**
 * 工具链冒烟（00 号模块 B 组）：验证「Vitest + NodeNext/ESM + TS strict 基线」
 * 能够解析并加载 engine 包源码入口，且 engine 在 node 环境可测（无 DOM 依赖，
 * 设计 §1.2 R2）。engine 功能测试由 03 号及后续模块按 §3/§4/§5 逐域补齐。
 */
describe('engine 包工具链冒烟', () => {
  it('入口模块可被解析并加载为命名空间对象', () => {
    expect(engineEntry).toBeTypeOf('object');
  });

  it('Vitest 断言与模块语义在 node 环境正常工作', () => {
    expect(Object.keys(engineEntry)).toEqual([]);
  });
});
