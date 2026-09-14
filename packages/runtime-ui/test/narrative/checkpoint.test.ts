import { describe, expect, it, vi } from 'vitest';
import { createChoiceCheckpoint, withChoiceCheckpoint } from '../../src/narrative/index.js';

/**
 * 25 任务 5：选择前 checkpoint（设计 §6.3 回滚行 / FR-READ-03）。
 *
 * 契约：每次玩家选择前先打快照（回滚到「上一次选择」的最小代价路径），
 * 然后才执行选择。顺序不可交换——先执行后打卡会丢掉执行前的状态。
 * 标签格式为 `choice:<scene>:<choiceId>`（诊断面板与测试的可读定位）。
 */

describe('createChoiceCheckpoint：快照标签与调用顺序', () => {
  it('先 checkpoint 后 choose；标签携带场景与选项 id', () => {
    const calls: string[] = [];
    const runtime = {
      checkpoint: (label: string) => calls.push(`checkpoint:${label}`),
      rollback: (steps = 1) => {
        calls.push(`rollback:${steps}`);
        return { ok: true, restoredLabel: 'choice:arrival:go_market' };
      },
    };
    const checkpoint = createChoiceCheckpoint(runtime);
    checkpoint({ sceneId: 'arrival', choiceId: 'go_market' }, () => calls.push('choose'));
    expect(calls).toEqual(['checkpoint:choice:arrival:go_market', 'choose']);
  });

  it('执行体抛错时不吞异常（选择失败由宿主回滚，见 withChoiceCheckpoint）', () => {
    const runtime = { checkpoint: vi.fn(), rollback: vi.fn() };
    const checkpoint = createChoiceCheckpoint(runtime);
    expect(() =>
      checkpoint({ sceneId: 'arrival', choiceId: 'boom' }, () => {
        throw new Error('choose failed');
      }),
    ).toThrowError('choose failed');
    expect(runtime.checkpoint).toHaveBeenCalledTimes(1);
  });
});

describe('withChoiceCheckpoint：失败即回滚（FR-READ-03）', () => {
  it('执行成功不触发 rollback', () => {
    const runtime = { checkpoint: vi.fn(), rollback: vi.fn() };
    const result = withChoiceCheckpoint(
      runtime,
      { sceneId: 'arrival', choiceId: 'go_market' },
      () => 'ok',
    );
    expect(result).toEqual({ ok: true, value: 'ok' });
    expect(runtime.rollback).not.toHaveBeenCalled();
  });

  it('执行抛错 → 自动回滚一步并返回失败结果（会话相位可能停在 resolving）', () => {
    const runtime = {
      checkpoint: vi.fn(),
      rollback: vi.fn(() => ({ ok: true, restoredLabel: 'choice:arrival:go_market' })),
    };
    const result = withChoiceCheckpoint(runtime, { sceneId: 'arrival', choiceId: 'boom' }, () => {
      throw new Error('EFFECT_FAILED');
    });
    expect(result).toMatchObject({ ok: false, restoredLabel: 'choice:arrival:go_market' });
    expect(runtime.rollback).toHaveBeenCalledWith(1);
  });

  it('回滚本身不可用（无快照）时仍返回失败详情，不掩盖原始错误', () => {
    const runtime = {
      checkpoint: vi.fn(),
      rollback: vi.fn(() => ({ ok: false })),
    };
    const result = withChoiceCheckpoint(runtime, { sceneId: 'arrival', choiceId: 'boom' }, () => {
      throw new Error('boom');
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.restoredLabel).toBeUndefined();
    }
  });

  it('非 Error 抛出物也被包成 Error（诊断面统一形态）', () => {
    const runtime = { checkpoint: vi.fn(), rollback: vi.fn(() => ({ ok: false })) };
    const result = withChoiceCheckpoint(runtime, { sceneId: 's', choiceId: 'c' }, () => {
      throw 'string failure';
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('string failure');
  });
});
