import { describe, expect, it } from 'vitest';
import type { SceneDef } from '@game/shared';
import { makeDef, makeRunner, makeRuntime, stubRuntime, visibleIds } from './fixtures.js';

/**
 * 一次性选项用例（08 任务 B2，设计 §4.2「once 选项的已选记录存 world.flags
 * （键 __choice.<scene>.<choice>），自动生成、无需作者声明」/ FR-NARR-02）。
 */

function sceneWith(choices: SceneDef['choices']): SceneDef {
  return { id: 'scene_start', area: 'demo', segments: [{ key: 'scenes.start.p1' }], choices };
}

const LOCALES = {
  'zh-CN': {
    scenes: { start: { p1: '段落。', choice: { once_pick: '只此一次', other: '别的' } } },
  },
};

const ONCE_KEY = '__choice.scene_start.once_pick';

/** 构造带 once 选项的会话并推进到 await_choice */
function onceRunner(runtimeSpec?: Parameters<typeof makeRuntime>[0]) {
  const def = makeDef({
    scenes: [
      sceneWith([
        { id: 'once_pick', textKey: 'scenes.start.choice.once_pick', once: true },
        { id: 'other', textKey: 'scenes.start.choice.other' },
      ]),
    ],
    locales: LOCALES,
  });
  const runtime = makeRuntime(runtimeSpec);
  const runner = makeRunner(def, { sceneId: 'scene_start', runtime });
  runner.renderList();
  runner.advance();
  return { runner, runtime };
}

describe('08-B2 一次性选项：__choice 自动 flag', () => {
  it('选择 once 选项 → world.flags 写入 __choice.<scene>.<choice>', () => {
    const { runner, runtime } = onceRunner();
    runner.choose('once_pick');
    expect(runtime.state.world.flags[ONCE_KEY]).toBe(true);
  });

  it('非 once 选项不写入 __choice 标记', () => {
    const { runner, runtime } = onceRunner();
    runner.choose('other');
    expect(runtime.state.world.flags[ONCE_KEY]).toBeUndefined();
  });

  it('已选标记在 choices() 中隐藏该选项（同场景再次进入即不可见）', () => {
    const { runner } = onceRunner();
    runner.choose('once_pick');
    expect(visibleIds(runner.choices())).toEqual(['other']);
    // 预置标记的新会话（如读档后重入）：首次进入即隐藏
    const replayed = onceRunner({ flags: { [ONCE_KEY]: true } });
    expect(visibleIds(replayed.runner.choices())).toEqual(['other']);
    expect(replayed.runtime.state.world.flags[ONCE_KEY]).toBe(true);
  });

  it('隐藏后的 once 选项不可再选（INTERNAL choiceFiltered）', () => {
    const { runner, runtime } = onceRunner();
    runner.choose('once_pick');
    expect(() => runner.choose('once_pick')).toThrowError(/choiceFiltered/);
    // 标记值不被重复选择改写（同一事务面之外不再有写入路径）
    expect(runtime.state.world.flags[ONCE_KEY]).toBe(true);
  });

  it('once 标记与选项效果同一事务（原子性：单次 exec 内 flag 在效果序列首位）', () => {
    const stub = stubRuntime();
    const def = makeDef({
      scenes: [
        sceneWith([
          {
            id: 'once_pick',
            textKey: 'scenes.start.choice.once_pick',
            once: true,
            effects: [{ flag: { name: 'did_pick' } }],
          },
        ]),
      ],
      locales: LOCALES,
    });
    const runner = makeRunner(def, { sceneId: 'scene_start', runtime: stub });
    runner.renderList();
    runner.advance();
    runner.choose('once_pick');
    expect(stub.execCalls).toHaveLength(1);
    expect(stub.execCalls[0]?.effects).toEqual([
      { flag: { name: ONCE_KEY, value: true } },
      { flag: { name: 'did_pick' } },
    ]);
  });

  it('全部选项 once 且已选 → 段落尽即终局（无可见选项口径复核）', () => {
    const def = makeDef({
      scenes: [
        sceneWith([{ id: 'once_pick', textKey: 'scenes.start.choice.once_pick', once: true }]),
      ],
      locales: LOCALES,
    });
    const runtime = makeRuntime({ flags: { [ONCE_KEY]: true } });
    const runner = makeRunner(def, { sceneId: 'scene_start', runtime });
    runner.renderList();
    runner.advance();
    expect(runner.phase).toBe('finished');
    expect(runner.endReason).toBe('exhausted');
  });
});
