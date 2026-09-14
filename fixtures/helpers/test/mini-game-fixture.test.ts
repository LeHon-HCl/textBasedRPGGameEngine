import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  collectLocaleKeys,
  declaredNumericAttrs,
  findDanglingJumps,
  findDuplicateSceneIds,
  findMissingTextKeys,
  hasBalancedParens,
  isRecord,
  summarizeScene,
  type SceneSummary,
} from '../src/fixture-checks.js';

const ROOT = 'fixtures/mini-game';

function listFilesRecursive(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`);
}

const yamlFiles = listFilesRecursive(ROOT).filter((file) => file.endsWith('.yaml'));
const parsed = new Map(yamlFiles.map((file) => [file, parse(readFileSync(file, 'utf8')) as unknown]));

const sceneEntries = [...parsed.entries()].filter(([path]) => path.includes('/data/scenes/'));
const localeEntries = [...parsed.entries()].filter(([path]) => path.includes('/locales/zh-CN/'));

const scenes: Array<{ path: string; summary: SceneSummary }> = sceneEntries.map(([path, data]) => ({
  path,
  summary: summarizeScene(data),
}));
const sceneIds = new Set(scenes.map((scene) => scene.summary.id));
const localeKeys = collectLocaleKeys(
  localeEntries.map(([path, data]) => ({ path, data })),
);

describe('fixtures/mini-game v1（公共正例夹具，设计 §1.3 原则 6）', () => {
  it('manifest 具备包加载所需的最小字段，entryScene 指向存在的场景', () => {
    const manifest = parsed.get(`${ROOT}/manifest.yaml`);
    expect(manifest).toMatchObject({
      gameId: 'mini_game',
      mainLang: 'zh-CN',
      langs: ['zh-CN'],
      schemaVersion: 1,
    });
    const entry = isRecord(manifest) ? manifest['entryScene'] : undefined;
    expect(typeof entry === 'string' && sceneIds.has(entry)).toBe(true);
  });

  it('多区域下场景目录名与 scene.area 一致（DD-02）', () => {
    // 规模用下界（夹具随里程碑扩充；M1 收尾为 3 区域 20 场景）
    expect(scenes.length).toBeGreaterThanOrEqual(20);
    const areaDirs = new Set<string>();
    for (const { path, summary } of scenes) {
      const areaDir = path.split('/').at(-2);
      expect(summary.area).toBe(areaDir);
      areaDirs.add(areaDir as string);
    }
    expect([...areaDirs].sort()).toEqual(['hillside', 'old_town', 'riverside']);
  });

  it('场景 ID 无重复（DUP_ID 检测面为空）', () => {
    const duplicates = findDuplicateSceneIds(
      scenes.map(({ path, summary }) => ({ path, sceneId: summary.id })),
    );
    expect(duplicates.size).toBe(0);
  });

  it('全部 choice.goto 跳转目标可解析（DANGLING_REF 检测面为空）', () => {
    expect(findDanglingJumps(sceneIds, scenes.map((scene) => scene.summary))).toEqual([]);
  });

  it('词典 zh-CN 覆盖 5 个场景引用的全部文本键（FR-L10N-02 命名空间镜像）', () => {
    expect(scenes.flatMap((scene) => scene.summary.textKeys).length).toBeGreaterThan(0);
    expect(findMissingTextKeys(localeKeys, scenes.map((scene) => scene.summary))).toEqual([]);
  });

  it('条件表达式括号配平（词法级 sanity；完整语法校验归 02 号模块）', () => {
    const exprs = scenes.flatMap((scene) => scene.summary.exprs);
    expect(exprs.length).toBeGreaterThan(0);
    for (const expr of exprs) expect(hasBalancedParens(expr)).toBe(true);
  });

  it('表达式引用的 attr 已在 attrs.yaml 声明（DD-01 变量域编译期校验的数据前提）', () => {
    const declared = declaredNumericAttrs(parsed.get(`${ROOT}/data/attrs.yaml`));
    expect(declared).toContain('insight');
  });
});
