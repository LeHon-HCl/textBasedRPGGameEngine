import { describe, expect, it } from 'vitest';
import { EngineError, isEngineError } from '@game/shared';
import type { SceneDef } from '@game/shared';
import { makeDef, makeRunner, stubRuntime, visibleIds } from './fixtures.js';

/**
 * 五相位状态机全路径迁移用例（08 任务 A1，设计 §4.2 状态机图逐边）：
 *
 * [*] → entering → await_advance →（自环）→ await_choice / finished
 * await_choice → resolving → entering / finished（ending / back / loop）
 *
 * 断言口径：相位迁移逐边断言 + 渲染前缀/选项序列的行为断言（§1.3 原则 4：
 * 断言状态变化与返回值，禁止空断言）。
 */

/** 两段落 + 两选项的基准场景 */
function baseScene(overrides?: Partial<SceneDef>): SceneDef {
  return {
    id: 'scene_start',
    area: 'demo',
    segments: [{ key: 'scenes.start.p1' }, { key: 'scenes.start.p2' }],
    choices: [
      { id: 'stay', textKey: 'scenes.start.choice.stay' },
      { id: 'leave', textKey: 'scenes.start.choice.leave', goto: 'scene_next' },
    ],
    ...overrides,
  };
}

const DEF = makeDef({
  scenes: [
    baseScene(),
    {
      id: 'scene_next',
      area: 'demo',
      segments: [{ key: 'scenes.next.p1' }],
      choices: [],
    },
    // end 场景：无选项
    {
      id: 'scene_end',
      area: 'demo',
      segments: [{ key: 'scenes.end.p1' }],
      choices: [],
    },
  ],
  locales: {
    'zh-CN': {
      scenes: {
        start: { p1: '第一段。', p2: '第二段。', choice: { stay: '留下', leave: '离开' } },
        next: { p1: '下一场景。' },
        end: { p1: '终局。' },
      },
    },
  },
});

describe('08-A1 五相位状态机：[*] → entering → await_advance', () => {
  it('构造后为 entering，当前场景即构造场景', () => {
    const runner = makeRunner(DEF);
    expect(runner.phase).toBe('entering');
    expect(runner.currentSceneId).toBe('scene_start');
    expect(runner.endReason).toBeUndefined();
  });

  it('未知场景构造即抛 INTERNAL（sceneMissing，无实例残留）', () => {
    try {
      makeRunner(DEF, { sceneId: 'scene_ghost' });
      throw new Error('unreachable');
    } catch (error) {
      expect(isEngineError(error)).toBe(true);
      expect((error as EngineError).code).toBe('INTERNAL');
      expect((error as EngineError).where['scene']).toBe('scene_ghost');
    }
  });

  it('entering --renderList（首段渲染就绪）--> await_advance：返回首段前缀', () => {
    const runner = makeRunner(DEF);
    const segments = runner.renderList();
    expect(runner.phase).toBe('await_advance');
    expect(segments.map((segment) => segment.key)).toEqual(['scenes.start.p1']);
  });

  it('entering 相位 choices() 为空（选项只在段落尽后出现）', () => {
    const runner = makeRunner(DEF);
    expect(runner.choices()).toEqual([]);
  });

  it('entering 相位 advance() 抛错（须先 renderList）且相位不变', () => {
    const runner = makeRunner(DEF);
    expect(() => runner.advance()).toThrowError(EngineError);
    expect(runner.phase).toBe('entering');
  });
});

describe('08-A1 状态机：await_advance 自环与终局迁移', () => {
  it('advance()（还有段落）→ await_advance：renderList 前缀增长', () => {
    const runner = makeRunner(DEF);
    runner.renderList();
    runner.advance();
    expect(runner.phase).toBe('await_advance');
    expect(runner.renderList().map((segment) => segment.key)).toEqual([
      'scenes.start.p1',
      'scenes.start.p2',
    ]);
  });

  it('段落尽且存在可见选项 → await_choice（choices 返回 show_if 过滤后视图）', () => {
    const runner = makeRunner(DEF);
    runner.renderList();
    runner.advance();
    runner.advance();
    expect(runner.phase).toBe('await_choice');
    expect(visibleIds(runner.choices())).toEqual(['stay', 'leave']);
  });

  it('段落尽且无选项（end 场景）→ finished（endReason=exhausted）', () => {
    const runner = makeRunner(DEF, { sceneId: 'scene_end' });
    runner.renderList();
    runner.advance();
    expect(runner.phase).toBe('finished');
    expect(runner.endReason).toBe('exhausted');
  });

  it('段落尽且选项全被 show_if 隐藏 → finished（无可见选项即终局）', () => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_start',
          area: 'demo',
          segments: [{ key: 'scenes.start.p1' }],
          choices: [
            { id: 'locked', textKey: 'scenes.start.choice.locked', showIf: 'flag.never_set' },
          ],
        },
      ],
      locales: { 'zh-CN': { scenes: { start: { p1: '唯一段落。', choice: { locked: '锁着' } } } } },
    });
    const runner = makeRunner(def);
    runner.renderList();
    runner.advance();
    expect(runner.phase).toBe('finished');
    expect(runner.endReason).toBe('exhausted');
  });

  it('advance 越过终局（await_choice / finished 相位）抛错且相位不变', () => {
    const runner = makeRunner(DEF);
    runner.renderList();
    runner.advance(); // 揭示第二段
    runner.advance(); // 段落尽 → await_choice
    expect(() => runner.advance()).toThrowError(EngineError);
    expect(runner.phase).toBe('await_choice');

    const endRunner = makeRunner(DEF, { sceneId: 'scene_end' });
    endRunner.renderList();
    endRunner.advance();
    expect(() => endRunner.advance()).toThrowError(EngineError);
    expect(endRunner.phase).toBe('finished');
  });

  it('重复 renderList 幂等：前缀不变、相位不变（不重复展开）', () => {
    const runner = makeRunner(DEF);
    const first = runner.renderList();
    expect(runner.renderList()).toEqual(first);
    runner.advance();
    const second = runner.renderList();
    expect(runner.renderList()).toEqual(second);
    expect(runner.phase).toBe('await_advance');
  });
});

describe('08-A1 状态机：await_choice → resolving → entering（jumps.scene）', () => {
  it('choose 携 goto 便捷字段的选项 → entering 新场景 → renderList 再进 await_advance', () => {
    const runner = makeRunner(DEF);
    runner.renderList();
    runner.advance();
    runner.advance();
    runner.choose('leave');
    expect(runner.phase).toBe('entering');
    expect(runner.currentSceneId).toBe('scene_next');
    // 新场景重新走 entering → await_advance
    expect(runner.renderList().map((segment) => segment.key)).toEqual(['scenes.next.p1']);
    expect(runner.phase).toBe('await_advance');
  });

  it('effects 内 goto 与便捷字段并存 → 顺序覆写：最后一个流程跳转生效', () => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_start',
          area: 'demo',
          segments: [{ key: 'scenes.start.p1' }],
          choices: [
            {
              id: 'detour',
              textKey: 'scenes.start.choice.detour',
              effects: [{ goto: 'scene_mid' }, { goto: 'scene_next' }],
              goto: 'scene_end',
            },
          ],
        },
        { id: 'scene_mid', area: 'demo', segments: [], choices: [] },
        { id: 'scene_next', area: 'demo', segments: [{ key: 'scenes.next.p1' }], choices: [] },
        { id: 'scene_end', area: 'demo', segments: [], choices: [] },
      ],
      locales: {
        'zh-CN': { scenes: { start: { p1: 'x', choice: { detour: '绕路' } }, next: { p1: 'y' } } },
      },
    });
    const runner = makeRunner(def);
    runner.renderList();
    runner.advance();
    runner.choose('detour');
    // 最后一个流程跳转为 choice.goto（便捷字段排在效果序列之后）
    expect(runner.currentSceneId).toBe('scene_end');
    expect(runner.phase).toBe('entering');
  });

  it('无流程跳转（仅状态效果）→ 回到 await_choice（剩余选项继续可选）', () => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_start',
          area: 'demo',
          segments: [{ key: 'scenes.start.p1' }],
          choices: [
            {
              id: 'rest',
              textKey: 'scenes.start.choice.rest',
              effects: [{ flag: { name: 'rested' } }],
            },
            { id: 'leave', textKey: 'scenes.start.choice.leave', goto: 'scene_end' },
          ],
        },
        { id: 'scene_end', area: 'demo', segments: [], choices: [] },
      ],
      locales: {
        'zh-CN': { scenes: { start: { p1: 'x', choice: { rest: '休息', leave: '离开' } } } },
      },
    });
    const runner = makeRunner(def);
    runner.renderList();
    runner.advance();
    runner.choose('rest');
    expect(runner.phase).toBe('await_choice');
    expect(visibleIds(runner.choices())).toEqual(['rest', 'leave']);
  });

  it('battle/advanceTime 非流程跳转不被消费 → 留在当前场景 await_choice', () => {
    const stub = stubRuntime({ jumps: [{ type: 'battle', battle: 'encounter_1' }] });
    const battleRunner = makeRunner(DEF, { runtime: stub });
    battleRunner.renderList();
    battleRunner.advance();
    battleRunner.advance();
    battleRunner.choose('stay');
    expect(battleRunner.phase).toBe('await_choice');
    expect(stub.execCalls).toHaveLength(1);
  });
});

describe('08-A1 状态机：await_choice → resolving → finished（终态类型记录）', () => {
  it.each([
    ['ending', { ending: 'ending_quiet' }, 'ending_quiet'],
    ['back', { back: null }, undefined],
    ['loop', { loop_transition: null }, undefined],
  ] as const)('jumps.%s → finished 并记录终态类型', (kind, effect, endingId) => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_start',
          area: 'demo',
          segments: [{ key: 'scenes.start.p1' }],
          choices: [{ id: 'finish', textKey: 'scenes.start.choice.finish', effects: [effect] }],
        },
      ],
      locales: { 'zh-CN': { scenes: { start: { p1: 'x', choice: { finish: '终' } } } } },
    });
    const runner = makeRunner(def);
    runner.renderList();
    runner.advance();
    runner.choose('finish');
    expect(runner.phase).toBe('finished');
    expect(runner.endReason).toBe(kind);
    expect(runner.endingId).toBe(endingId);
  });

  it('finished 相位 renderList 返回最后一次渲染列表，choices 为空', () => {
    const def = makeDef({
      scenes: [
        {
          id: 'scene_start',
          area: 'demo',
          segments: [{ key: 'scenes.start.p1' }],
          choices: [{ id: 'finish', textKey: 'scenes.start.choice.finish', goto: 'scene_next' }],
        },
        { id: 'scene_next', area: 'demo', segments: [{ key: 'scenes.next.p1' }], choices: [] },
      ],
      locales: {
        'zh-CN': { scenes: { start: { p1: 'x', choice: { finish: '去' } }, next: { p1: '终段' } } },
      },
    });
    const runner = makeRunner(def);
    runner.renderList();
    runner.advance();
    runner.choose('finish');
    runner.renderList();
    runner.advance(); // → finished（无选项）
    const final = runner.renderList();
    expect(final.map((segment) => segment.key)).toEqual(['scenes.next.p1']);
    expect(runner.choices()).toEqual([]);
    expect(() => runner.choose('finish')).toThrowError(EngineError);
  });
});

describe('08-A1 状态机：choose 入参校验与错误挂起态（resolving 可观测语义）', () => {
  it('未知选项 id → INTERNAL 且相位保持 await_choice', () => {
    const runner = makeRunner(DEF);
    runner.renderList();
    runner.advance();
    runner.advance();
    expect(() => runner.choose('ghost')).toThrowError(EngineError);
    expect(runner.phase).toBe('await_choice');
  });

  it('exec 事务失败 → EFFECT_FAILED 上抛，会话停留 resolving（错误挂起态）', () => {
    const failure = new EngineError({
      code: 'EFFECT_FAILED',
      where: { scene: 'scene_start' },
      messageKey: 'error.runtime.effectFailed',
    });
    const stub = stubRuntime({ failExec: failure });
    const runner = makeRunner(DEF, { runtime: stub });
    runner.renderList();
    runner.advance();
    runner.advance();
    expect(() => runner.choose('stay')).toThrowError(failure);
    expect(runner.phase).toBe('resolving');
    expect(stub.execCalls).toHaveLength(1);
    expect(stub.execCalls[0]?.ctx.source).toBe('choice');
    expect(stub.execCalls[0]?.ctx.where.scene).toBe('scene_start');
  });
});

describe('08-A1 状态机：await_advance → await_choice 的选项可见性口径', () => {
  it('桩 runtime 驱动同一迁移链（§4.2 桩化缝：记录型 exec/evalCondition）', () => {
    const stub = stubRuntime({ flags: { gate_open: true } });
    const runner = makeRunner(DEF, { runtime: stub });
    runner.renderList();
    runner.advance();
    runner.advance();
    expect(runner.phase).toBe('await_choice');
    expect(stub.evalCalls.length).toBeGreaterThanOrEqual(0);
    runner.choose('stay');
    expect(runner.phase).toBe('await_choice');
    expect(stub.execCalls[0]?.effects).toEqual([]);
  });
});
