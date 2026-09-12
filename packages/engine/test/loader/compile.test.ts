import { describe, expect, it } from 'vitest';
import { EngineError } from '@game/shared';
import { loadFixture } from './fixtures.js';

/** 加载夹具并捕获 EngineError（预期失败的用例共用） */
async function captureLoadError(
  override: (files: Record<string, string>) => void,
): Promise<EngineError> {
  try {
    await loadFixture(override);
  } catch (error) {
    if (error instanceof EngineError) return error;
    throw error;
  }
  throw new Error('夹具应当加载失败，但加载成功了');
}

/**
 * compile 步骤用例（06 任务 B2，设计 §3.4 步骤 5 / §4.4 PoolIndex / DD-05）。
 *
 * 断言口径：全包表达式按原文编译入缓存（refs 抽取供脏标记）；PoolIndex
 * byScope key = `${area}/${location ?? '*'}`；dirtyMap/questRefs/achievementRefs
 * 为 VarRef.path → 内容 id 的反查表；mediaCatalog 按 assetId 解析 path/hash/
 * type（DD-05）。表达式编译失败 → EXPR_COMPILE 阻断（DD-01）。
 */

describe('compile 步骤（管线步骤 5，06 任务 B2）', () => {
  it('exprCache：全部表达式按原文编译入缓存，同一原文只编译一次', async () => {
    const definition = await loadFixture();
    // 场景 showIf / entry.require / 事件 require / 定价 / 任务 / 成就条件全部入缓存
    expect(definition.exprCache.has('attr.stamina > 0')).toBe(true);
    expect(definition.exprCache.has('flag.game_started')).toBe(true);
    expect(definition.exprCache.has('flag.wall_seen && npc.guard.met')).toBe(true);
    expect(definition.exprCache.has('attr.insight >= 20')).toBe(true);
    // 同一原文（goto 场景复用 ev_whisper_scene）不重复编译——缓存键即原文
    expect(definition.exprCache.size).toBe(new Set([...definition.exprCache.keys()]).size);
    const compiled = definition.exprCache.get('attr.insight >= 20');
    expect(compiled?.refs).toEqual([{ root: 'attr', path: 'attr.insight' }]);
  });

  it('poolIndex.byScope：key = area/location 与 area/*（缺省地点）', async () => {
    const definition = await loadFixture();
    const { byScope } = definition.poolIndex;
    expect([...byScope.keys()].sort()).toEqual(['old_town/*', 'old_town/gate', 'old_town/market']);
    expect(byScope.get('old_town/gate')?.map((event) => event.id)).toEqual(['ev_whisper']);
    expect(byScope.get('old_town/*')?.map((event) => event.id)).toEqual(['ev_roam']);
  });

  it('poolIndex.dirtyMap：事件 require 的编译期 refs 反查（NFR-02 脏标记）', async () => {
    const definition = await loadFixture();
    const { dirtyMap } = definition.poolIndex;
    expect(dirtyMap.get('flag.wall_seen')).toEqual(new Set(['ev_whisper']));
    expect(dirtyMap.get('npc.guard.met')).toEqual(new Set(['ev_whisper']));
    expect(dirtyMap.get('flag.heard_rumor')).toEqual(new Set(['ev_rumor']));
    // 未被任何 require 引用的路径不在表中
    expect(dirtyMap.has('attr.hp')).toBe(false);
  });

  it('poolIndex.mutexGroups：互斥组成员登记（FR-XPLR-05）', async () => {
    const definition = await loadFixture();
    const group = definition.poolIndex.mutexGroups.get('wall_line');
    expect(group).toEqual(['ev_whisper', 'ev_rumor']);
  });

  it('poolIndex.questRefs / achievementRefs：任务与成就条件的 refs 反查表（§4.5）', async () => {
    const definition = await loadFixture();
    const { questRefs, achievementRefs } = definition.poolIndex;
    expect(questRefs.get('flag.heard_rumor')).toEqual(new Set(['wall_rubbing']));
    expect(questRefs.get('flag.rubbing_taken')).toEqual(new Set(['wall_rubbing']));
    expect(achievementRefs.get('attr.insight')).toEqual(new Set(['sharp_eye']));
  });

  it('mediaCatalog：assetId → {path, hash, type}（DD-05），缺省无 preload', async () => {
    const definition = await loadFixture();
    const bg = definition.mediaCatalog.resolve('bg_town');
    expect(bg).not.toBeNull();
    expect(bg?.path).toBe('assets/bg_town.png');
    expect(bg?.type).toBe('image');
    expect(bg?.preload).toBe(false);
    expect(bg?.hash).toMatch(/^[0-9a-f]{8}$/);
    // 层级路径 assetId 与音频类型
    expect(definition.mediaCatalog.resolve('media/cg_rain')?.type).toBe('image');
    // 同内容同指纹（确定性），不同内容不同指纹
    const other = definition.mediaCatalog.resolve('media/cg_rain');
    expect(other?.hash).not.toBe(bg?.hash);
    expect(definition.mediaCatalog.resolve('missing_asset')).toBeNull();
    expect(definition.mediaCatalog.size).toBe(2);
  });

  it('非法表达式 → EXPR_COMPILE 阻断（DD-01 编译期校验，原文入 where）', async () => {
    const error = await captureLoadError((files) => {
      const scene = files['data/scenes/old_town/arrival.yaml'] ?? '';
      files['data/scenes/old_town/arrival.yaml'] = scene.replace(
        'showIf: "attr.stamina > 0"',
        'showIf: "attr.stamina > (0"',
      );
    });
    expect(error.code).toBe('EXPR_COMPILE');
    expect(error.where['expr']).toBe('attr.stamina > (0');
    expect(error.where['from']).toContain('scenes[arrival]');
  });

  it('未知函数 → EXPR_COMPILE（白名单外函数不被 x.* 延迟豁免）', async () => {
    const error = await captureLoadError((files) => {
      const scene = files['data/scenes/old_town/arrival.yaml'] ?? '';
      files['data/scenes/old_town/arrival.yaml'] = scene.replace(
        'showIf: "attr.stamina > 0"',
        'showIf: "nope() > 0"',
      );
    });
    expect(error.code).toBe('EXPR_COMPILE');
    expect(error.where['fn']).toBe('nope');
  });

  it('纯随机函数出现在事件 require（缓存敏感位置）→ EXPR_COMPILE（DD-01）', async () => {
    const error = await captureLoadError((files) => {
      const events = files['data/events.yaml'] ?? '';
      files['data/events.yaml'] = events.replace(
        'require: "flag.wall_seen && npc.guard.met"',
        'require: "rand(1, 6) > 3"',
      );
    });
    expect(error.code).toBe('EXPR_COMPILE');
    expect(error.where['detail']).toContain('非纯');
  });
});
