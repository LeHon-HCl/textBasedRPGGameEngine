import { parse } from 'yaml';
import { PACKAGE_PATHS } from './collect.js';
import { mergeDiagnostics } from './diagnostics.js';
import type { CollectedPackage, Diagnostic, ParsedPackage, PackageSource } from './types.js';

/**
 * 管线步骤 2 parse（设计 §3.4「YAML → 对象」）。
 *
 * - 读取并解析 collect 聚合出的数据文件与语言包文件（场景文档已在聚合期
 *   解析，直接复用 sceneDocs——每文件在整条管线中恰好解析一次）；
 * - `.json` 文件 JSON.parse（预编译静态包直读，§9.1），`.yaml`/`.yml` 走
 *   YAML 解析；
 * - manifest.yaml 缺失 → error（SCHEMA_INVALID）；文件读取失败或解析失败 →
 *   error（SCHEMA_INVALID，where.file 定位）。
 */

function parseDoc(raw: string, path: string): unknown {
  if (path.endsWith('.json')) {
    return JSON.parse(raw) as unknown;
  }
  return parse(raw) as unknown;
}

function decode(raw: Uint8Array | string): string {
  return typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
}

/** parse 步骤入口：补齐场景之外全部文件的解析文档缓存 */
export async function parsePackage(
  source: PackageSource,
  collected: CollectedPackage,
): Promise<ParsedPackage> {
  const diagnostics: Diagnostic[] = [];
  const docs = new Map<string, unknown>(collected.sceneDocs);

  const readAndParse = async (path: string): Promise<void> => {
    if (docs.has(path)) return; // collect 聚合期已解析
    let raw: Uint8Array | string;
    try {
      raw = await source.read(path);
    } catch {
      diagnostics.push({
        severity: 'error',
        code: 'SCHEMA_INVALID',
        where: {
          file: path,
          phase: 'parse',
          messageKey: 'error.loader.fileUnreadable',
          detail: '包文件读取失败',
        },
      });
      return;
    }
    try {
      docs.set(path, parseDoc(decode(raw), path));
    } catch (cause) {
      diagnostics.push({
        severity: 'error',
        code: 'SCHEMA_INVALID',
        where: {
          file: path,
          phase: 'parse',
          messageKey: 'error.loader.fileUnparseable',
          detail: `包文件解析失败：${cause instanceof Error ? cause.message : String(cause)}`,
        },
      });
    }
  };

  // manifest 为包根必需文件（§2.4）；缺失即 error（单一诊断，不做读取失败双报）
  if (!docs.has(PACKAGE_PATHS.manifest)) {
    try {
      const raw = await source.read(PACKAGE_PATHS.manifest);
      docs.set(PACKAGE_PATHS.manifest, parseDoc(decode(raw), PACKAGE_PATHS.manifest));
    } catch {
      diagnostics.push({
        severity: 'error',
        code: 'SCHEMA_INVALID',
        where: {
          file: PACKAGE_PATHS.manifest,
          phase: 'parse',
          messageKey: 'error.loader.manifestMissing',
          detail: '包根缺少 manifest.yaml',
        },
      });
    }
  }

  for (const path of collected.dataFiles) {
    await readAndParse(path);
  }
  for (const files of collected.localeFiles.values()) {
    for (const path of files) {
      await readAndParse(path);
    }
  }

  return {
    collected,
    docs,
    diagnostics: mergeDiagnostics(collected.diagnostics, diagnostics),
  };
}
