import type { GameId } from '@game/shared';
import type { Diagnostic, PackageDomains } from './types.js';

/**
 * 地点 → 入口场景的导航解析（FR-XPLR-02「世界地图与导航」；2026-09-15 新增）。
 *
 * 背景（用户实测问题 1c）：数据模型里「地点」与「场景」原本没有映射边，地图点击
 * 只能更新高亮与推进时间，**无法把叙事导航到目标地点**。本模块把映射在加载期
 * 解析定型，运行期只做查表（NFR-02 无运行期推断开销）。
 *
 * 解析规则（设计提案 §3，已获人类批准）：
 * 1. **显式优先**：`location.entryScene` 声明即采用（其存在性/同域性由 crossRef
 *    的 refKind 悬空检查 + 本模块的区域/事件场景校验双重守护）；
 * 2. **缺省推导**：未声明时，取「`scene.area == 本区域` ∧ 非事件场景（id 非
 *    `ev_` 前缀 ∧ 不在 `events[].scene` 集内）∧ 非入口场景自身之外」的场景集；
 *    恰好 1 个 → 采用；0 个 → error（无数可去）；≥2 个 → error（歧义，须显式声明）；
 * 3. **显式声明校验**（三项，均 error 级）：
 *    - 目标场景必须存在（crossRef 已覆盖；此处防御性跳过缺失）；
 *    - 目标场景的 `area` 必须等于该 location 所在区域（跨区域应由叙事 goto/事件承载）；
 *    - 目标场景不得是事件场景（事件以子会话进入，§4.2；地图导航会破坏挂起语义）。
 *
 * 事件场景判定：`events[].scene` 集 ∪ `ev_` 前缀（后者覆盖「已写场景但尚未挂事件」
 * 的中间态——夹具的运行期实测表明这类场景同样是子会话语义，不该被地图直连）。
 */

/** 导航解析产物：`<area>/<location>` → 入口场景 id */
export type LocationEntryMap = ReadonlyMap<string, GameId>;

/** 导航映射的键构造（宿主/测试共用同一口径） */
export function locationEntryKey(area: GameId, location: GameId): string {
  return `${area}/${location}`;
}

/** 事件场景 id 前缀（§4.2 子会话场景约定，M1 夹具沿用） */
const EVENT_SCENE_PREFIX = 'ev_';

/** 解析地点导航映射；返回映射与诊断（error 级由管线统一阻断） */
export function resolveLocationEntries(domains: PackageDomains): {
  readonly entries: LocationEntryMap;
  readonly diagnostics: readonly Diagnostic[];
} {
  const entries = new Map<string, GameId>();
  const diagnostics: Diagnostic[] = [];

  const eventScenes = new Set<GameId>(domains.events.map((event) => event.scene));
  const isEventScene = (sceneId: GameId): boolean =>
    eventScenes.has(sceneId) || sceneId.startsWith(EVENT_SCENE_PREFIX);

  // 区域 → 属于该区域的普通（非事件）场景 id 集（缺省推导的数据源）
  const plainScenesByArea = new Map<GameId, GameId[]>();
  for (const scene of domains.scenes.values()) {
    if (isEventScene(scene.def.id)) continue;
    const bucket = plainScenesByArea.get(scene.def.area) ?? [];
    bucket.push(scene.def.id);
    plainScenesByArea.set(scene.def.area, bucket);
  }

  for (const area of domains.areas.values()) {
    for (const [locationId, location] of Object.entries(area.locations)) {
      const key = locationEntryKey(area.id, locationId);
      const explicit = location.entryScene;

      if (explicit !== undefined) {
        const target = domains.scenes.get(explicit);
        if (target === undefined) continue; // 悬空引用由 crossRef 报 DANGLING_REF
        if (isEventScene(explicit)) {
          diagnostics.push({
            severity: 'error',
            code: 'SCHEMA_INVALID',
            where: {
              phase: 'resolveNavigation',
              rule: 'entry-scene-is-event',
              area: area.id,
              location: locationId,
              scene: explicit,
              detail: `地点 '${area.id}/${locationId}' 的 entryScene '${explicit}' 是事件场景（子会话），不能作为地图导航目标`,
              messageKey: 'error.loader.entrySceneIsEvent',
            },
          });
          continue;
        }
        if (target.def.area !== area.id) {
          diagnostics.push({
            severity: 'error',
            code: 'SCHEMA_INVALID',
            where: {
              phase: 'resolveNavigation',
              rule: 'entry-scene-cross-area',
              area: area.id,
              location: locationId,
              scene: explicit,
              detail: `地点 '${area.id}/${locationId}' 的 entryScene '${explicit}' 属于区域 '${target.def.area}'（跨区域导航不允许；跨区域应由叙事 goto/事件承载）`,
              messageKey: 'error.loader.entrySceneCrossArea',
            },
          });
          continue;
        }
        entries.set(key, explicit);
        continue;
      }

      // 缺省推导：本区域普通场景中恰有一个时采用
      const candidates = plainScenesByArea.get(area.id) ?? [];
      if (candidates.length === 1) {
        entries.set(key, candidates[0] as GameId);
        continue;
      }
      diagnostics.push({
        severity: 'error',
        code: 'SCHEMA_INVALID',
        where: {
          phase: 'resolveNavigation',
          rule: 'entry-scene-unresolved',
          area: area.id,
          location: locationId,
          candidates: candidates.join(','),
          detail:
            candidates.length === 0
              ? `地点 '${area.id}/${locationId}' 所属区域没有任何普通场景，无法导航（请检查区域-场景归属）`
              : `地点 '${area.id}/${locationId}' 无法自动推导入口场景（本区域有 ${candidates.length} 个候选：${candidates.join(', ')}），请显式声明 entryScene`,
          messageKey: 'error.loader.entrySceneUnresolved',
        },
      });
    }
  }

  return { entries, diagnostics };
}
