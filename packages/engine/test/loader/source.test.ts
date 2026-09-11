import { describe, expect, it } from 'vitest';
import { isEngineError } from '@game/shared';
import { InMemoryPackageSource } from '../../src/loader/source-memory.js';
import type { PackageSource } from '../../src/loader/types.js';

/**
 * InMemoryPackageSource 用例（06 任务 A1，设计 §3.4 PackageSource 契约）。
 *
 * 断言口径：内存包源是 PackageSource 抽象的规范实现——read/list 按文件树快照
 * 语义工作（路径规范化、目录/缺失 reject、list 直接子项字典序），
 * loadGamePackage 与三宿主（目录 / 静态包 / 编辑器内存）都经同一抽象取数。
 * 与 fixtures/helpers 同名实现的接口兼容性由 fixtures/helpers 侧测试守护。
 */

describe('InMemoryPackageSource（PackageSource 内存实现，06 任务 A1）', () => {
  const source = new InMemoryPackageSource({
    'manifest.yaml': 'gameId: mini-game',
    'data/attrs.yaml': 'numeric: {}',
    'data/scenes/old_town/arrival.yaml': 'id: arrival',
    'locales/zh-CN/ui.yaml': new TextEncoder().encode('title: 示例'),
  });

  it('实现 PackageSource 接口（结构化赋值兼容）', () => {
    const asSource: PackageSource = source;
    expect(asSource.read).toBeTypeOf('function');
    expect(asSource.list).toBeTypeOf('function');
  });

  it('read 返回构造时的字符串内容', async () => {
    await expect(source.read('manifest.yaml')).resolves.toBe('gameId: mini-game');
    await expect(source.read('data/attrs.yaml')).resolves.toBe('numeric: {}');
  });

  it('read 原样返回 Uint8Array 内容（媒体等二进制路径）', async () => {
    const content = await source.read('locales/zh-CN/ui.yaml');
    expect(content).toBeInstanceOf(Uint8Array);
    if (typeof content === 'string') throw new Error('期望二进制内容，得到字符串');
    expect(new TextDecoder().decode(content)).toBe('title: 示例');
  });

  it('read 规范化路径（./ 前缀、反斜杠、尾随斜杠）', async () => {
    await expect(source.read('./manifest.yaml')).resolves.toBe('gameId: mini-game');
    await expect(source.read('data\\attrs.yaml')).resolves.toBe('numeric: {}');
    await expect(source.read('data/attrs.yaml/')).resolves.toBe('numeric: {}');
  });

  it('read 不存在的文件时 reject 并携带 SCHEMA_INVALID 与路径定位', async () => {
    const error = await source.read('data/missing.yaml').then(
      () => null,
      (e: unknown) => e,
    );
    expect(isEngineError(error)).toBe(true);
    if (!isEngineError(error)) return;
    expect(error.code).toBe('SCHEMA_INVALID');
    expect(error.where['path']).toBe('data/missing.yaml');
  });

  it('read 指向目录时 reject', async () => {
    await expect(source.read('data/scenes/old_town')).rejects.toThrow(/目录/);
  });

  it('list 返回直接子项（文件与子目录），按字典序排列', async () => {
    await expect(source.list('')).resolves.toEqual(['data', 'locales', 'manifest.yaml']);
    await expect(source.list('data')).resolves.toEqual(['attrs.yaml', 'scenes']);
    await expect(source.list('data/scenes/old_town')).resolves.toEqual(['arrival.yaml']);
  });

  it('list 接受 ./ 前缀与尾随斜杠', async () => {
    await expect(source.list('./data/')).resolves.toEqual(['attrs.yaml', 'scenes']);
  });

  it('list 不存在的目录时 reject', async () => {
    await expect(source.list('assets')).rejects.toThrow(/目录/);
  });

  it('构造时拒绝空路径与重复路径（构造期显性化）', () => {
    expect(() => new InMemoryPackageSource({ '': 'x' })).toThrow(/路径不能为空/);
    expect(() => new InMemoryPackageSource({ 'a.yaml': '1', './a.yaml': '2' })).toThrow(
      /重复文件路径/,
    );
  });
});
