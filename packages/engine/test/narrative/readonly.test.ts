import { describe, expect, it } from 'vitest';
import { EngineError, isEngineError } from '@game/shared';
import type { SceneDef } from '@game/shared';
import { makeDef, makeRunner, makeRuntime } from './fixtures.js';

/**
 * 只读会话（回想重放）用例（08 任务 B3，设计 §4.2「readonly 会话（回想）
 * 忽略 first/again 副作用且不写 seen」/ FR-GAL-01「只读模式重放，不影响
 * 当前 GameState」）。
 */

function sceneWith(segments: SceneDef['segments'], choices: SceneDef['choices']): SceneDef {
  return { id: 'scene_replay', area: 'demo', segments, choices };
}

const LOCALES = {
  'zh-CN': {
    scenes: {
      replay: {
        intro: { first: 'scenes.replay.intro_first', again: 'scenes.replay.intro_again' },
        intro_first: '初次文本。',
        intro_again: '再次文本。',
        tale: {
          random: [
            { weight: 1, key: 'scenes.replay.tale_a' },
            { weight: 1, key: 'scenes.replay.tale_b' },
          ],
        },
        tale_a: '甲。',
        tale_b: '乙。',
        plain: '普通段落。',
        choice: { pick: '选择' },
      },
    },
  },
};

function replayDef() {
  return makeDef({
    scenes: [
      sceneWith(
        [{ key: 'scenes.replay.intro' }, { key: 'scenes.replay.plain' }],
        [{ id: 'pick', textKey: 'scenes.replay.choice.pick' }],
      ),
    ],
    locales: LOCALES,
  });
}

describe('08-B3 只读会话：无副作用', () => {
  it('渲染不写 seen.scenes（回想重放不影响 GameState）', () => {
    const runtime = makeRuntime();
    const runner = makeRunner(replayDef(), { sceneId: 'scene_replay', runtime, readonly: true });
    runner.renderList();
    runner.advance();
    expect(runtime.state.seen.scenes).toEqual([]);
    expect(runner.isReadonly).toBe(true);
  });

  it('choose 即抛 INTERNAL（readonlyChoice），不触发任何事务', () => {
    const runtime = makeRuntime();
    const runner = makeRunner(replayDef(), { sceneId: 'scene_replay', runtime, readonly: true });
    runner.renderList();
    expect(() => runner.choose('pick')).toThrowError(EngineError);
    expect(runner.phase).toBe('await_advance');
    try {
      runner.choose('pick');
    } catch (error) {
      expect(isEngineError(error)).toBe(true);
      expect((error as EngineError).messageKey).toBe('error.narrative.readonlyChoice');
    }
  });

  it('随机宏不消耗运行时主随机序列（rng.fork 派生子序列，主状态不变）', () => {
    const runtime = makeRuntime();
    const before = runtime.rng.getState();
    const def = makeDef({
      scenes: [sceneWith([{ key: 'scenes.replay.tale' }], [])],
      locales: LOCALES,
    });
    const runner = makeRunner(def, { sceneId: 'scene_replay', runtime, readonly: true });
    runner.renderList();
    expect(runtime.rng.getState()).toBe(before);
    // 派生子序列确定性：同状态重复回放得到同一随机分支
    const second = makeRunner(def, { sceneId: 'scene_replay', runtime, readonly: true });
    expect(second.renderList()[0]?.key).toBe(runner.renderList()[0]?.key);
  });
});

describe('08-B3 只读会话：回想重放的渲染语义', () => {
  it('first/again 强制 again 分支（回想必然重放已看过的场景）', () => {
    const runner = makeRunner(replayDef(), {
      sceneId: 'scene_replay',
      readonly: true,
      runtime: makeRuntime(), // seen.scenes 为空——仍渲染 again 分支
    });
    expect(runner.renderList()[0]?.key).toBe('scenes.replay.intro_again');
  });

  it('回想重放完整走完状态机：render → advance → finished（exhausted）', () => {
    const runner = makeRunner(replayDef(), { sceneId: 'scene_replay', readonly: true });
    runner.renderList();
    runner.advance();
    runner.advance(); // 段落尽；唯一选项仍可见但回想不可交互 → 直接终局
    expect(runner.phase).toBe('finished');
    expect(runner.endReason).toBe('exhausted');
  });

  it('params 快照渲染（FR-GAL-01：使用解锁时的参数快照）', () => {
    const runner = makeRunner(replayDef(), {
      sceneId: 'scene_replay',
      readonly: true,
      params: { unlockedAt: 'day3' },
    });
    expect(runner.renderList()[0]?.vars).toEqual({ unlockedAt: 'day3' });
  });
});
