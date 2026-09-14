import { describe, expect, it } from 'vitest';
import type { ContentTagsDef, SceneDef } from '@game/shared';
import { ContentFilter } from '../../src/content/index.js';
import { makeDef, makeRunner, makeRuntime, visibleIds } from '../narrative/fixtures.js';

/**
 * 谓词矩阵（22 任务 8，设计 §5.8「独立测试：谓词矩阵（标签组合×三类应用点）+
 * 占位键回退」）。
 *
 * 矩阵维度：
 * - 标签组合：无标签 / 空标签 / 单标签命中 / 单标签不命中 / 多标签部分命中 /
 *   disabledTags 为空；
 * - 三应用点：事件池（eventAdmissible）、段落渲染（renderList）、选项（choices）；
 * - 占位回退：配置占位键（替换）/ 未配置（跳过）。
 *
 * 单一判定源不变式：三应用点对同一标签组合必须给出一致结论（§5.8「全部经
 * ContentFilter 单点」）。
 */

const TAGS: ContentTagsDef = {
  tags: [
    { id: 'tag_horror', nameKey: 'tags.horror.name', defaultOn: true },
    { id: 'tag_romance', nameKey: 'tags.romance.name', defaultOn: true },
  ],
};

const PLACEHOLDER = 'content.filtered.placeholder';

interface MatrixCase {
  readonly name: string;
  readonly tags: readonly string[] | undefined;
  readonly disabled: readonly string[];
  /** 期望「放行」= true；屏蔽 = false */
  readonly passes: boolean;
}

const CASES: readonly MatrixCase[] = [
  { name: '无标签（undefined）', tags: undefined, disabled: ['tag_horror'], passes: true },
  { name: '空标签数组', tags: [], disabled: ['tag_horror'], passes: true },
  { name: '单标签命中禁用', tags: ['tag_horror'], disabled: ['tag_horror'], passes: false },
  { name: '单标签未命中禁用', tags: ['tag_romance'], disabled: ['tag_horror'], passes: true },
  {
    name: '多标签部分命中',
    tags: ['tag_romance', 'tag_horror'],
    disabled: ['tag_horror'],
    passes: false,
  },
  { name: 'disabledTags 为空', tags: ['tag_horror'], disabled: [], passes: true },
];

/** 以矩阵行构造场景与过滤器（三应用点共用同一场景标签/选项标签） */
function build(row: MatrixCase, placeholderKey?: string) {
  const scene: SceneDef = {
    id: 'scene_start',
    area: 'demo',
    segments: [{ key: 'scenes.start.p1' }],
    choices: [
      {
        id: 'tagged',
        textKey: 'scenes.start.choice.tagged',
        ...(row.tags === undefined ? {} : { tags: [...row.tags] }),
      },
      { id: 'plain', textKey: 'scenes.start.choice.plain' },
    ],
    ...(row.tags === undefined ? {} : { tags: [...row.tags] }),
  };
  const filter = new ContentFilter(
    TAGS,
    { disabledTags: row.disabled },
    placeholderKey === undefined ? {} : { placeholderKey },
  );
  const def = makeDef({ scenes: [scene] });
  const runner = makeRunner(def, {
    runtime: makeRuntime({ disabledTags: row.disabled }),
    contentFilter: filter,
  });
  return { filter, runner, scene };
}

describe('22-8 谓词矩阵：passes × eventAdmissible 一致性', () => {
  it.each(CASES)('$name → passes=$passes 且事件池同结论', (row) => {
    const { filter } = build(row);
    expect(filter.passes(row.tags)).toBe(row.passes);
    expect(
      filter.eventAdmissible({ tags: row.tags === undefined ? undefined : [...row.tags] }),
    ).toBe(row.passes);
  });
});

describe('22-8 谓词矩阵：段落渲染（占位键配置 → 替换 / 未配置 → 跳过）', () => {
  it.each(CASES)('$name → 配置占位键时按放行/替换', (row) => {
    const { runner } = build(row, PLACEHOLDER);
    const textKey = runner.renderList().find((segment) => segment.kind === 'text')?.key ?? null;
    expect(textKey).toBe(row.passes ? 'scenes.start.p1' : PLACEHOLDER);
  });

  it.each(CASES)('$name → 未配置占位键时按放行/跳过', (row) => {
    const { runner } = build(row);
    const textKey = runner.renderList().find((segment) => segment.kind === 'text')?.key ?? null;
    expect(textKey).toBe(row.passes ? 'scenes.start.p1' : null);
  });
});

describe('22-8 谓词矩阵：选项过滤与段落同结论', () => {
  it.each(CASES)('$name → 命中标签的选项按同一结论隐藏/可见', (row) => {
    const { runner } = build(row);
    runner.renderList();
    runner.advance();
    const visible = visibleIds(runner.choices());
    expect(visible).toEqual(row.passes ? ['tagged', 'plain'] : ['plain']);
  });
});

describe('22-8 谓词矩阵：占位键回退契约', () => {
  it.each(CASES.filter((row) => !row.passes))(
    '$name：屏蔽 + 有键 → 键；屏蔽 + 无键 → null',
    (row) => {
      const withKey = build(row, PLACEHOLDER).filter;
      const noKey = build(row).filter;
      expect(withKey.placeholderFor(row.tags)).toBe(PLACEHOLDER);
      expect(noKey.placeholderFor(row.tags)).toBe(null);
    },
  );

  it.each(CASES.filter((row) => row.passes))('$name：放行 → placeholderFor 恒 null', (row) => {
    expect(build(row, PLACEHOLDER).filter.placeholderFor(row.tags)).toBe(null);
  });
});
