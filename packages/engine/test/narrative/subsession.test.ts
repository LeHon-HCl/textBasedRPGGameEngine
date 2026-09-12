import { describe, expect, it } from 'vitest';
import type { EventDef, SceneDef } from '@game/shared';
import { SUBSESSION_DEPTH_LIMIT } from '../../src/narrative/scene-runner.js';
import { makeDef, makeRunner, makeRuntime, visibleIds, warningSink } from './fixtures.js';

/**
 * 子会话挂起栈用例（08 任务 C1，设计 §4.2「事件场景以 SceneRunner 启动子
 * 会话；子会话结束 back 回主会话——实现为主会话挂起栈，深度限 3，超限 =
 * 数据设计问题，warning」）：
 * - 事件场景判定：def.events 声明的 event.scene 集合（数据驱动，非命名约定）；
 * - {scene} → 事件场景：当前帧压栈（深度未超限）；
 * - {back} → 弹栈恢复主会话（回到选项相位）；无挂起帧 → finished('back')；
 * - 深度限 3：超限跳转发 warning 且不再压栈（按普通导航替换当前帧）。
 */

const LOCALES = {
  'zh-CN': {
    scenes: {
      main: { p1: '主场景。', choice: { to_event: '进入事件', to_plain: '去普通场景' } },
      ev_first: { p1: '事件一。', choice: { next: '更深处', leave: '离开' } },
      ev_second: { p1: '事件二。', choice: { next: '更深处', leave: '离开' } },
      ev_third: { p1: '事件三。', choice: { next: '更深处', leave: '离开' } },
      ev_fourth: { p1: '事件四。', choice: { next: '更深处', leave: '离开' } },
      scene_plain: { p1: '普通场景。', choice: { nothing: '无事可做' } },
    },
  },
};

/** 主场景：跳事件场景 / 跳普通场景 */
function mainScene(): SceneDef {
  return {
    id: 'scene_main',
    area: 'demo',
    segments: [{ key: 'scenes.main.p1' }],
    choices: [
      { id: 'to_event', textKey: 'scenes.main.choice.to_event', goto: 'ev_first' },
      { id: 'to_plain', textKey: 'scenes.main.choice.to_plain', goto: 'scene_plain' },
    ],
  };
}

/** 事件场景：next 级联进入下一事件场景；leave 经 back 返回上层 */
function chainedEventScene(id: string, nextId: string): SceneDef {
  return {
    id,
    area: 'demo',
    segments: [{ key: `scenes.${id}.p1` }],
    choices: [
      { id: 'next', textKey: `scenes.${id}.choice.next`, goto: nextId },
      { id: 'leave', textKey: `scenes.${id}.choice.leave`, effects: [{ back: null }] },
    ],
  };
}

/** 普通场景（不在 events.scene 集合内） */
function plainScene(): SceneDef {
  return {
    id: 'scene_plain',
    area: 'demo',
    segments: [{ key: 'scenes.scene_plain.p1' }],
    choices: [{ id: 'nothing', textKey: 'scenes.scene_plain.choice.nothing' }],
  };
}

function eventFor(sceneId: string): EventDef {
  return {
    id: `ev_${sceneId}`,
    where: { area: 'demo' },
    when: {},
    trigger: { type: 'condition', require: 'flag.always_true' },
    scene: sceneId,
  };
}

function deepDef() {
  return makeDef({
    scenes: [
      mainScene(),
      chainedEventScene('ev_first', 'ev_second'),
      chainedEventScene('ev_second', 'ev_third'),
      chainedEventScene('ev_third', 'ev_fourth'),
      chainedEventScene('ev_fourth', 'ev_fourth'),
      plainScene(),
    ],
    events: [
      eventFor('ev_first'),
      eventFor('ev_second'),
      eventFor('ev_third'),
      eventFor('ev_fourth'),
    ],
    locales: LOCALES,
  });
}

/** 主场景推进到选项相位 */
function toMainChoice(runtimeSpec?: Parameters<typeof makeRuntime>[0]) {
  const runtime = makeRuntime({ flags: { always_true: true }, ...runtimeSpec });
  const runner = makeRunner(deepDef(), { sceneId: 'scene_main', runtime });
  runner.renderList();
  runner.advance();
  return runner;
}

/** 事件场景推进到选项相位（单段落：render 揭示首段 + advance 终段迁移） */
function throughEvent(runner: ReturnType<typeof makeRunner>, choice: string): void {
  runner.choose(choice);
  runner.renderList();
  runner.advance();
}

describe('08-C1 子会话挂起栈：事件场景进入与返回', () => {
  it('跳转到事件场景：当前帧压栈（depth=1），进入事件场景选项相位', () => {
    const runner = toMainChoice();
    throughEvent(runner, 'to_event');
    expect(runner.currentSceneId).toBe('ev_first');
    expect(runner.depth).toBe(1);
    expect(runner.phase).toBe('await_choice');
    expect(visibleIds(runner.choices())).toEqual(['next', 'leave']);
  });

  it('事件场景 {back} → 弹栈恢复主会话（选项相位，剩余选项可选）', () => {
    const runner = toMainChoice();
    throughEvent(runner, 'to_event');
    runner.choose('leave');
    expect(runner.currentSceneId).toBe('scene_main');
    expect(runner.depth).toBe(0);
    expect(runner.phase).toBe('await_choice');
    expect(visibleIds(runner.choices())).toEqual(['to_event', 'to_plain']);
  });

  it('普通场景跳转不压栈（导航替换，depth 保持 0）', () => {
    const runner = toMainChoice();
    runner.choose('to_plain');
    runner.renderList();
    runner.advance();
    expect(runner.currentSceneId).toBe('scene_plain');
    expect(runner.depth).toBe(0);
  });

  it('子会话可重复进入：事件场景 back 后主场景保持原位', () => {
    const runner = toMainChoice();
    throughEvent(runner, 'to_event');
    runner.choose('leave');
    throughEvent(runner, 'to_event');
    runner.choose('leave');
    expect(runner.depth).toBe(0);
    expect(runner.currentSceneId).toBe('scene_main');
  });

  it('主会话（无挂起帧）{back} → finished（endReason=back）', () => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_main',
          area: 'demo',
          segments: [{ key: 'scenes.main.p1' }],
          choices: [
            { id: 'back_out', textKey: 'scenes.main.choice.to_event', effects: [{ back: null }] },
          ],
        },
      ],
      locales: LOCALES,
    });
    const runner = makeRunner(def, {
      sceneId: 'scene_main',
      runtime: makeRuntime({ flags: { always_true: true } }),
    });
    runner.renderList();
    runner.advance();
    runner.choose('back_out');
    expect(runner.phase).toBe('finished');
    expect(runner.endReason).toBe('back');
  });
});

describe('08-C1 子会话挂起栈：深度限 3 与 warning', () => {
  it('级联事件场景逐层压栈：depth 依次 1/2/3，均无 warning', () => {
    const sink = warningSink();
    const watched = makeRunner(deepDef(), {
      sceneId: 'scene_main',
      runtime: makeRuntime({ flags: { always_true: true } }),
      onWarn: sink.onWarn,
    });
    watched.renderList();
    watched.advance();
    throughEvent(watched, 'to_event'); // depth 1
    throughEvent(watched, 'next'); // depth 2
    throughEvent(watched, 'next'); // depth 3
    expect(watched.depth).toBe(SUBSESSION_DEPTH_LIMIT);
    expect(watched.currentSceneId).toBe('ev_third');
    expect(sink.warnings).toEqual([]);
  });

  it('第 4 层事件场景：warning（subsession_depth_exceeded）、不压栈、back 逐层恢复', () => {
    const sink = warningSink();
    const runner = makeRunner(deepDef(), {
      sceneId: 'scene_main',
      runtime: makeRuntime({ flags: { always_true: true } }),
      onWarn: sink.onWarn,
    });
    runner.renderList();
    runner.advance();
    throughEvent(runner, 'to_event'); // 挂起 [main]
    throughEvent(runner, 'next'); // 挂起 [main, ev1]
    throughEvent(runner, 'next'); // 挂起 [main, ev1, ev2]
    throughEvent(runner, 'next'); // 第 4 层：超限，ev_third 被替换不压栈
    expect(sink.warnings).toHaveLength(1);
    expect(sink.warnings[0]?.code).toBe('subsession_depth_exceeded');
    expect(sink.warnings[0]?.where['scene']).toBe('ev_third');
    expect(sink.warnings[0]?.where['target']).toBe('ev_fourth');
    expect(sink.warnings[0]?.where['depth']).toBe(String(SUBSESSION_DEPTH_LIMIT));
    expect(runner.currentSceneId).toBe('ev_fourth');
    expect(runner.depth).toBe(SUBSESSION_DEPTH_LIMIT);
    // ev_fourth 的 back 恢复的是最近挂起帧（ev_second）——被替换层不可恢复
    runner.choose('leave');
    expect(runner.currentSceneId).toBe('ev_second');
    expect(runner.depth).toBe(2);
  });
});
