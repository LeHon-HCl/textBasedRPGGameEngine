import type { GameId, Lang } from '@game/shared';
import type { Diagnostic, LocalePack, PackageDomains } from './types.js';
import type { PackageInventory, RefSite } from './walk.js';

/**
 * 管线步骤 4 crossRef（设计 §3.4「refKind 元数据驱动的悬空引用检查」，
 * FR-EDTR-15/编辑器校验中心复用同一规则集，DD-12）。
 *
 * - 引用注册表由已校验域数据构建：scene/area/location/item/npc/quest/
 *   achievement/faction 实体集、媒体资产 id 集（collect 聚合，DD-05）与
 *   主语言词典键集（FR-L10N-02）；
 * - 悬空判定：实体引用缺失 → error 级 DANGLING_REF（内容图断裂，不可运行）；
 *   媒体引用缺失 → warning（FR-MEDIA-06 容错语义：运行期占位渲染）；
 *   文本键在主语言词典缺失 → warning（§3.4「主语言缺失键 → warning」，
 *   运行期回退显示原始键并告警，FR-L10N-06）；
 * - location 引用带作用域：事件 `where.location` 限定在其 `where.area` 的
 *   地点集内；NPC 日程等无区域上下文的 location 引用对全包地点集核对；
 * - 诊断按 (kind, value) 去重（同一悬空目标多处引用合并为一条，from 取首个）。
 */

/** 引用核对注册表（crossRef 步骤的核对数据源） */
export interface RefRegistries {
  readonly scenes: ReadonlySet<GameId>;
  readonly areas: ReadonlySet<GameId>;
  readonly items: ReadonlySet<GameId>;
  readonly npcs: ReadonlySet<GameId>;
  readonly quests: ReadonlySet<GameId>;
  readonly achievements: ReadonlySet<GameId>;
  readonly factions: ReadonlySet<GameId>;
  /** 区域 → 地点 id 集（location 作用域核对） */
  readonly locationsByArea: ReadonlyMap<GameId, ReadonlySet<string>>;
  readonly locationsAll: ReadonlySet<string>;
  /** 战斗域（16 号回填）：敌人 id 集（encounter.enemies 引用的核对集） */
  readonly enemies: ReadonlySet<string>;
  /** 遭遇 id 集（battle 指令 encounter 参数的核对集，约束 8 加载期完整性） */
  readonly encounters: ReadonlySet<string>;
  readonly mediaIds: ReadonlySet<string>;
  readonly mainLangKeys: ReadonlySet<string>;
}

/** 从已校验域数据与 collect/validate 产物构建核对注册表 */
export function buildRefRegistries(
  domains: PackageDomains,
  mediaIds: readonly string[],
  locales: ReadonlyMap<Lang, LocalePack>,
): RefRegistries {
  const locationsByArea = new Map<GameId, Set<string>>();
  const locationsAll = new Set<string>();
  for (const area of domains.areas.values()) {
    const locationIds = new Set(Object.keys(area.locations));
    locationsByArea.set(area.id, locationIds);
    for (const locationId of locationIds) locationsAll.add(locationId);
  }
  const enemies = new Set(domains.enemies.keys());
  const encounters = new Set(domains.encounters.keys());
  const mainLangPack =
    domains.manifest !== undefined ? locales.get(domains.manifest.mainLang) : undefined;
  return {
    scenes: new Set(domains.scenes.keys()),
    areas: new Set(domains.areas.keys()),
    items: new Set(domains.items.keys()),
    npcs: new Set(domains.npcs.keys()),
    quests: new Set(domains.quests.keys()),
    achievements: new Set(domains.achievements.keys()),
    factions: new Set(domains.factions.keys()),
    enemies,
    encounters,
    locationsByArea,
    locationsAll,
    mediaIds: new Set(mediaIds),
    mainLangKeys: new Set(mainLangPack?.keys.keys() ?? []),
  };
}

/** 引用存在性判定（location 带区域作用域） */
function refExists(site: RefSite, registries: RefRegistries): boolean {
  switch (site.kind) {
    case 'scene':
      return registries.scenes.has(site.value);
    case 'area':
      return registries.areas.has(site.value);
    case 'item':
      return registries.items.has(site.value);
    case 'npc':
      return registries.npcs.has(site.value);
    case 'quest':
      return registries.quests.has(site.value);
    case 'achievement':
      return registries.achievements.has(site.value);
    case 'faction':
      return registries.factions.has(site.value);
    case 'enemy':
      return registries.enemies.has(site.value);
    case 'encounter':
      return registries.encounters.has(site.value);
    case 'media':
      return registries.mediaIds.has(site.value);
    case 'text':
      return registries.mainLangKeys.has(site.value);
    case 'location': {
      if (site.scopeArea !== undefined) {
        return registries.locationsByArea.get(site.scopeArea)?.has(site.value) === true;
      }
      return registries.locationsAll.has(site.value);
    }
    default:
      return true; // 未知 RefKind 不做核对（向前兼容 shared 新增 kind）
  }
}

/** 实体引用缺失 = error；媒体/文本缺失 = warning（容错语义，见模块 TSDoc） */
function severityFor(kind: RefSite['kind']): Diagnostic['severity'] {
  return kind === 'media' || kind === 'text' ? 'warning' : 'error';
}

function danglingDiagnostic(site: RefSite): Diagnostic {
  return {
    severity: severityFor(site.kind),
    code: 'DANGLING_REF',
    where: {
      kind: site.kind,
      ref: site.value,
      from: site.dataPath,
      ...(site.scopeArea !== undefined ? { scopeArea: site.scopeArea } : {}),
      phase: 'crossRef',
      messageKey: 'error.loader.danglingRef',
      detail:
        site.kind === 'text'
          ? `文本键 '${site.value}' 在主语言词典中缺失`
          : `${site.kind} 引用 '${site.value}' 不存在`,
    },
  };
}

/** crossRef 步骤入口：盘点引用逐个核对，悬空 → 诊断（按 kind+value 去重） */
export function crossRefCheck(
  inventory: PackageInventory,
  registries: RefRegistries,
): Diagnostic[] {
  const dangling = new Map<string, Diagnostic>();
  for (const site of inventory.refs) {
    if (refExists(site, registries)) continue;
    const key = `${site.kind}|${site.value}`;
    if (!dangling.has(key)) {
      dangling.set(key, danglingDiagnostic(site));
    }
  }
  return [...dangling.values()].sort(compareRef);
}

function compareRef(a: Diagnostic, b: Diagnostic): number {
  const keyA = a.where['ref'] ?? '';
  const keyB = b.where['ref'] ?? '';
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  const kindA = a.where['kind'] ?? '';
  const kindB = b.where['kind'] ?? '';
  if (kindA !== kindB) return kindA < kindB ? -1 : 1;
  return 0;
}
