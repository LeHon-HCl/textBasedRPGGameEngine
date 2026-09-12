import { EngineError } from '@game/shared';
import type { CompiledExpr, GameId } from '@game/shared';
import { computeAssetId } from './collect.js';
import { compileExprIntoCache, DeferredXFunctionRegistry } from './compile-expr.js';
import { collectXFunctionCalls } from './walk.js';
import type { Diagnostic, PackageSource, ValidatedPackage } from './types.js';
import type { CompiledArtifacts, MediaAsset, MediaCatalog, PoolIndex } from './types.js';
import type { PackageInventory } from './walk.js';

/**
 * 管线步骤 5 compile（设计 §3.4「表达式编译入缓存；事件池索引；成就/任务
 * refs 反查表；媒体目录」，NFR-02 增量求值的数据基础）。
 *
 * - exprCache：盘点出的全部表达式按原文编译入缓存（同一原文一次编译）；
 *   编译失败 → error 级 EXPR_COMPILE（where.expr 原文 + from 定位，DD-01）；
 * - PoolIndex（§4.4）：byScope key = `${area}/${location ?? '*'}`；dirtyMap 由
 *   事件 trigger.require 的编译期 refs 构建；mutexGroups 记录互斥组成员；
 *   questRefs/achievementRefs 由任务与成就条件的 refs 构建反查表（§4.5 与
 *   事件系统同一机制，不轮询）；
 * - mediaCatalog（DD-05）：assets/ 文件按 assetId（collect 约定）登记
 *   path/hash/type；hash 为加载期 FNV-1a 指纹（非密码学，发布完整性由
 *   exporter sha256 承担，§9.1）；
 * - x.* 函数引用登记：表达式对 `x.<script>.<name>` 的调用在步骤 5 仅登记，
 *   存在性/纯度核对归 scripts 步骤（FR-SCR-04，管线次序 §3.4 步骤 5→6）。
 */

/** FNV-1a 32 位指纹（确定性、跨平台；用途限于加载期变更检测） */
function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function assetType(path: string): MediaAsset['type'] {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return 'image';
  if (['mp3', 'ogg', 'wav', 'm4a', 'flac'].includes(ext)) return 'audio';
  return 'other';
}

async function buildMediaCatalog(
  source: PackageSource,
  assetFiles: readonly string[],
): Promise<MediaCatalog> {
  const entries = new Map<string, MediaAsset>();
  for (const path of assetFiles) {
    const raw = await source.read(path).then(
      (content) => content,
      () => null,
    );
    if (raw === null) continue; // 读取失败容忍：存在性已由 collect 聚合与 crossRef 核对
    const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
    entries.set(computeAssetId(path), {
      path,
      hash: fnv1a(bytes),
      preload: false,
      type: assetType(path),
    });
  }
  // 目录在登记完成后返回：resolve 为纯查询，运行期不再有装载竞态
  return {
    resolve(assetId: string): MediaAsset | null {
      return entries.get(assetId) ?? null;
    },
    get size(): number {
      return entries.size;
    },
  };
}

/** 事件池索引与任务/成就 refs 反查表构建（§4.4 / §4.5） */
export function buildPoolIndex(
  domains: ValidatedPackage['domains'],
  exprCache: ReadonlyMap<string, CompiledExpr>,
): PoolIndex {
  const byScope = new Map<string, ValidatedPackage['domains']['events'][number][]>();
  const dirtyMap = new Map<string, Set<GameId>>();
  const mutexGroups = new Map<string, GameId[]>();
  const questRefs = new Map<string, Set<GameId>>();
  const achievementRefs = new Map<string, Set<GameId>>();

  const addRef = (table: Map<string, Set<GameId>>, path: string, id: GameId): void => {
    const ids = table.get(path) ?? new Set<GameId>();
    ids.add(id);
    table.set(path, ids);
  };

  const refsOf = (source: string): readonly { root: string; path: string }[] => {
    return exprCache.get(source)?.refs ?? [];
  };

  for (const event of domains.events) {
    const scopeKey = `${event.where.area}/${event.where.location ?? '*'}`;
    const bucket = byScope.get(scopeKey) ?? [];
    bucket.push(event);
    byScope.set(scopeKey, bucket);
    if ('require' in event.trigger && event.trigger.require !== undefined) {
      for (const ref of refsOf(event.trigger.require)) addRef(dirtyMap, ref.path, event.id);
    }
    if (event.mutexGroup !== undefined) {
      const members = mutexGroups.get(event.mutexGroup) ?? [];
      if (!members.includes(event.id)) members.push(event.id);
      mutexGroups.set(event.mutexGroup, members);
    }
  }

  for (const quest of domains.quests.values()) {
    const sources: string[] = [];
    if (quest.acceptIf !== undefined) sources.push(quest.acceptIf);
    if (quest.failWhen !== undefined) sources.push(quest.failWhen);
    for (const stage of quest.stages) sources.push(stage.completeWhen);
    for (const source of sources) {
      for (const ref of refsOf(source)) addRef(questRefs, ref.path, quest.id);
    }
  }

  for (const achievement of domains.achievements.values()) {
    const sources = [achievement.when];
    if (achievement.progressExpr !== undefined) sources.push(achievement.progressExpr);
    for (const source of sources) {
      for (const ref of refsOf(source)) addRef(achievementRefs, ref.path, achievement.id);
    }
  }

  return { byScope, dirtyMap, mutexGroups, questRefs, achievementRefs };
}

function exprCompileDiagnostic(source: string, from: string, error: unknown): Diagnostic {
  const messageKey = error instanceof EngineError ? error.messageKey : 'error.loader.exprCompile';
  const detail = error instanceof Error ? error.message : '表达式编译失败';
  const originalWhere = error instanceof EngineError ? { ...error.where } : {};
  delete originalWhere['messageKey'];
  return {
    severity: 'error',
    code: 'EXPR_COMPILE',
    where: {
      ...originalWhere,
      expr: source,
      from,
      phase: 'compile',
      messageKey,
      detail,
    },
  };
}

/** compile 步骤产物（含步骤内诊断；error 级由管线统一阻断） */
export interface CompileStepResult {
  readonly artifacts: CompiledArtifacts;
  readonly diagnostics: readonly Diagnostic[];
  /** compile 期使用的延迟注册表（scripts 步骤核对 x.* 引用后废弃） */
  readonly deferredRegistry: DeferredXFunctionRegistry;
}

/** compile 步骤入口：表达式缓存 → 池索引 → 媒体目录（管线步骤 5） */
export async function compilePackage(
  source: PackageSource,
  validated: ValidatedPackage,
  inventory: PackageInventory,
): Promise<CompileStepResult> {
  const diagnostics: Diagnostic[] = [];
  const exprCache = new Map<string, CompiledExpr>();
  const deferredRegistry = new DeferredXFunctionRegistry();

  for (const site of inventory.exprs) {
    try {
      compileExprIntoCache(site, deferredRegistry, exprCache);
    } catch (error) {
      diagnostics.push(exprCompileDiagnostic(site.source, site.dataPath, error));
      continue;
    }
    // x.* 引用登记：requirePure 位点（事件 require）标记缓存敏感（DD-01）
    const compiled = exprCache.get(site.source);
    if (compiled !== undefined) {
      const xCalls = new Set<string>();
      collectXFunctionCalls(compiled.ast, xCalls);
      if (site.requirePure) {
        for (const name of xCalls) deferredRegistry.markRequireSensitive(name);
      }
    }
  }

  const poolIndex = buildPoolIndex(validated.domains, exprCache);
  const mediaCatalog = await buildMediaCatalog(source, validated.parsed.collected.assetFiles);

  return {
    artifacts: {
      exprCache,
      poolIndex,
      mediaCatalog,
      xFunctionRefs: deferredRegistry.referenced(),
    },
    diagnostics: diagnostics.sort((a, b) =>
      (a.where['from'] ?? '') < (b.where['from'] ?? '') ? -1 : 1,
    ),
    deferredRegistry,
  };
}
