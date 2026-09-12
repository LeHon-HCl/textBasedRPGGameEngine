import { describe, expect, it } from 'vitest';
import { EngineError, isEngineError } from '@game/shared';
import type { Rng, SceneDef } from '@game/shared';
import { createRng } from '@game/shared';
import { makeDef, makeRunner, makeRuntime } from './fixtures.js';

/**
 * 叙事宏展开用例（08 任务 B1，设计 §4.2 / FR-NARR-04）：
 * - 宏结构承载于段落键的主语言词典记录值（scene.ts「schema 层先承载最小面」
 *   的对应物，见 macros.ts TSDoc 数据形态裁决）；
 * - first/again 依据 seen.scenes 访问快照；正常会话渲染时写 seen.scenes；
 * - random 按权经注入 Rng 抽取（DD-09）；vars 延迟到渲染时组装；
 * - 形态违例 SCHEMA_INVALID 显性化；plural/select 结构透传 TextResolver。
 */

/** 固定 next() 返回值的确定性 Rng（random 宏权重边界的可断言驱动） */
function fixedRng(roll: number, onRoll?: () => void): Rng {
  const base = createRng(1);
  const next = (): number => {
    onRoll?.();
    return roll;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) =>
      items[
        Math.min(items.length - 1, Math.floor(next() * items.length))
      ] as (typeof items)[number],
    weighted: <T>(entries: readonly { weight: number; item: T }[]): T => {
      const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
      const target = next() * total;
      let cumulative = 0;
      for (const entry of entries) {
        cumulative += entry.weight;
        if (target < cumulative) return entry.item;
      }
      return (entries[entries.length - 1] as { weight: number; item: T }).item;
    },
    chance: (p) => next() < p,
    getState: () => base.getState(),
    setState: (state) => base.setState(state),
    fork: () => base.fork(),
  };
}

function macroScene(segments: SceneDef['segments']): SceneDef {
  return { id: 'scene_macro', area: 'demo', segments, choices: [] };
}

/** 宏夹具词典：段落键 → 记录值（宏结构），分支键 → 字符串文本 */
const MACRO_LOCALES = {
  'zh-CN': {
    scenes: {
      macro: {
        intro: { first: 'scenes.macro.intro_first', again: 'scenes.macro.intro_again' },
        intro_first: '你第一次来。',
        intro_again: '你又来了。',
        mood: {
          if: 'attr.stamina > 10',
          then: 'scenes.macro.mood_high',
          else: 'scenes.macro.mood_low',
        },
        mood_high: '精神不错。',
        mood_low: '有些疲惫。',
        silent_mood: { if: 'attr.stamina > 10', then: 'scenes.macro.mood_high' },
        tale: {
          random: [
            { weight: 1, key: 'scenes.macro.tale_a' },
            { weight: 3, key: 'scenes.macro.tale_b' },
          ],
        },
        tale_a: '版本甲。',
        tale_b: '版本乙。',
        plain: '普通段落。',
        counting: '来了 {visits} 次。',
      },
    },
  },
};

function macroDef(segments: SceneDef['segments']) {
  return makeDef({ scenes: [macroScene(segments)], locales: MACRO_LOCALES });
}

/** 宏场景专用构造（场景 id 固定 scene_macro） */
function macroRunner(
  def: ReturnType<typeof macroDef>,
  spec: Omit<Parameters<typeof makeRunner>[1], 'sceneId'> = {},
) {
  return makeRunner(def, { sceneId: 'scene_macro', ...spec });
}

describe('08-B1 宏：first/again（依据 seen.scenes 访问快照）', () => {
  it('首次访问渲染 first 分支；正常会话渲染时写入 seen.scenes', () => {
    const runtime = makeRuntime();
    const runner = macroRunner(macroDef([{ key: 'scenes.macro.intro' }]), { runtime });
    const segments = runner.renderList();
    expect(segments.map((segment) => segment.key ?? null)).toEqual(['scenes.macro.intro_first']);
    // 写 seen.scenes 的时机 = 正常会话渲染时（§4.2）
    expect(runtime.state.seen.scenes).toEqual(['scene_macro']);
  });

  it('再次进入（seen.scenes 已含场景）渲染 again 分支', () => {
    const runtime = makeRuntime({ flags: {} });
    runtime.markSceneSeen('scene_macro');
    const runner = macroRunner(macroDef([{ key: 'scenes.macro.intro' }]), { runtime });
    expect(runner.renderList().map((segment) => segment.key ?? null)).toEqual([
      'scenes.macro.intro_again',
    ]);
  });

  it('宏决策按访问快照缓存：同一次访问内重复渲染不翻转分支', () => {
    const runner = macroRunner(macroDef([{ key: 'scenes.macro.intro' }]));
    const first = runner.renderList();
    runner.advance();
    const later = runner.renderList();
    expect(later.map((segment) => segment.key ?? null)).toEqual(
      first.map((segment) => segment.key ?? null),
    );
    expect(later[0]?.key).toBe('scenes.macro.intro_first');
  });
});

describe('08-B1 宏：条件文本 if/else', () => {
  it('条件满足渲染 then 分支；不满足渲染 else 分支', () => {
    const segments: SceneDef['segments'] = [{ key: 'scenes.macro.mood' }];
    const high = macroRunner(macroDef(segments), {
      runtime: makeRuntime({ attrs: { stamina: 30 } }),
    });
    expect(high.renderList()[0]?.key).toBe('scenes.macro.mood_high');
    const low = macroRunner(macroDef(segments), {
      runtime: makeRuntime({ attrs: { stamina: 1 } }),
    });
    expect(low.renderList()[0]?.key).toBe('scenes.macro.mood_low');
  });

  it('条件不满足且无 else → 段落不进入渲染列表（段落流缩短）', () => {
    const def = macroDef([{ key: 'scenes.macro.silent_mood' }, { key: 'scenes.macro.plain' }]);
    const runner = macroRunner(def, { runtime: makeRuntime({ attrs: { stamina: 1 } }) });
    const keys = runner.renderList().map((segment) => segment.key ?? null);
    expect(keys).toEqual(['scenes.macro.plain']);
    // 段落流以过滤后的计划为准：一次 advance 即段落尽
    runner.advance();
    expect(runner.phase).toBe('finished');
  });
});

describe('08-B1 宏：random 权重选段（注入 Rng，DD-09）', () => {
  it('权重决定抽取：roll 落在低权重区间时选第一分支', () => {
    const def = macroDef([{ key: 'scenes.macro.tale' }]);
    const runner = macroRunner(def, { runtime: makeRuntime({ rng: fixedRng(0.1) }) });
    expect(runner.renderList()[0]?.key).toBe('scenes.macro.tale_a');
  });

  it('roll 落在高权重分支区间时选第二分支（权重 1:3 → 0.25 边界外）', () => {
    const def = macroDef([{ key: 'scenes.macro.tale' }]);
    const runner = macroRunner(def, { runtime: makeRuntime({ rng: fixedRng(0.5) }) });
    expect(runner.renderList()[0]?.key).toBe('scenes.macro.tale_b');
  });

  it('随机决策按访问快照缓存：重复渲染不重新抽取（回放一致）', () => {
    let calls = 0;
    const rng = fixedRng(0.1, () => {
      calls += 1;
    });
    const def = macroDef([{ key: 'scenes.macro.tale' }]);
    const runner = macroRunner(def, { runtime: makeRuntime({ rng }) });
    const first = runner.renderList()[0]?.key;
    const consumed = calls;
    runner.advance();
    runner.renderList();
    expect(runner.renderList()[0]?.key).toBe(first);
    expect(calls).toBe(consumed); // 不因重复渲染追加随机消耗
  });
});

describe('08-B1 宏：延迟插值（vars 延迟到段落渲染时组装）', () => {
  it('params 函数形式每次渲染重新组装 vars（渲染时反映最新状态）', () => {
    const runtime = makeRuntime();
    const def = macroDef([{ key: 'scenes.macro.counting' }, { key: 'scenes.macro.plain' }]);
    const runner = macroRunner(def, {
      runtime,
      params: () => ({ visits: runtime.state.seen.scenes.length }),
    });
    const first = runner.renderList()[0];
    expect(first?.vars).toEqual({ visits: 1 });
    runtime.markSceneSeen('scene_other');
    runner.advance(); // 揭示第二段，会话仍在 await_advance（渲染前缀继续重建）
    const later = runner.renderList()[0];
    expect(later?.vars).toEqual({ visits: 2 });
  });

  it('params 对象形式 = 参数快照（FR-GAL-01 回想渲染数据面）', () => {
    const def = macroDef([{ key: 'scenes.macro.counting' }]);
    const runner = macroRunner(def, { params: { visits: 7 } });
    expect(runner.renderList()[0]?.vars).toEqual({ visits: 7 });
  });
});

describe('08-B1 宏：形态违例显性化与结构透传', () => {
  it('first/again 缺分支 → SCHEMA_INVALID（renderList 时定位段落键）', () => {
    const def = makeDef({
      scenes: [macroScene([{ key: 'scenes.macro.broken' }])],
      locales: { 'zh-CN': { scenes: { macro: { broken: { first: 'scenes.macro.plain' } } } } },
    });
    const runner = macroRunner(def);
    try {
      runner.renderList();
      throw new Error('unreachable');
    } catch (error) {
      expect(isEngineError(error)).toBe(true);
      expect((error as EngineError).code).toBe('SCHEMA_INVALID');
      expect((error as EngineError).where['key']).toBe('scenes.macro.broken');
    }
  });

  it('判别属性并存（if + first）→ SCHEMA_INVALID（形态歧义）', () => {
    const def = makeDef({
      scenes: [macroScene([{ key: 'scenes.macro.mixed' }])],
      locales: {
        'zh-CN': {
          scenes: {
            macro: {
              mixed: {
                if: 'attr.stamina > 10',
                then: 'scenes.macro.plain',
                first: 'scenes.macro.plain',
                again: 'scenes.macro.plain',
              },
            },
          },
        },
      },
    });
    const runner = macroRunner(def);
    expect(() => runner.renderList()).toThrowError(EngineError);
  });

  it('random 分支缺权重/键 → SCHEMA_INVALID', () => {
    const def = makeDef({
      scenes: [macroScene([{ key: 'scenes.macro.bad_random' }])],
      locales: {
        'zh-CN': { scenes: { macro: { bad_random: { random: [{ key: 'scenes.macro.plain' }] } } } },
      },
    });
    const runner = macroRunner(def);
    try {
      runner.renderList();
      throw new Error('unreachable');
    } catch (error) {
      expect((error as EngineError).code).toBe('SCHEMA_INVALID');
      expect((error as EngineError).where['key']).toBe('scenes.macro.bad_random');
    }
  });

  it('plural/select i18n 结构不是宏：按普通键透传（TextResolver 解释）', () => {
    const def = makeDef({
      scenes: [macroScene([{ key: 'scenes.macro.plural_key' }])],
      locales: {
        'zh-CN': {
          scenes: {
            macro: {
              plural_key: { plural: { one: '一枚。', other: '多枚。' } },
              plain: '普通段落。',
            },
          },
        },
      },
    });
    const runner = macroRunner(def);
    expect(runner.renderList()[0]?.key).toBe('scenes.macro.plural_key');
  });

  it('词典缺失段落键 → 按普通文本键渲染（缺失策略归 TextResolver）', () => {
    const def = macroDef([{ key: 'scenes.macro.unknown_key' }]);
    const runner = macroRunner(def);
    expect(runner.renderList()[0]?.key).toBe('scenes.macro.unknown_key');
  });
});
