/**
 * InMemoryPackageSource —— 设计 §3.4 PackageSource 抽象的内存实现。
 *
 * 接口签名照搬 detail-design §3.4（engine/src/loader/types.ts）：
 *   read(path): Promise<Uint8Array | string>
 *   list(dir):  Promise<string[]>
 * 以 Record<path, content> 构造，无需真实文件系统（设计 §1.3「持久化倒置 /
 * 夹具游戏包」在包加载侧的对应物，供 03/06 号模块的加载器测试复用）。
 * 06 号模块将在 engine 中提供正式实现与 EngineError 错误体系；此处错误
 * 以普通 Error 表达，仅服务夹具场景。
 *
 * 语义约定：
 * - 路径一律正斜杠、以包根为基准；构造与查询时规范化（去 ./ 前缀、
 *   去尾随 /、统一反斜杠）；
 * - read：文件存在 → 原样返回构造内容；指向目录或不存在 → reject；
 * - list：目录存在 → 返回直接子项的相对路径（文件与子目录，字典序）；
 *   根目录传 ''；目录不存在 → reject。
 */

export interface PackageSource {
  read(path: string): Promise<Uint8Array | string>;
  list(dir: string): Promise<string[]>;
}

function normalizePath(input: string): string {
  let path = input.replaceAll('\\', '/');
  while (path.startsWith('./')) path = path.slice(2);
  path = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return path;
}

export class InMemoryPackageSource implements PackageSource {
  readonly #files: ReadonlyMap<string, Uint8Array | string>;
  readonly #dirs: ReadonlySet<string>;

  constructor(files: Record<string, Uint8Array | string>) {
    const normalized = new Map<string, Uint8Array | string>();
    for (const [rawPath, content] of Object.entries(files)) {
      const path = normalizePath(rawPath);
      if (path.length === 0) {
        throw new Error('InMemoryPackageSource: 文件路径不能为空');
      }
      if (normalized.has(path)) {
        throw new Error(`InMemoryPackageSource: 重复文件路径 ${path}`);
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
      throw new Error(`InMemoryPackageSource: ${key} 是目录，不能作为文件读取`);
    }
    const content = this.#files.get(key);
    if (content === undefined) {
      throw new Error(`InMemoryPackageSource: 文件不存在 ${key}`);
    }
    return content;
  }

  async list(dir: string): Promise<string[]> {
    const key = normalizePath(dir);
    if (key.length > 0 && !this.#dirs.has(key)) {
      throw new Error(`InMemoryPackageSource: 目录不存在 ${key}`);
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
