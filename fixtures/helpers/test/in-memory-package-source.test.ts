import { describe, expect, it } from 'vitest';
import { InMemoryPackageSource } from '../src/in-memory-package-source.js';

describe('InMemoryPackageSource（设计 §3.4 PackageSource 的内存实现）', () => {
  const source = new InMemoryPackageSource({
    'manifest.yaml': 'gameId: mini-game',
    'data/attrs.yaml': 'numeric: {}',
    'data/scenes/old_town/arrival.yaml': 'id: arrival',
    'locales/zh-CN/ui.yaml': new TextEncoder().encode('title: 示例'),
  });

  it('read 返回构造时的字符串内容', async () => {
    await expect(source.read('manifest.yaml')).resolves.toBe('gameId: mini-game');
    await expect(source.read('data/attrs.yaml')).resolves.toBe('numeric: {}');
  });

  it('read 原样返回 Uint8Array 内容', async () => {
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

  it('read 不存在的文件时 reject，并在错误信息中指明路径', async () => {
    await expect(source.read('data/missing.yaml')).rejects.toThrow(/missing\.yaml/);
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
    await expect(source.list('nope')).rejects.toThrow(/nope/);
  });

  it('构造时拒绝重复路径与空路径', () => {
    expect(() => new InMemoryPackageSource({ 'a.yaml': '1', './a.yaml': '2' })).toThrow(
      /重复/,
    );
    expect(() => new InMemoryPackageSource({ '': 'x' })).toThrow(/空/);
  });

  it('read 与 list 均为异步（返回 Promise），满足 PackageSource 形状', () => {
    expect(source.read('manifest.yaml')).toBeInstanceOf(Promise);
    expect(source.list('')).toBeInstanceOf(Promise);
  });
});
