import { describe, expect, it } from 'vitest';
import { areaDefSchema, npcDefSchema, segmentSchema } from '../../src/index.js';

/**
 * 24 模块的 schema 面（FR-MEDIA-02/03/04，设计 §5.10）。
 *
 * - 区域级媒体绑定（任务 2）：场景绑定的回落层；
 * - npc.sprites 升级为「基图 + 差分」声明：差分以条件表达式选择（好感阶段/
 *   身体部位/服装驱动，任务 3）；
 * - 段落（segment）加可选 `cg`（段落级插图）与 `sprite`（段落级立绘切换，
 *   任务 4）。
 *
 * 全部变更遵循 NFR-12/15「只增不改」：新字段一律可选，旧数据形态照旧合法。
 */

const BASE_AREA = {
  id: 'old_town',
  nameKey: 'areas.old_town.name',
  locations: {
    market: { nameKey: 'areas.old_town.market', moveCost: 1, mapPos: [120, 80] },
  },
};

describe('24-2 区域级媒体绑定（FR-MEDIA-02）', () => {
  it('区域可声明 media.bg / media.bgm', () => {
    const result = areaDefSchema.safeParse({
      ...BASE_AREA,
      media: { bg: 'bg_old_town', bgm: 'bgm_old_town' },
    });
    expect(result.success).toBe(true);
  });

  it('media 为可选：未声明区域照旧合法（只增不改）', () => {
    expect(areaDefSchema.safeParse(BASE_AREA).success).toBe(true);
  });

  it('可只声明其一（bg 或 bgm）', () => {
    expect(areaDefSchema.safeParse({ ...BASE_AREA, media: { bg: 'bg_x' } }).success).toBe(true);
    expect(areaDefSchema.safeParse({ ...BASE_AREA, media: { bgm: 'bgm_x' } }).success).toBe(true);
  });

  it('media 未知字段 → 拒绝（strictObject）', () => {
    expect(
      areaDefSchema.safeParse({ ...BASE_AREA, media: { bg: 'bg_x', volume: 0.5 } }).success,
    ).toBe(false);
  });
});

describe('24-3 npc.sprites：基图 + 差分条件声明（FR-MEDIA-03）', () => {
  it('旧形态（字符串数组）仍合法：向后兼容', () => {
    const legacy = npcDefSchema.safeParse({
      id: 'npc_raven',
      nameKey: 'npc.raven.name',
      sprites: ['sprite_raven_base', 'sprite_raven_smile'],
    });
    expect(legacy.success).toBe(true);
  });

  it('新形态：sprite 条目含 base + variants（variant 的 when 条件表达式）', () => {
    const result = npcDefSchema.safeParse({
      id: 'npc_raven',
      nameKey: 'npc.raven.name',
      sprites: [
        {
          base: 'sprite_raven_base',
          variants: [
            { when: "npc.raven.stage == 'stage_bonded'", asset: 'sprite_raven_bonded' },
            { when: "body.tail == 'fluffy'", asset: 'sprite_raven_fluffy' },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('variant 缺 when 或 asset → 拒绝（strictObject）', () => {
    expect(
      npcDefSchema.safeParse({
        id: 'npc_raven',
        nameKey: 'npc.raven.name',
        sprites: [{ base: 'sprite_raven_base', variants: [{ asset: 'sprite_x' }] }],
      }).success,
    ).toBe(false);
    expect(
      npcDefSchema.safeParse({
        id: 'npc_raven',
        nameKey: 'npc.raven.name',
        sprites: [{ variants: [] }],
      }).success,
    ).toBe(false);
  });
});

describe('24-4 段落级 CG 与立绘切换（FR-MEDIA-04）', () => {
  it('segment 可声明 cg（段落级插图）', () => {
    const result = segmentSchema.safeParse({
      key: 'scenes.arrival.cg_rain',
      cg: 'cg_rain',
    });
    expect(result.success).toBe(true);
  });

  it('segment 可声明 sprite 切换（仅 npc：资产由 NpcDef 差分声明选出）', () => {
    const result = segmentSchema.safeParse({
      key: 'scenes.arrival.raven_enters',
      sprite: { npc: 'npc_raven' },
    });
    expect(result.success).toBe(true);
  });

  it('sprite 不接受在段落侧声明资产/条件（差分逻辑只有 NpcDef 一份）', () => {
    expect(segmentSchema.safeParse({ key: 'k', sprite: { npc: 'npc_x', when: 'flag.y' } }).success).toBe(
      false,
    );
    expect(segmentSchema.safeParse({ key: 'k', sprite: { asset: 'sprite_x' } }).success).toBe(false);
    expect(segmentSchema.safeParse({ key: 'k', sprite: { npc: 'npc_x', asset: 'sprite_x' } }).success).toBe(
      false,
    );
  });

  it('cg 与 sprite 均为可选，旧段落定义不变', () => {
    expect(segmentSchema.safeParse({ key: 'k' }).success).toBe(true);
    expect(segmentSchema.safeParse({ key: 'k', showIf: 'flag.x' }).success).toBe(true);
  });
});
