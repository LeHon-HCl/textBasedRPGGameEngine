import { parse } from 'yaml';
import type { Lang } from '@game/shared';
import type { CollectedPackage, Diagnostic, PackageSource, SceneFileInfo } from './types.js';

/**
 * 管线步骤 1 collect（设计 §3.4「PackageSource 列目录」，DD-02 场景聚合）。
 *
 * - 遍历包源目录树：data/ 数据文件、data/scenes/ 场景文件（DD-02：
 *   `data/scenes/<areaId>/<sceneId>.yaml` 一场景一文件）、locales/ 语言包、
 *   assets/ 媒体资产（DD-05）；
 * - 场景文件在聚合时读取并解析（提取 id/area 供目录一致性比对），解析产物
 *   进入 {@link CollectedPackage.sceneDocs} 供 validate/crossRef 复用——每个
 *   文件在整条管线中恰好解析一次；
 * - `scene.area` 字段与所在目录不一致 → warning（不阻断，容错手写数据，§3.4）；
 *   场景文件不在 `<areaId>/` 层级下 → warning 并忽略该文件；
 * - 缺省目录（data/locales/assets 任一不存在）均为合法形态（对应空域），
 *   不产生诊断；域内文件的存在性与结构由 parse/validate 步骤裁决。
 */

/** 包内固定路径约定（设计 §3.4 / §10.4 游戏包结构） */
export const PACKAGE_PATHS = {
  manifest: 'manifest.yaml',
  data: 'data',
  scenes: 'data/scenes',
  locales: 'locales',
  assets: 'assets',
} as const;

/** 场景文件扩展名（DD-02 yaml 为源形态；json 供预编译静态包直读，§9.1） */
const DATA_EXTENSIONS = new Set(['yaml', 'yml', 'json']);

/** 场景路径匹配：data/scenes/<areaDir>/<name>.<ext>（恰好三层） */
const SCENE_PATH_PATTERN = /^data\/scenes\/([^/]+)\/[^/]+\.([^.]+)$/;

/**
 * 资产 id 约定（DD-05 mediaCatalog 的键）：assets/ 下路径去前缀与扩展名，
 * 保留目录层级（如 assets/media/cg_rain.png → 'media/cg_rain'）。
 */
export function computeAssetId(assetPath: string): string {
  const withoutPrefix = assetPath.startsWith('assets/')
    ? assetPath.slice('assets/'.length)
    : assetPath;
  const dot = withoutPrefix.lastIndexOf('.');
  return dot > withoutPrefix.lastIndexOf('/') ? withoutPrefix.slice(0, dot) : withoutPrefix;
}

/** 递归列目录：返回 dir 下全部文件路径（字典序）；目录不存在视为空 */
async function walkFiles(source: PackageSource, dir: string): Promise<string[]> {
  let children: string[];
  try {
    children = await source.list(dir);
  } catch {
    return []; // 可选目录缺省 = 空域（ collect 契约，见模块 TSDoc）
  }
  const files: string[] = [];
  for (const child of children) {
    const path = dir.length === 0 ? child : `${dir}/${child}`;
    const nested = await source.list(path).then(
      () => true,
      () => false,
    );
    if (nested) {
      files.push(...(await walkFiles(source, path)));
    } else {
      files.push(path);
    }
  }
  return files.sort();
}

function parseDoc(raw: string, path: string): unknown {
  if (path.endsWith('.json')) {
    return JSON.parse(raw) as unknown;
  }
  return parse(raw) as unknown;
}

/**
 * collect 步骤入口：聚合目录并产出场景文档与诊断。
 * 场景之外的文件读取与解析归 parse 步骤（步骤 2）。
 */
export async function collectPackage(source: PackageSource): Promise<CollectedPackage> {
  const diagnostics: Diagnostic[] = [];
  const sceneFiles: SceneFileInfo[] = [];
  const sceneDocs = new Map<string, unknown>();

  const dataFiles = await walkFiles(source, PACKAGE_PATHS.data);
  for (const path of dataFiles) {
    const match = SCENE_PATH_PATTERN.exec(path);
    if (match === null) {
      if (path.startsWith(`${PACKAGE_PATHS.scenes}/`) && DATA_EXTENSIONS.has(extensionOf(path))) {
        diagnostics.push({
          severity: 'warning',
          code: 'SCHEMA_INVALID',
          where: {
            file: path,
            phase: 'collect',
            messageKey: 'error.loader.sceneOutsideAreaDir',
            detail: '场景文件必须位于 data/scenes/<areaId>/ 目录层级下（DD-02），已忽略',
          },
        });
      }
      continue;
    }
    const [, areaDir = '', ext = ''] = match;
    if (!DATA_EXTENSIONS.has(ext.toLowerCase())) continue; // 非数据文件（如 README）不聚合、不诊断
    sceneFiles.push({ path, areaDir });
  }

  // 场景文件聚合期解析：提取 id/area 与目录比对（DD-02 一致性 warning）
  for (const { path, areaDir } of sceneFiles) {
    let raw: Uint8Array | string;
    try {
      raw = await source.read(path);
    } catch {
      diagnostics.push({
        severity: 'error',
        code: 'SCHEMA_INVALID',
        where: {
          file: path,
          phase: 'collect',
          messageKey: 'error.loader.sceneUnreadable',
          detail: '场景文件读取失败',
        },
      });
      continue;
    }
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    let doc: unknown;
    try {
      doc = parseDoc(text, path);
    } catch (cause) {
      diagnostics.push({
        severity: 'error',
        code: 'SCHEMA_INVALID',
        where: {
          file: path,
          phase: 'collect',
          messageKey: 'error.loader.sceneUnparseable',
          detail: `场景文件解析失败：${describeCause(cause)}`,
        },
      });
      continue;
    }
    sceneDocs.set(path, doc);
    const area = isRecord(doc) && typeof doc['area'] === 'string' ? doc['area'] : undefined;
    if (area !== undefined && area !== areaDir) {
      diagnostics.push({
        severity: 'warning',
        code: 'SCHEMA_INVALID',
        where: {
          file: path,
          scene: isRecord(doc) && typeof doc['id'] === 'string' ? doc['id'] : '',
          area,
          dir: areaDir,
          phase: 'collect',
          messageKey: 'error.loader.sceneAreaMismatch',
          detail: 'scene.area 字段与所在目录不一致（DD-02，容错不阻断）',
        },
      });
    }
  }

  // 媒体资产（DD-05）：文件类型不限（png/mp3/…），assetId 由路径推导
  const assetFiles = await walkFiles(source, PACKAGE_PATHS.assets);
  const mediaIds = assetFiles.map(computeAssetId);

  const localeFiles = new Map<Lang, string[]>();
  const langDirs = await source.list(PACKAGE_PATHS.locales).then(
    (children) => children,
    () => [],
  );
  for (const lang of langDirs) {
    const files = (await walkFiles(source, `${PACKAGE_PATHS.locales}/${lang}`)).filter((path) =>
      DATA_EXTENSIONS.has(extensionOf(path)),
    );
    localeFiles.set(lang, files);
  }

  return {
    sceneFiles,
    sceneDocs,
    dataFiles,
    assetFiles,
    mediaIds,
    localeFiles,
    diagnostics: diagnostics.sort(compareDiagnostics),
  };
}

/** 诊断排序（确定性输出，供测试与编辑器复现）：文件 → messageKey */
function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  const fileA = a.where['file'] ?? '';
  const fileB = b.where['file'] ?? '';
  if (fileA !== fileB) return fileA < fileB ? -1 : 1;
  const keyA = a.where['messageKey'] ?? '';
  const keyB = b.where['messageKey'] ?? '';
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  return JSON.stringify(a.where) < JSON.stringify(b.where) ? -1 : 1;
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') ? path.slice(dot + 1).toLowerCase() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
