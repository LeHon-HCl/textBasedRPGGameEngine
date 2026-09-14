import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { manifestSchema } from '../../src/index.js';
import type { Manifest } from '../../src/index.js';

/** 与 fixtures/mini-game/manifest.yaml 同构的最小合法清单 */
const VALID_MANIFEST = {
  gameId: 'mini_game',
  entryScene: 'arrival',
  mainLang: 'zh-CN',
  langs: ['zh-CN'],
  contentTags: ['general'],
  gameVersion: '1.0.0',
  schemaVersion: 1,
  minEngineVersion: '0.1.0',
  redirects: {},
  credits: '引擎公共测试夹具',
} as const;

describe('manifestSchema（设计 §2.4 Manifest，02 任务 A1）', () => {
  it('解析最小合法清单（fixtures/mini-game 同构）并保留字段', () => {
    const parsed = manifestSchema.parse(VALID_MANIFEST);
    expect(parsed.gameId).toBe('mini_game');
    expect(parsed.entryScene).toBe('arrival');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.redirects).toEqual({});
  });

  it('解析带 redirects 与多语言的清单', () => {
    const parsed = manifestSchema.parse({
      ...VALID_MANIFEST,
      langs: ['zh-CN', 'en-US'],
      redirects: { old_gate: 'town_gate' },
    });
    expect(parsed.langs).toEqual(['zh-CN', 'en-US']);
    expect(parsed.redirects).toEqual({ old_gate: 'town_gate' });
  });

  it('contentWarning 可选：缺省无警告页；给出时必须为文本键（FR-CGRD-04，2026-09-14 勘误补齐）', () => {
    expect(manifestSchema.parse(VALID_MANIFEST).contentWarning).toBeUndefined();
    const parsed = manifestSchema.parse({
      ...VALID_MANIFEST,
      contentWarning: 'ui.content_warning',
    });
    expect(parsed.contentWarning).toBe('ui.content_warning');
    expect(() => manifestSchema.parse({ ...VALID_MANIFEST, contentWarning: 42 })).toThrow(
      z.ZodError,
    );
  });

  it('z.infer 产出 TS 类型供四包共用（NFR-12）', () => {
    expectTypeOf<Manifest['gameId']>().toBeString();
    expectTypeOf<Manifest['schemaVersion']>().toBeNumber();
    expectTypeOf<Manifest['langs']>().toEqualTypeOf<string[]>();
    expectTypeOf<Manifest['redirects']>().toEqualTypeOf<Record<string, string>>();
  });

  it('非法样例：mainLang 不在 langs 中（FR-L10N-02 回退语言约束）', () => {
    expect(() => manifestSchema.parse({ ...VALID_MANIFEST, mainLang: 'en-US' })).toThrow(
      z.ZodError,
    );
  });

  it('非法样例：gameVersion / minEngineVersion 非语义化版本（FR-MIGR-01）', () => {
    expect(() => manifestSchema.parse({ ...VALID_MANIFEST, gameVersion: '1.0' })).toThrow(
      z.ZodError,
    );
    expect(() => manifestSchema.parse({ ...VALID_MANIFEST, gameVersion: 'latest' })).toThrow(
      z.ZodError,
    );
    expect(() => manifestSchema.parse({ ...VALID_MANIFEST, minEngineVersion: 'v0.1.0' })).toThrow(
      z.ZodError,
    );
  });

  it('非法样例：schemaVersion 必须为正整数（DD-07 单一 schemaVersion）', () => {
    expect(() => manifestSchema.parse({ ...VALID_MANIFEST, schemaVersion: 0 })).toThrow(z.ZodError);
    expect(() => manifestSchema.parse({ ...VALID_MANIFEST, schemaVersion: 1.5 })).toThrow(
      z.ZodError,
    );
    expect(() => manifestSchema.parse({ ...VALID_MANIFEST, schemaVersion: '1' })).toThrow(
      z.ZodError,
    );
  });

  it('非法样例：gameId 不符合 [a-z][a-z0-9_]*（§2.1 命名规则）', () => {
    expect(() => manifestSchema.parse({ ...VALID_MANIFEST, gameId: 'Mini-Game' })).toThrow(
      z.ZodError,
    );
  });

  it('非法样例：entryScene 非 refId 字符串 / langs 为空', () => {
    expect(() => manifestSchema.parse({ ...VALID_MANIFEST, entryScene: 42 })).toThrow(z.ZodError);
    expect(() => manifestSchema.parse({ ...VALID_MANIFEST, langs: [] })).toThrow(z.ZodError);
  });

  it('非法样例：redirects 键或值不符合 GameId 命名规则', () => {
    expect(() =>
      manifestSchema.parse({ ...VALID_MANIFEST, redirects: { 'Old-Gate': 'town_gate' } }),
    ).toThrow(z.ZodError);
    expect(() =>
      manifestSchema.parse({ ...VALID_MANIFEST, redirects: { old_gate: 'TownGate' } }),
    ).toThrow(z.ZodError);
  });

  it('非法样例：未知顶层键被拒绝（strict，防作者拼写漂移）', () => {
    expect(() => manifestSchema.parse({ ...VALID_MANIFEST, main_lang: 'zh-CN' })).toThrow(
      z.ZodError,
    );
  });

  it('entryScene 携带 refKind=scene 元数据（迁移 redirects 定向改写依赖，§2.1）', () => {
    expect(z.globalRegistry.get(manifestSchema.shape.entryScene)).toMatchObject({
      refKind: 'scene',
    });
  });
});
