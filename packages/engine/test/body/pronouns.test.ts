import { describe, expect, it } from 'vitest';
import type { BodyDef } from '@game/shared';
import { createPronounInjector } from '../../src/body/pronouns.js';

/**
 * 14 任务 3：代词注入器（FR-BODY-04，§4.8「pronouns 规则编译为 InterpVars
 * 注入器（{player.they} 等键），resolve 时应用」）。
 *
 * 口径：
 * - `BodyDef.pronouns = {rule:'by_part', part, map}`：按指定部位的**当前值**
 *   取代词形式数组 `[主语, 宾语, 所有格]`；
 * - 注入键：`player.they` / `player.them` / `player.their`（FR-BODY-04 的
 *   `{player.they}` 等键，与 §2.3 插值语法一致）；
 * - 部位值无映射项或未配置 pronouns → 对应键不注入（插值失败保留原文并告警，
 *   §4.1 语义）；引擎不解释代词语义（中立性）。
 */

/** 三部位身体定义 + by_part 代词映射（tail 驱动） */
const BODY_DEFS: BodyDef = {
  parts: {
    build: { values: ['slender', 'sturdy'], default: 'slender' },
    tail: { values: ['none', 'fluffy'], default: 'none' },
  },
  pronouns: {
    rule: 'by_part',
    part: 'tail',
    map: {
      none: ['他', '他', '他的'],
      fluffy: ['她', '她', '她的'],
    },
  },
};

describe('14-3 代词注入器：by_part 映射', () => {
  it('按部位当前值取代词三形式，注入 player.they/them/their', () => {
    const inject = createPronounInjector(BODY_DEFS);
    expect(inject({ tail: 'fluffy' })).toEqual({
      'player.they': '她',
      'player.them': '她',
      'player.their': '她的',
    });
    expect(inject({ tail: 'none' })).toEqual({
      'player.they': '他',
      'player.them': '他',
      'player.their': '他的',
    });
  });

  it('部位值无映射项 → 空注入（插值告警由 resolver 承担）', () => {
    const inject = createPronounInjector(BODY_DEFS);
    expect(inject({ tail: 'unknown_value' })).toEqual({});
  });

  it('部位缺失于当前状态 → 空注入；body 为空对象同理', () => {
    const inject = createPronounInjector(BODY_DEFS);
    expect(inject({})).toEqual({});
  });

  it('未配置 pronouns → 注入器为恒空（游戏不使用代词插值）', () => {
    const inject = createPronounInjector({ parts: BODY_DEFS.parts });
    expect(inject({ tail: 'fluffy' })).toEqual({});
  });

  it('映射数组长度不足 3 → 缺的键不注入（部分形式容错）', () => {
    const partial: BodyDef = {
      parts: BODY_DEFS.parts,
      pronouns: { rule: 'by_part', part: 'tail', map: { fluffy: ['她'] } },
    };
    expect(createPronounInjector(partial)({ tail: 'fluffy' })).toEqual({
      'player.they': '她',
    });
  });

  it('与文本解析器联用：{player.they} 插值走通（FR-BODY-04 端到端）', () => {
    const inject = createPronounInjector(BODY_DEFS);
    const vars = inject({ tail: 'fluffy' });
    // 模拟 resolver 的扁平点路径取值（§4.1 InterpVars 键形态）
    const render = (template: string): string =>
      template.replace(/\{([a-z.]+)\}/g, (raw, key: string) => {
        const value = vars[key];
        return value === undefined ? raw : String(value);
      });
    expect(render('{player.they} 笑了。')).toBe('她 笑了。');
  });
});
