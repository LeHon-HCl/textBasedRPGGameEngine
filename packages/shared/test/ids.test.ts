import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { refId } from '../src/index.js';
import type { ExprSource, GameId, Lang, RefKind, TextKey } from '../src/index.js';

/** RefKind 设计 §2.1 的全集（顺序即设计文档声明顺序） */
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
];

describe('ID 与基础类型（设计 §2.1）', () => {
  it('基础类型为 string 别名（类型层约束）', () => {
    expectTypeOf<GameId>().toBeString();
    expectTypeOf<TextKey>().toBeString();
    expectTypeOf<Lang>().toBeString();
    expectTypeOf<ExprSource>().toBeString();
  });

  it('RefKind 为设计 §2.1 的 10 值联合', () => {
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
