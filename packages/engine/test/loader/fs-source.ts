import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGamePackage } from '../../src/loader/pipeline.js';
import type { GameDefinition, PackageSource } from '../../src/loader/types.js';

/**
 * 06 号模块 C 组端到端用例的目录包源（设计 §3.4 三宿主之「目录」宿主）：
 * 直接以仓库内 fixtures/ 目录为包根，验证管线对真实文件树的消费。
 * 仅测试使用（engine 源码保持无 Node API 依赖）。
 */
export class DirectoryPackageSource implements PackageSource {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async read(path: string): Promise<string> {
    return readFileSync(join(this.#root, ...path.split('/')), 'utf8');
  }

  async list(dir: string): Promise<string[]> {
    const target = dir === '' ? this.#root : join(this.#root, ...dir.split('/'));
    return readdirSync(target, { withFileTypes: true })
      .map((entry) => entry.name)
      .sort();
  }
}

/** 仓库内 fixtures/ 根（vitest 以仓库根为工作目录） */
export const FIXTURES_ROOT = 'fixtures';

/** 加载 fixtures/ 下的一个游戏包目录（相对 fixtures/ 根，如 'mini-game'） */
export async function loadFixturePackage(relativeRoot: string): Promise<GameDefinition> {
  return loadGamePackage(new DirectoryPackageSource(join(FIXTURES_ROOT, relativeRoot)));
}
