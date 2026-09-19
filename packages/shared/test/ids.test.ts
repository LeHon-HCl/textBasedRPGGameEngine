import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { GAME_ID_PATTERN, isValidGameId, refId } from '../src/index.js';
import type { ExprSource, GameId, Lang, RefKind, TextKey } from '../src/index.js';

/**
 * RefKind 设计 §2.1 的全集（顺序即设计文档声明顺序）。
 * enemy/encounter 为 16 号战斗域回填新增（设计 §5.2 引用了 EncounterDef 但
 * §2.1/§2.4 清单漏列，回填见 shared/schema/battle.ts）。
 */
const ALL_REF_KINDS: readonly RefKind[] = [
  'scene',
  'item',
  'npc',
  'quest',
  'achievement',
  'faction',
  'area',
  'location',
  'media',
  'text',
  'enemy',
  'encounter',
];

describe('ID 与基础类型（设计 §2.1）', () => {
  it('基础类型为 string 别名（类型层约束）', () => {
    expectTypeOf<GameId>().toBeString();
    expectTypeOf<TextKey>().toBeString();
    expectTypeOf<Lang>().toBeString();
    expectTypeOf<ExprSource>().toBeString();
  });

  it('RefKind 为设计 §2.1 的 12 值联合（含 16 号战斗域回填的 enemy/encounter）', () => {
    expectTypeOf<RefKind>().toEqualTypeOf<
      | 'scene'
      | 'item'
      | 'npc'
      | 'quest'
      | 'achievement'
      | 'faction'
      | 'area'
      | 'location'
      | 'media'
      | 'text'
      | 'enemy'
      | 'encounter'
    >();
  });
});

describe('refId(kind) Zod 辅助器（设计 §2.1）', () => {
  it('解析合法引用字符串并原样返回', () => {
    expect(refId('scene').parse('forest_entrance')).toBe('forest_entrance');
    expect(refId('item').parse('potion_health')).toBe('potion_health');
  });

  it('拒绝非字符串输入（zod 校验语义）', () => {
    expect(() => refId('npc').parse(42)).toThrow(z.ZodError);
    expect(() => refId('npc').parse(null)).toThrow(z.ZodError);
  });

  it('refKind 元数据登记进 zod globalRegistry，供加载器建索引与迁移器定向改写', () => {
    expect(z.globalRegistry.get(refId('scene'))).toMatchObject({ refKind: 'scene' });
  });

  it('全部 10 种 RefKind 均能携带各自元数据', () => {
    for (const kind of ALL_REF_KINDS) {
      const schema = refId(kind);
      expect(schema.parse('some_id')).toBe('some_id');
      expect(z.globalRegistry.get(schema)).toMatchObject({ refKind: kind });
    }
  });
});

describe('isValidGameId 命名规则校验（设计 §2.1：[a-z][a-z0-9_]*）', () => {
  it.each(['a', 'z', 'x9', 'scene_01', 'npc_raven_greet', 'a1_b2_c3', 'x9_'])(
    '合法样例：%s',
    (id) => {
      expect(isValidGameId(id)).toBe(true);
    },
  );

  it.each([
    '', // 空串：缺少首字母
    'A', // 大写开头
    'Scene', // 混入大写
    '_lead', // 下划线开头
    '1abc', // 数字开头
    '9_lives', // 数字开头
    'scene-01', // 连字符不在字符集内
    'a b', // 空格不在字符集内
    'a.B', // 点号不在字符集内
    'ab!', // 符号不在字符集内
    '场景', // 非 ASCII
    'café', // 非 ASCII 字符
  ])('非法样例：%s', (id) => {
    expect(isValidGameId(id)).toBe(false);
  });

  it('GAME_ID_PATTERN 锚定整串且无 g 标志（避免 lastIndex 状态化误判）', () => {
    expect(GAME_ID_PATTERN.source).toBe('^[a-z][a-z0-9_]*$');
    expect(GAME_ID_PATTERN.flags).not.toContain('g');
  });
});
