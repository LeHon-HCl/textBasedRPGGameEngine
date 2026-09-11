import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  effectParamSchemas,
  eventDefSchema,
  loopConfigSchema,
  manifestSchema,
  npcDefSchema,
  profileSchema,
  questDefSchema,
  sceneDefSchema,
  serializedStateSchema,
  shopEntrySchema,
  textKeySchema,
  mediaRefSchema,
  gameIdSchema,
} from '../../src/index.js';

/**
 * refId(kind) 元数据抽测（02 任务 C3，设计 §2.1）。
 *
 * 跨存档引用字段必须以 refId(RefKind) 声明（内部 = z.string().meta({refKind})）：
 * - 加载器（06 号）据此建引用索引、做 DANGLING_REF 检查（§3.4 步骤 4）；
 * - 迁移器（21 号）据此生成 IdPathRegistry，按 kind 定向改写 redirects（§5.7）。
 * 本测试在关键引用字段落位处抽检元数据，防止后续演进时标注遗失（快照守护的
 * 语义化补充——按字段路径精确断言，而非全文比对）。
 */

/** 读取 schema 实例上登记的 refKind 元数据（未标注返回 undefined） */
function refKindOf(schema: z.core.$ZodType | undefined): unknown {
  if (!schema) return undefined;
  return z.globalRegistry.get(schema)?.refKind;
}

describe('refId(kind) 元数据在关键引用字段落位（设计 §2.1，02 任务 C3）', () => {
  it('manifest：entryScene → scene', () => {
    expect(refKindOf(manifestSchema.shape.entryScene)).toBe('scene');
  });

  it('scene：area → area、choices[].goto → scene、textKey → text', () => {
    expect(refKindOf(sceneDefSchema.shape.area)).toBe('area');
    const choice = sceneDefSchema.shape.choices.element;
    expect(refKindOf(choice.shape.goto.unwrap())).toBe('scene');
    expect(refKindOf(choice.shape.textKey)).toBe('text');
    expect(refKindOf(sceneDefSchema.shape.segments.element.shape.key)).toBe('text');
  });

  it('event：where.area → area、where.location → location、scene → scene', () => {
    expect(refKindOf(eventDefSchema.shape.where.shape.area)).toBe('area');
    expect(refKindOf(eventDefSchema.shape.where.shape.location.unwrap())).toBe('location');
    expect(refKindOf(eventDefSchema.shape.scene)).toBe('scene');
  });

  it('quest：giver → npc、conflicts/requires → quest', () => {
    expect(refKindOf(questDefSchema.shape.giver.unwrap())).toBe('npc');
    expect(refKindOf(questDefSchema.shape.conflicts.unwrap().element)).toBe('quest');
    expect(refKindOf(questDefSchema.shape.requires.unwrap().element)).toBe('quest');
  });

  it('npc：schedule[].location → location', () => {
    expect(refKindOf(npcDefSchema.shape.schedule.unwrap().element.shape.location)).toBe('location');
  });

  it('效果指令：give/take.item → item、favor.npc → npc、reputation.faction → faction、goto → scene、unlock 分型 → scene/achievement', () => {
    expect(refKindOf(effectParamSchemas.give.shape.item)).toBe('item');
    expect(refKindOf(effectParamSchemas.take.shape.item)).toBe('item');
    expect(refKindOf(effectParamSchemas.favor.shape.npc)).toBe('npc');
    expect(refKindOf(effectParamSchemas.reputation.shape.faction)).toBe('faction');
    expect(refKindOf(effectParamSchemas.goto)).toBe('scene');
    const unlockOptions = effectParamSchemas.unlock.options;
    const gallery = unlockOptions.find((o) => o.shape.kind.value === 'gallery');
    const achievement = unlockOptions.find((o) => o.shape.kind.value === 'achievement');
    expect(refKindOf(gallery?.shape.id)).toBe('scene');
    expect(refKindOf(achievement?.shape.id)).toBe('achievement');
  });

  it('shop：entries[].item → item；loop：openingScene → scene', () => {
    expect(refKindOf(shopEntrySchema.shape.item)).toBe('item');
    expect(refKindOf(loopConfigSchema.shape.openingScene)).toBe('scene');
  });

  it('save（SerializedState）：bag/equip/outfit → item、unlockedAreas → area、npcs/quests/factions 记录键 → 对应 kind、seen 分域', () => {
    const player = serializedStateSchema.shape.player;
    expect(refKindOf(player.shape.bag.element.shape.itemId)).toBe('item');
    expect(refKindOf(player.shape.equip._zod.def.valueType)).toBe('item');
    expect(refKindOf(player.shape.outfit._zod.def.valueType._zod.def.valueType)).toBe('item');

    const world = serializedStateSchema.shape.world;
    expect(refKindOf(world.shape.unlockedAreas.element)).toBe('area');

    expect(refKindOf(serializedStateSchema.shape.npcs._zod.def.keyType)).toBe('npc');
    expect(refKindOf(serializedStateSchema.shape.quests._zod.def.keyType)).toBe('quest');
    expect(refKindOf(serializedStateSchema.shape.factions._zod.def.keyType)).toBe('faction');

    const seen = serializedStateSchema.shape.seen;
    expect(refKindOf(seen.shape.scenes.element)).toBe('scene');
    expect(refKindOf(seen.shape.gallery.element)).toBe('media');
  });

  it('profile：achievements 记录键 → achievement（FR-MIGR-06 定向改写入口）', () => {
    expect(refKindOf(profileSchema.shape.achievements._zod.def.keyType)).toBe('achievement');
  });

  it('基础构件：textKey → text、mediaRef → media；gameId 主键不携带 refKind（非引用字段）', () => {
    expect(refKindOf(textKeySchema)).toBe('text');
    expect(refKindOf(mediaRefSchema)).toBe('media');
    expect(refKindOf(gameIdSchema)).toBeUndefined();
  });
});
