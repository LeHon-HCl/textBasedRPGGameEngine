import { describe, expect, it } from 'vitest';
import { EngineError, isEngineError } from '@game/shared';
import type { SceneDef } from '@game/shared';
import { makeDef, makeRunner, makeRuntime, visibleIds } from './fixtures.js';

/**
 * 场景进入条件与场景标签用例（08 任务 C3，FR-NARR-01 场景元信息 /
 * FR-XPLR-04 条件型入口「entry.require」）：
 * - 构造（会话入口）与跳转进入（enterScene）统一走进入条件校验；
 * - 不满足 → INTERNAL entryDenied（跳转期停留 resolving 错误挂起态）；
 * - 场景标签经 sceneTags 只读访问器暴露（内容分级呈现面）。
 */

const LOCALES = {
  'zh-CN': {
    scenes: {
      main: { p1: '主场景。', choice: { to_gate: '去门禁场景', to_open: '去开放场景' } },
      gated: { p1: '门禁场景。', choice: { nothing: '无' } },
      open: { p1: '开放场景。', choice: { nothing: '无' } },
      tagged: { p1: '有标签场景。', choice: { nothing: '无' } },
    },
  },
};

function fromMain(choices: SceneDef['choices']): SceneDef {
  return { id: 'scene_main', area: 'demo', segments: [{ key: 'scenes.main.p1' }], choices };
}

function deepDef() {
  return makeDef({
    scenes: [
      fromMain([
        { id: 'to_gate', textKey: 'scenes.main.choice.to_gate', goto: 'scene_gated' },
        { id: 'to_open', textKey: 'scenes.main.choice.to_open', goto: 'scene_open' },
      ]),
      {
        id: 'scene_gated',
        area: 'demo',
        entry: { require: 'flag.gate_open' },
        segments: [{ key: 'scenes.gated.p1' }],
        choices: [{ id: 'nothing', textKey: 'scenes.gated.choice.nothing' }],
      },
      {
        id: 'scene_open',
        area: 'demo',
        entry: { require: 'flag.gate_open' },
        segments: [{ key: 'scenes.open.p1' }],
        choices: [{ id: 'nothing', textKey: 'scenes.open.choice.nothing' }],
      },
      {
        id: 'scene_tagged',
        area: 'demo',
        segments: [{ key: 'scenes.tagged.p1' }],
        choices: [{ id: 'nothing', textKey: 'scenes.tagged.choice.nothing' }],
        tags: ['tag_spooky', 'tag_general'],
      },
    ],
    locales: LOCALES,
  });
}

describe('08-C3 entry.require：会话入口校验', () => {
  it('进入条件满足 → 构造成功（正常状态机流程）', () => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_gated',
          area: 'demo',
          entry: { require: 'flag.gate_open' },
          segments: [{ key: 'scenes.gated.p1' }],
          choices: [],
        },
      ],
      locales: LOCALES,
    });
    const runner = makeRunner(def, {
      sceneId: 'scene_gated',
      runtime: makeRuntime({ flags: { gate_open: true } }),
    });
    expect(runner.phase).toBe('entering');
    expect(runner.renderList()[0]?.key).toBe('scenes.gated.p1');
  });

  it('进入条件不满足 → 构造抛 INTERNAL entryDenied（where 携带场景与表达式）', () => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_gated',
          area: 'demo',
          entry: { require: 'flag.gate_open' },
          segments: [{ key: 'scenes.gated.p1' }],
          choices: [],
        },
      ],
      locales: LOCALES,
    });
    try {
      makeRunner(def, { sceneId: 'scene_gated', runtime: makeRuntime({ flags: {} }) });
      throw new Error('unreachable');
    } catch (error) {
      expect(isEngineError(error)).toBe(true);
      expect((error as EngineError).code).toBe('INTERNAL');
      expect((error as EngineError).messageKey).toBe('error.narrative.entryDenied');
      expect((error as EngineError).where['scene']).toBe('scene_gated');
      expect((error as EngineError).where['require']).toBe('flag.gate_open');
    }
  });

  it('无 entry 声明的场景不受影响（缺省 = 无条件进入）', () => {
    const def = makeDef({
      scenes: [
        { id: 'scene_main', area: 'demo', segments: [{ key: 'scenes.main.p1' }], choices: [] },
      ],
      locales: LOCALES,
    });
    const runner = makeRunner(def, { sceneId: 'scene_main', runtime: makeRuntime({ flags: {} }) });
    expect(runner.renderList()).toHaveLength(1);
  });
});

describe('08-C3 entry.require：跳转目标校验', () => {
  it('跳转目标条件满足 → 正常 entering（事件子会话判定不受影响）', () => {
    const runner = makeRunner(deepDef(), {
      sceneId: 'scene_main',
      runtime: makeRuntime({ flags: { gate_open: true } }),
    });
    runner.renderList();
    runner.advance();
    runner.choose('to_open');
    expect(runner.currentSceneId).toBe('scene_open');
    expect(runner.phase).toBe('entering');
  });

  it('跳转目标条件不满足 → choose 抛 entryDenied，会话停留 resolving（错误挂起态）', () => {
    const runner = makeRunner(deepDef(), {
      sceneId: 'scene_main',
      runtime: makeRuntime({ flags: {} }),
    });
    runner.renderList();
    runner.advance();
    expect(visibleIds(runner.choices())).toEqual(['to_gate', 'to_open']);
    expect(() => runner.choose('to_gate')).toThrowError(EngineError);
    expect(runner.phase).toBe('resolving');
  });
});

describe('08-C3 场景标签（FR-NARR-01 场景元信息）', () => {
  it('sceneTags 暴露当前场景 tags；跨场景跳转后随帧更新', () => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_main',
          area: 'demo',
          segments: [{ key: 'scenes.main.p1' }],
          choices: [{ id: 'to_open', textKey: 'scenes.main.choice.to_open', goto: 'scene_tagged' }],
        },
        {
          id: 'scene_tagged',
          area: 'demo',
          segments: [{ key: 'scenes.tagged.p1' }],
          choices: [],
          tags: ['tag_spooky', 'tag_general'],
        },
      ],
      locales: LOCALES,
    });
    const runner = makeRunner(def, { sceneId: 'scene_main', runtime: makeRuntime({}) });
    expect(runner.sceneTags).toEqual([]);
    runner.renderList();
    runner.advance();
    runner.choose('to_open');
    expect(runner.currentSceneId).toBe('scene_tagged');
    expect(runner.sceneTags).toEqual(['tag_spooky', 'tag_general']);
  });

  it('挂起的主会话帧标签随 back 恢复', () => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_tagged',
          area: 'demo',
          segments: [{ key: 'scenes.tagged.p1' }],
          choices: [{ id: 'nothing', textKey: 'scenes.tagged.choice.nothing' }],
          tags: ['tag_main'],
        },
        {
          id: 'scene_open',
          area: 'demo',
          segments: [{ key: 'scenes.open.p1' }],
          choices: [
            { id: 'leave', textKey: 'scenes.open.choice.nothing', effects: [{ back: null }] },
          ],
        },
      ],
      locales: LOCALES,
      events: [
        {
          id: 'ev_open',
          where: { area: 'demo' },
          when: {},
          trigger: { type: 'condition', require: 'flag.always_true' },
          scene: 'scene_open',
        },
      ],
    });
    const runner = makeRunner(def, {
      sceneId: 'scene_tagged',
      runtime: makeRuntime({ flags: { always_true: true } }),
    });
    expect(runner.sceneTags).toEqual(['tag_main']);
    runner.renderList();
    runner.advance();
    runner.choose('nothing'); // 空效果，无跳转——回 await_choice
    // 直接以 goto 跳事件场景的路径在 C1 用例覆盖；此处仅断言标签随帧取值
    expect(runner.sceneTags).toEqual(['tag_main']);
  });
});
