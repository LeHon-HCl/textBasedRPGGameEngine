import { describe, expect, it } from 'vitest';
import { InMemoryPackageSource, loadGamePackage } from '../../src/index.js';
import { resolveLocationEntries } from '../../src/loader/navigation.js';
import type { PackageDomains } from '../../src/loader/types.js';

/**
 * 地点→入口场景导航解析（FR-XPLR-02；2026-09-15 新增，用户实测问题 1c）。
 *
 * 覆盖：显式声明的三项校验（事件场景 / 跨区域 / 悬空）、缺省推导（唯一候选 /
 * 零候选 / 多候选歧义），以及夹具的端到端映射结果。
 */

/** 构造最小 domains（只填本模块读取的字段） */
function domainsOf(input: {
  scenes: Record<string, { area: string }>;
  areas: Record<string, Record<string, { entryScene?: string }>>;
  eventScenes?: string[];
}): PackageDomains {
  return {
    scenes: new Map(Object.entries(input.scenes).map(([id, def]) => [id, { def: { id, ...def } }])),
    areas: new Map(
      Object.entries(input.areas).map(([id, locations]) => [
        id,
        { id, nameKey: `areas.${id}.name`, locations },
      ]),
    ),
    events: (input.eventScenes ?? []).map((scene) => ({ id: `ev_${scene}`, scene })),
  } as unknown as PackageDomains;
}

describe('resolveLocationEntries：显式声明校验', () => {
  it('合法声明：同区域普通场景 → 采用', () => {
    const { entries, diagnostics } = resolveLocationEntries(
      domainsOf({
        scenes: { town_gate: { area: 'old_town' } },
        areas: { old_town: { gate: { entryScene: 'town_gate' } } },
      }),
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(entries.get('old_town/gate')).toBe('town_gate');
  });

  it('跨区域声明 → error（跨区域应由叙事 goto/事件承载）', () => {
    const { entries, diagnostics } = resolveLocationEntries(
      domainsOf({
        scenes: { riverside_ferry: { area: 'riverside' }, town_gate: { area: 'old_town' } },
        areas: { old_town: { gate: { entryScene: 'riverside_ferry' } } },
      }),
    );
    const error = diagnostics.find((d) => d.where['rule'] === 'entry-scene-cross-area');
    expect(error, '应报 entry-scene-cross-area').toBeDefined();
    expect(entries.has('old_town/gate')).toBe(false);
  });

  it('指向事件场景 → error（事件是子会话，地图不得直连）', () => {
    const { entries, diagnostics } = resolveLocationEntries(
      domainsOf({
        scenes: { ev_wall_whisper_scene: { area: 'old_town' }, town_gate: { area: 'old_town' } },
        areas: { old_town: { gate: { entryScene: 'ev_wall_whisper_scene' } } },
        eventScenes: ['ev_wall_whisper_scene'],
      }),
    );
    const error = diagnostics.find((d) => d.where['rule'] === 'entry-scene-is-event');
    expect(error, '应报 entry-scene-is-event').toBeDefined();
    expect(entries.has('old_town/gate')).toBe(false);
  });

  it('ev_ 前缀但未挂事件的场景同样视为事件场景 → error', () => {
    const { diagnostics } = resolveLocationEntries(
      domainsOf({
        scenes: { ev_orphan_scene: { area: 'old_town' }, town_gate: { area: 'old_town' } },
        areas: { old_town: { gate: { entryScene: 'ev_orphan_scene' } } },
      }),
    );
    expect(diagnostics.some((d) => d.where['rule'] === 'entry-scene-is-event')).toBe(true);
  });
});

describe('resolveLocationEntries：缺省推导', () => {
  it('本区域恰一个普通场景 → 自动采用（含事件场景不计入候选）', () => {
    const { entries, diagnostics } = resolveLocationEntries(
      domainsOf({
        scenes: { riverside_ferry: { area: 'riverside' }, ev_x_scene: { area: 'riverside' } },
        areas: { riverside: { ferry: {} } },
        eventScenes: ['ev_x_scene'],
      }),
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(entries.get('riverside/ferry')).toBe('riverside_ferry');
  });

  it('本区域零普通场景 → error（区域无场景可去）', () => {
    const { diagnostics } = resolveLocationEntries(
      domainsOf({ scenes: {}, areas: { empty_area: { spot: {} } } }),
    );
    const error = diagnostics.find((d) => d.where['rule'] === 'entry-scene-unresolved');
    expect(error, '应报 entry-scene-unresolved').toBeDefined();
    expect(error?.where['candidates']).toBe('');
  });

  it('本区域多个普通场景 → error（歧义，要求显式声明）', () => {
    const { entries, diagnostics } = resolveLocationEntries(
      domainsOf({
        scenes: { a_scene: { area: 'x' }, b_scene: { area: 'x' } },
        areas: { x: { spot: {} } },
      }),
    );
    const error = diagnostics.find((d) => d.where['rule'] === 'entry-scene-unresolved');
    expect(error, '应报 entry-scene-unresolved').toBeDefined();
    expect(error?.where['candidates']).toContain('a_scene');
    expect(entries.has('x/spot')).toBe(false);
  });
});

describe('resolveLocationEntries：mini-game 夹具端到端', () => {
  it('夹具每个地点都解析出入口场景（无 error 诊断）', async () => {
    // 经真实加载管线（readdir 夹具目录）——与运行时同一份数据
    const { readdirSync, readFileSync } = await import('node:fs');
    const ROOT = 'fixtures/mini-game';
    const files: Record<string, string> = {};
    for (const entry of readdirSync(ROOT, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) continue;
      const abs = `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`;
      files[abs.slice(abs.indexOf(ROOT) + ROOT.length + 1)] = readFileSync(abs, 'utf8');
    }
    const definition = await loadGamePackage(new InMemoryPackageSource(files));
    // 7 个地点全部有映射（3 区域：old_town 2 + riverside 4 + hillside 3 = 9）
    expect(definition.locationEntries.size).toBe(9);
    expect(definition.locationEntries.get('old_town/market')).toBe('market_street');
    expect(definition.locationEntries.get('old_town/gate')).toBe('town_gate');
    expect(definition.locationEntries.get('riverside/ferry')).toBe('riverside_ferry');
    expect(definition.locationEntries.get('hillside/quarry')).toBe('hillside_quarry');
    // 无 error 级诊断（warning 允许）
    expect(definition.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});
