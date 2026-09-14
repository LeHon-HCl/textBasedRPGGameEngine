import { describe, expect, it } from 'vitest';
import { loadFixturePackage } from './fs-source.js';

/**
 * mini-game 端到端加载用例（06 任务 C2，设计 §3.4「fixtures/mini-game 为
 * 正例」/ §1.3 原则 6「夹具游戏包」）。
 *
 * 断言口径：仓库公共夹具 fixtures/mini-game/ 经真实目录包源走完七步管线，
 * 全绿加载（diagnostics 为空——全部文本键可解析、无悬空引用、无目录不一致），
 * 产物的索引内容逐项断言：DD-02 场景聚合数、PoolIndex（byScope / dirtyMap /
 * mutexGroups / questRefs / achievementRefs）、exprCache、语言包键数（C 组
 * 端到端与 §4.4 / §4.5 消费方的契约锚点）。
 *
 * **规模断言的写法**（M1 收尾确立）：夹具是**持续扩充的公共正例**，因此规模类断言
 * 一律用**下界 + 结构锚点**（`toBeGreaterThanOrEqual` + 关键成员存在性），不锁定
 * 精确总数——否则每次内容扩充都要回头改测试（负资产，见 develop.md 约束 2 的
 * 「测试为防缺陷而写」）。精确断言只用于**语义不变量**（如某事件的引用集合、
 * 互斥组成员），它们不随内容增长而变化。
 */

describe('fixtures/mini-game 端到端加载（06 任务 C2）', () => {
  it('全绿加载：零诊断、零脚本注入下注册表为内置冻结集', async () => {
    const definition = await loadFixturePackage('mini-game');
    expect(definition.diagnostics).toEqual([]);
    expect(definition.manifest.gameId).toBe('mini_game');
    expect(definition.manifest.mainLang).toBe('zh-CN');
    expect(definition.manifest.schemaVersion).toBe(1);
    expect(Object.keys(definition.locales)).toEqual(['zh-CN']);
    expect(definition.functionRegistry.size).toBe(20);
    expect(definition.effectRegistry.frozen).toBe(true);
    expect(definition.effectRegistry.ids()).toContain('goto');
    expect(definition.redirects).toEqual({});
    expect(definition.mediaCatalog.size).toBe(0);
    expect(definition.mediaCatalog.resolve('anything')).toBeNull();
  });

  it('DD-02 场景聚合：多区域多场景，CompiledScene 携带源文件路径', async () => {
    const definition = await loadFixturePackage('mini-game');
    // M1 收尾后夹具扩为 3 区域（old_town/riverside/hillside）；断言用下界口径，
    // 内容继续扩充（M2+）时不必回改（口径见文件头「断言口径」）。
    expect(definition.areas.size).toBeGreaterThanOrEqual(3);
    expect([...definition.areas.keys()].sort()).toEqual(['hillside', 'old_town', 'riverside']);
    const oldTown = definition.areas.get('old_town');
    expect(oldTown && [...Object.keys(oldTown.locations)].sort()).toEqual(['gate', 'market']);
    expect(definition.scenes.size).toBeGreaterThanOrEqual(20);
    // 入口落点与既有场景仍在（聚合结果的结构锚点）
    for (const id of [
      'arrival',
      'market_street',
      'town_gate',
      'riverside_ferry',
      'hillside_trailhead',
    ]) {
      expect(definition.scenes.has(id)).toBe(true);
    }
    const arrival = definition.scenes.get('arrival');
    expect(arrival?.file).toBe('data/scenes/old_town/arrival.yaml');
    expect(arrival?.def.choices.map((choice) => choice.id)).toEqual(['go_market', 'go_gate']);
    // entryScene 指向聚合后的场景
    expect(definition.scenes.has(definition.manifest.entryScene)).toBe(true);
  });

  it('poolIndex：byScope 事件池、dirtyMap 脏标记、mutexGroups 互斥组（§4.4）', async () => {
    const definition = await loadFixturePackage('mini-game');
    // 事件池规模（下界）与既有锚点事件
    expect(definition.events.length).toBeGreaterThanOrEqual(10);
    const eventIds = definition.events.map((event) => event.id);
    expect(eventIds).toContain('ev_wall_whisper');
    expect(eventIds).toContain('ev_market_rumor');
    // byScope：作用域键覆盖三区域（含区域通配 'hillside/*'）
    const scopeKeys = [...definition.poolIndex.byScope.keys()].sort();
    expect(scopeKeys).toContain('old_town/gate');
    expect(scopeKeys).toContain('old_town/market');
    expect(scopeKeys).toContain('riverside/ferry');
    expect(scopeKeys).toContain('hillside/*');
    // 既有锚点的精确成员关系（结构语义，不随内容扩充变化）
    expect(definition.poolIndex.byScope.get('old_town/gate')?.map((e) => e.id)).toContain(
      'ev_wall_whisper',
    );
    expect(definition.poolIndex.dirtyMap.get('flag.wall_rubbing_taken')).toEqual(
      new Set(['ev_wall_whisper']),
    );
    expect(definition.poolIndex.dirtyMap.get('npc.old_guard.met')).toEqual(
      new Set(['ev_wall_whisper']),
    );
    expect(definition.poolIndex.dirtyMap.get('flag.heard_rumor')).toEqual(
      new Set(['ev_market_rumor']),
    );
    // 互斥组：wall_line 仅含 ev_wall_whisper（其余事件无互斥约束）
    expect(definition.poolIndex.mutexGroups.get('wall_line')).toEqual(['ev_wall_whisper']);
  });

  it('refs 反查表：任务与成就条件注册（§4.5 与事件系统同一机制）', async () => {
    const definition = await loadFixturePackage('mini-game');
    const { questRefs, achievementRefs } = definition.poolIndex;
    // wall_rubbing 的四个条件引用（结构锚点；hillside_survey 另注册自己的引用）
    expect(questRefs.get('flag.heard_rumor')).toEqual(new Set(['wall_rubbing']));
    expect(questRefs.get('flag.wall_rubbing_taken')).toEqual(new Set(['wall_rubbing']));
    expect(questRefs.get('npc.old_guard.talked')).toEqual(new Set(['wall_rubbing']));
    expect(questRefs.get('time.day')).toEqual(new Set(['wall_rubbing', 'hillside_survey']));
    expect(achievementRefs.get('flag.heard_rumor')).toEqual(new Set(['first_rumor']));
    expect(achievementRefs.get('attr.insight')).toEqual(new Set(['sharp_eye']));
  });

  it('exprCache：全包表达式按原文编译入缓存（refs 抽取供增量求值）', async () => {
    const definition = await loadFixturePackage('mini-game');
    expect(definition.exprCache.size).toBeGreaterThan(0);
    const whisper = definition.exprCache.get('!flag.wall_rubbing_taken && npc.old_guard.met');
    expect(whisper?.refs.map((ref) => ref.path).sort()).toEqual([
      'flag.wall_rubbing_taken',
      'npc.old_guard.met',
    ]);
    // 商店买价的带默认值条件表达式同样入缓存（FR-ECON-02 动态定价）
    expect(definition.exprCache.has('faction.town >= 10 ? 8 : 10')).toBe(true);
    // 区域地点解锁条件入缓存（FR-XPLR-02）
    expect(definition.exprCache.has('attr.insight >= 2')).toBe(true);
  });

  it('locales：主语言包命名空间镜像展开，键级 Map 覆盖全部引用键（FR-L10N-02）', async () => {
    const definition = await loadFixturePackage('mini-game');
    const zhCN = definition.locales['zh-CN'];
    expect(zhCN?.lang).toBe('zh-CN');
    // 键数随内容扩充增长：断言下界 + 结构锚点（不锁定精确总数）
    expect(zhCN?.keys.size).toBeGreaterThanOrEqual(45);
    expect(zhCN?.keys.get('scenes.arrival.open')).toBe(
      '暮雨初歇，你踏上旧镇的石板路，灯笼在雾里晕出一片暖黄。',
    );
    expect(zhCN?.keys.has('scenes.arrival.choice.go_market')).toBe(true);
    expect(zhCN?.keys.has('quests.wall_rubbing.obj_inspect')).toBe(true);
    expect(zhCN?.keys.has('tags.general.name')).toBe(true);
    // M1 收尾新增区域与任务线的键同样在册
    expect(zhCN?.keys.has('areas.riverside.name')).toBe(true);
    expect(zhCN?.keys.has('areas.hillside.name')).toBe(true);
    expect(zhCN?.keys.has('quests.hillside_survey.obj_quarry')).toBe(true);
  });
});
