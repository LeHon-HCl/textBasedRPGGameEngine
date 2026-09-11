import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import * as engineEntry from '../src/index.js';

/**
 * 工具链冒烟（00 号模块 B 组）：验证「Vitest + NodeNext/ESM + TS strict 基线」
 * 能够解析并加载 engine 包源码入口，且 engine 在 node 环境可测（无 DOM 依赖，
 * 设计 §1.2 R2）。随 04 号模块接入状态与运行时子系统，冒烟同步断言 §10.4
 * 根出口的导出接线（后续模块按同一约定扩展）。
 */
describe('engine 包工具链冒烟', () => {
  it('入口模块可被解析并加载为命名空间对象', () => {
    expect(engineEntry).toBeTypeOf('object');
  });

  it('公开 API 出口包含 state 子系统导出（04 任务 A 组接线）', () => {
    expect(typeof engineEntry.newGameState).toBe('function');
    expect(typeof engineEntry.recomputeDerived).toBe('function');
    expect(typeof engineEntry.buildExprScope).toBe('function');
    expect(typeof engineEntry.defaultTimeView).toBe('function');
    expect(typeof engineEntry.serializeState).toBe('function');
    expect(typeof engineEntry.restoreState).toBe('function');
    expect(engineEntry.ENGINE_VERSION).toBeTypeOf('string');
  });

  it('公开 API 出口包含 runtime 子系统导出（04 任务 B/C 组接线）', () => {
    expect(typeof engineEntry.GameRuntime).toBe('function');
    expect(engineEntry.PERF_GUARD.checkpointStackDepth).toBe(5);
  });

  it('公开 API 出口包含 effects 子系统导出（05 任务 A 组接线）', () => {
    expect(typeof engineEntry.EffectRegistry).toBe('function');
    expect(new engineEntry.EffectRegistry().lookup('set')).toBeUndefined();
  });

  it('Vitest 断言与模块语义在 node 环境正常工作', () => {
    const state = engineEntry.newGameState(
      { versions: { gameVersion: '0.0.0', schemaVersion: 1, minEngineVersion: '0.0.0' } },
      createRng(42),
    );
    expect(state.loop).toBe(0);
  });
});
