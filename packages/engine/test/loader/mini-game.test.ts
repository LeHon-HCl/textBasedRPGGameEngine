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

  it('DD-02 场景聚合：1 区域 5 场景，CompiledScene 携带源文件路径', async () => {
    const definition = await loadFixturePackage('mini-game');
    expect(definition.areas.size).toBe(1);
    const oldTown = definition.areas.get('old_town');
    expect(oldTown && [...Object.keys(oldTown.locations)].sort()).toEqual(['gate', 'market']);
    expect(definition.scenes.size).toBe(5);
    expect([...definition.scenes.keys()].sort()).toEqual([
      'arrival',
      'ev_market_rumor_scene',
      'ev_wall_whisper_scene',
      'market_street',
      'town_gate',
    ]);
    const arrival = definition.scenes.get('arrival');
    expect(arrival?.file).toBe('data/scenes/old_town/arrival.yaml');
    expect(arrival?.def.choices.map((choice) => choice.id)).toEqual(['go_market', 'go_gate']);
    // entryScene 指向聚合后的场景
    expect(definition.scenes.has(definition.manifest.entryScene)).toBe(true);
  });

  it('poolIndex：byScope 事件池、dirtyMap 脏标记、mutexGroups 互斥组（§4.4）', async () => {
    const definition = await loadFixturePackage('mini-game');
    expect(definition.events.map((event) => event.id).sort()).toEqual([
      'ev_market_rumor',
      'ev_wall_whisper',
    ]);
    expect([...definition.poolIndex.byScope.keys()].sort()).toEqual([
      'old_town/gate',
      'old_town/market',
    ]);
    expect(definition.poolIndex.byScope.get('old_town/gate')?.map((e) => e.id)).toEqual([
      'ev_wall_whisper',
    ]);
    expect(definition.poolIndex.byScope.get('old_town/market')?.map((e) => e.id)).toEqual([
      'ev_market_rumor',
    ]);
    expect(definition.poolIndex.dirtyMap.get('flag.wall_rubbing_taken')).toEqual(
      new Set(['ev_wall_whisper']),
    );
    expect(definition.poolIndex.dirtyMap.get('npc.old_guard.met')).toEqual(
      new Set(['ev_wall_whisper']),
    );
    expect(definition.poolIndex.dirtyMap.get('flag.heard_rumor')).toEqual(
      new Set(['ev_market_rumor']),
    );
    // 仅 ev_wall_whisper 声明互斥组（ev_market_rumor 无互斥约束）
    expect(definition.poolIndex.mutexGroups.get('wall_line')).toEqual(['ev_wall_whisper']);
  });

  it('refs 反查表：任务与成就条件注册（§4.5 与事件系统同一机制）', async () => {
    const definition = await loadFixturePackage('mini-game');
    const { questRefs, achievementRefs } = definition.poolIndex;
    expect(questRefs.get('flag.heard_rumor')).toEqual(new Set(['wall_rubbing']));
    expect(questRefs.get('flag.wall_rubbing_taken')).toEqual(new Set(['wall_rubbing']));
    expect(questRefs.get('npc.old_guard.talked')).toEqual(new Set(['wall_rubbing']));
    expect(questRefs.get('time.day')).toEqual(new Set(['wall_rubbing']));
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
    expect(zhCN?.keys.size).toBe(45);
    expect(zhCN?.keys.get('scenes.arrival.open')).toBe(
      '暮雨初歇，你踏上旧镇的石板路，灯笼在雾里晕出一片暖黄。',
    );
    expect(zhCN?.keys.has('scenes.arrival.choice.go_market')).toBe(true);
    expect(zhCN?.keys.has('quests.wall_rubbing.obj_inspect')).toBe(true);
    expect(zhCN?.keys.has('tags.general.name')).toBe(true);
  });
});
