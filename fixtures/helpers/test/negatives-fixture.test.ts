import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  findDanglingJumps,
  findDuplicateSceneIds,
  hasBalancedParens,
  isRecord,
  summarizeScene,
  type SceneSummary,
} from '../src/fixture-checks.js';

const NEG_ROOT = 'fixtures/negatives';

function loadNegativePackage(name: string) {
  const root = `${NEG_ROOT}/${name}`;
  const files = readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`);
  const parsed = new Map(
    files.map((file) => [file, parse(readFileSync(file, 'utf8')) as unknown]),
  );
  const sceneFiles = [...parsed.entries()].filter(([path]) => path.includes('/data/scenes/'));
  const scenes: Array<{ path: string; summary: SceneSummary }> = sceneFiles.map(([path, data]) => ({
    path,
    summary: summarizeScene(data),
  }));
  const sceneIds = new Set(scenes.map((scene) => scene.summary.id));
  return { root, parsed, scenes, sceneIds };
}

describe('fixtures/negatives（单一缺陷负例，设计 §3.4 独立测试）', () => {
  it('dangling-ref：跳转指向不存在的场景，且不触发其他缺陷', () => {
    const pkg = loadNegativePackage('dangling-ref');
    const dangling = findDanglingJumps(pkg.sceneIds, pkg.scenes.map((scene) => scene.summary));
    expect(dangling).toEqual([{ sceneId: 'locked_door', target: 'nowhere_hall' }]);
    expect(findDuplicateSceneIds(pkg.scenes.map(({ path, summary }) => ({ path, sceneId: summary.id }))).size).toBe(0);
    for (const expr of pkg.scenes.flatMap((scene) => scene.summary.exprs)) {
      expect(hasBalancedParens(expr)).toBe(true);
    }
  });

  it('dup-id：两个场景文件声明同一 ID checkpoint，且不触发其他缺陷', () => {
    const pkg = loadNegativePackage('dup-id');
    const duplicates = findDuplicateSceneIds(
      pkg.scenes.map(({ path, summary }) => ({ path, sceneId: summary.id })),
    );
    expect([...duplicates.keys()]).toEqual(['checkpoint']);
    expect(duplicates.get('checkpoint')).toHaveLength(2);
    expect(findDanglingJumps(pkg.sceneIds, pkg.scenes.map((scene) => scene.summary))).toEqual([]);
    expect(pkg.sceneIds.size).toBe(1);
  });

  it('bad-expr：showIf 表达式括号不配平，且不触发其他缺陷', () => {
    const pkg = loadNegativePackage('bad-expr');
    const exprs = pkg.scenes.flatMap((scene) => scene.summary.exprs);
    expect(exprs).toEqual(['flag(sealed_gate) && (attr.insight > 5']);
    expect(hasBalancedParens(exprs[0] ?? '')).toBe(false);
    expect(findDanglingJumps(pkg.sceneIds, pkg.scenes.map((scene) => scene.summary))).toEqual([]);
    expect(findDuplicateSceneIds(pkg.scenes.map(({ path, summary }) => ({ path, sceneId: summary.id }))).size).toBe(0);
  });

  it('每个负例的 manifest 结构合法，entryScene 指向包内存在的场景（缺陷保持单一）', () => {
    for (const name of ['dangling-ref', 'dup-id', 'bad-expr'] as const) {
      const pkg = loadNegativePackage(name);
      const manifest = pkg.parsed.get(`${pkg.root}/manifest.yaml`);
      if (!isRecord(manifest)) throw new Error(`负例 ${name} 缺少 manifest 或其不是对象`);
      expect(typeof manifest['gameId']).toBe('string');
      expect(manifest['schemaVersion']).toBe(1);
      const entry = manifest['entryScene'];
      expect(typeof entry === 'string' && pkg.sceneIds.has(entry)).toBe(true);
    }
  });
});
