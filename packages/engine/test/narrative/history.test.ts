import { describe, expect, it } from 'vitest';
import type { SceneDef } from '@game/shared';
import { NARRATIVE_HISTORY_CAPACITY } from '../../src/narrative/scene-runner.js';
import { makeDef, makeRunner, makeRuntime } from './fixtures.js';

/**
 * 历史缓冲用例（08 任务 C2，设计 §4.2「每段渲染时把 RenderSegment + 场景
 * 上下文推入运行时历史缓冲（环形，容量 500 段）」/ FR-READ-04 历史回看）。
 */

const LOCALES = {
  'zh-CN': {
    scenes: {
      main: { p1: '主一。', p2: '主二。', p3: '主三。', choice: { leave: '离开' } },
      next: { p1: '下一。', choice: { nothing: '无' } },
    },
  },
};

function longScene(count: number): SceneDef {
  return {
    id: 'scene_long',
    area: 'demo',
    segments: Array.from({ length: count }, (_, index) => ({ key: `scenes.long.p${index}` })),
    choices: [],
  };
}

function longLocales(count: number) {
  const paragraphs: Record<string, string> = {};
  for (let index = 0; index < count; index++) paragraphs[`p${index}`] = `段 ${index}。`;
  return { 'zh-CN': { scenes: { long: paragraphs } } };
}

describe('08-C2 历史缓冲：入账与场景上下文', () => {
  it('渲染的文本段落逐条入账，携带场景 id 与时钟投影；spacing/image 不入账', () => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_main',
          area: 'demo',
          segments: [{ key: 'scenes.main.p1' }, { key: 'scenes.main.p2' }],
          choices: [{ id: 'leave', textKey: 'scenes.main.choice.leave' }],
          media: { bg: 'bg_demo' },
        },
      ],
      locales: LOCALES,
    });
    const runtime = makeRuntime();
    const runner = makeRunner(def, { sceneId: 'scene_main', runtime });
    runner.renderList();
    expect(runner.history()).toHaveLength(1);
    runner.advance();
    expect(runner.history()).toHaveLength(2);
    const [first, second] = runner.history();
    expect(first?.seq).toBe(0);
    expect(first?.sceneId).toBe('scene_main');
    expect(first?.segment.kind).toBe('text');
    expect(first?.segment.key).toBe('scenes.main.p1');
    expect(first?.clock).toEqual({
      day: runtime.state.world.time.day,
      slotIndex: runtime.state.world.time.slotIndex,
    });
    expect(second?.segment.key).toBe('scenes.main.p2');
    expect(second?.seq).toBe(1);
  });

  it('重复渲染不重复入账（游标推进才入账）', () => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_main',
          area: 'demo',
          segments: [
            { key: 'scenes.main.p1' },
            { key: 'scenes.main.p2' },
            { key: 'scenes.main.p3' },
          ],
          choices: [],
        },
      ],
      locales: LOCALES,
    });
    const runner = makeRunner(def, { sceneId: 'scene_main' });
    runner.renderList();
    runner.renderList();
    runner.renderList();
    expect(runner.history()).toHaveLength(1);
    runner.advance();
    runner.advance();
    expect(runner.history()).toHaveLength(3);
    expect(runner.history().map((entry) => entry.segment.key)).toEqual([
      'scenes.main.p1',
      'scenes.main.p2',
      'scenes.main.p3',
    ]);
  });

  it('跨场景推进：历史条目按场景 id 分组线索（子会话返回后继续追加）', () => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_main',
          area: 'demo',
          segments: [{ key: 'scenes.main.p1' }],
          choices: [{ id: 'leave', textKey: 'scenes.main.choice.leave', goto: 'scene_next' }],
        },
        {
          id: 'scene_next',
          area: 'demo',
          segments: [{ key: 'scenes.next.p1' }],
          choices: [],
        },
      ],
      locales: LOCALES,
    });
    const runner = makeRunner(def, { sceneId: 'scene_main' });
    runner.renderList();
    runner.advance();
    runner.choose('leave');
    runner.renderList();
    runner.advance();
    const history = runner.history();
    expect(history.map((entry) => entry.sceneId)).toEqual(['scene_main', 'scene_next']);
    expect(history.map((entry) => entry.segment.key)).toEqual(['scenes.main.p1', 'scenes.next.p1']);
    expect(history.map((entry) => entry.seq)).toEqual([0, 1]);
  });

  it('只读访问器返回副本：外部改写不影响会话内部', () => {
    const def = makeDef({
      scenes: [
        { id: 'scene_main', area: 'demo', segments: [{ key: 'scenes.main.p1' }], choices: [] },
      ],
      locales: LOCALES,
    });
    const runner = makeRunner(def, { sceneId: 'scene_main' });
    runner.renderList();
    const snapshot = runner.history();
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(Object.isFrozen(snapshot[0]?.segment)).toBe(true);
    // 严格模式下冻结条目的改写抛 TypeError（副本/条目均不可变）
    expect(() => {
      (snapshot[0] as { seq: number }).seq = 999;
    }).toThrowError(TypeError);
    expect(runner.history()[0]?.seq).toBe(0);
  });
});

describe('08-C2 历史缓冲：环形容量 500', () => {
  it('超出 500 段挤出最旧条目（长度恒为 500，seq 连续递增）', () => {
    const count = NARRATIVE_HISTORY_CAPACITY + 1; // 501 段
    const def = makeDef({ scenes: [longScene(count)], locales: longLocales(count) });
    const runner = makeRunner(def, { sceneId: 'scene_long' });
    runner.renderList(); // 揭示第 1 段
    for (let index = 0; index < count; index++) runner.advance(); // 揭示其余 500 段 + 终局迁移
    const history = runner.history();
    expect(runner.phase).toBe('finished');
    expect(history).toHaveLength(NARRATIVE_HISTORY_CAPACITY);
    expect(history[0]?.seq).toBe(1); // seq 0（第 1 段）被挤出
    expect(history[0]?.segment.key).toBe('scenes.long.p1');
    expect(history[NARRATIVE_HISTORY_CAPACITY - 1]?.segment.key).toBe(`scenes.long.p${count - 1}`);
    expect(history[NARRATIVE_HISTORY_CAPACITY - 1]?.seq).toBe(count - 1);
  });
});
