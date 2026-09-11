import { EngineError } from '@game/shared';
import type { PackageSource } from './types.js';

/**
 * InMemoryPackageSource —— {@link PackageSource} 的内存实现（设计 §3.4 独立测试）。
 *
 * 以 `Record<path, content>` 构造，无需真实文件系统（设计 §1.3「夹具游戏包 /
 * 持久化倒置」在包输入侧的对应物），供加载管线测试与编辑器内存宿主复用。
 * fixtures/helpers 下的同名实现保持同一形状（接口兼容性由双方测试守护）。
 *
 * 语义约定：
 * - 构造与查询时规范化路径（统一反斜杠、去 `./` 前缀、去尾随 `/`）；
 * - read：文件存在 → 原样返回构造内容；指向目录或不存在 → reject（EngineError）；
 * - list：目录存在 → 返回直接子项的相对路径（文件与子目录，字典序）；包根传 `''`；
 *   目录不存在 → reject。
 */

function normalizePath(input: string): string {
  let path = input.replaceAll('\\', '/');
  while (path.startsWith('./')) path = path.slice(2);
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

function sourceError(detail: string, where: Record<string, string>): EngineError {
  return new EngineError({
    code: 'SCHEMA_INVALID',
    where: { ...where, detail },
    messageKey: 'error.loader.sourceUnavailable',
  });
}

export class InMemoryPackageSource implements PackageSource {
  readonly #files: ReadonlyMap<string, Uint8Array | string>;
  readonly #dirs: ReadonlySet<string>;

  constructor(files: Record<string, Uint8Array | string>) {
    const normalized = new Map<string, Uint8Array | string>();
    for (const [rawPath, content] of Object.entries(files)) {
      const path = normalizePath(rawPath);
      if (path.length === 0) {
        throw sourceError('InMemoryPackageSource: 文件路径不能为空', {});
      }
      if (normalized.has(path)) {
        throw sourceError('InMemoryPackageSource: 重复文件路径', { path });
      }
      normalized.set(path, content);
    }
    this.#files = normalized;

    const dirs = new Set<string>();
    for (const path of normalized.keys()) {
      const segments = path.split('/');
      segments.pop();
      let current = '';
      for (const segment of segments) {
        current = current.length === 0 ? segment : `${current}/${segment}`;
        dirs.add(current);
      }
    }
    this.#dirs = dirs;
  }

  async read(path: string): Promise<Uint8Array | string> {
    const key = normalizePath(path);
    if (this.#dirs.has(key)) {
      throw sourceError('包源目标为目录，不能作为文件读取', { path: key });
    }
    const content = this.#files.get(key);
    if (content === undefined) {
      throw sourceError('包源中不存在该文件', { path: key });
    }
    return content;
  }

  async list(dir: string): Promise<string[]> {
    const key = normalizePath(dir);
    if (key.length > 0 && !this.#dirs.has(key)) {
      throw sourceError('包源中不存在该目录', { dir: key });
    }
    const prefix = key.length === 0 ? '' : `${key}/`;
    const children = new Set<string>();
    for (const path of this.#files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      children.add(slash === -1 ? rest : rest.slice(0, slash));
    }
    return [...children].sort();
  }
}
