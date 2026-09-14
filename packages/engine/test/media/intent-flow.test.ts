import { describe, expect, it } from 'vitest';
import type { MediaIntent } from '../../src/runtime/index.js';
import type { NarrativeMediaResolver, SceneRunnerDef } from '../../src/narrative/index.js';
import { makeDef, makeRunner } from '../narrative/fixtures.js';

/**
 * 24 任务 2/3/4：叙事层媒体意图（设计 §5.10 / FR-MEDIA-02/03/04/06）。
 *
 * 分层（DD-06）：narrative 只依赖注入的**最小解析器视图**（@see
 * NarrativeMediaResolver），不 import media 子系统；解析与存在性核对由宿主
 * 注入 `MediaResolver`（24 号 media 子系统实现该视图）。
 *
 * 产出时机：
 * - 场景级 bg/bgm 在进入场景时产出（区域绑定为逐项回落层，FR-MEDIA-02）；
 * - 段落级 cg/sprite 随段落**揭示**产出（游标语义：未揭示不产出）；
 * - CG 揭示即登记 seen.cg（FR-MEDIA-04 图鉴数据源，只读会话除外）。
 */

/** 记录型解析器桩：固定存在集 + 记录核对调用（媒体子系统的契约面） */
function stubResolver(
  known: readonly string[] = [],
  onResolve?: (assetId: string, kind: string) => void,
): NarrativeMediaResolver {
  const set = new Set(known);
  return {
    decorate(intent: MediaIntent): MediaIntent {
      onResolve?.(intent.assetId, intent.type);
      if (set.has(intent.assetId)) return intent;
      return { ...intent, missing: true } as MediaIntent;
    },
  };
}

/** 场景级媒体：image 前置段的 intent 序列（bg/bgm） */
function imageSegments(
  segments: readonly { kind: string; key?: string; media?: readonly MediaIntent[] }[],
): readonly MediaIntent[] {
  return segments.filter((s) => s.kind === 'image').flatMap((s) => s.media ?? []);
}

/** 段落级媒体：文本段（按序）携带的 intent 序列（cg/sprite） */
function textSegments(
  segments: readonly { kind: string; key?: string; media?: readonly MediaIntent[] }[],
): readonly { key?: string; media?: readonly MediaIntent[] }[] {
  return segments.filter((s) => s.kind === 'text');
}

/** 全部段落级媒体意图（按渲染序） */
function segmentMedia(
  segments: readonly { kind: string; key?: string; media?: readonly MediaIntent[] }[],
): readonly MediaIntent[] {
  return textSegments(segments).flatMap((s) => s.media ?? []);
}

const BASE_LOCALES = { 'zh-CN': { scenes: { a: { p1: '一。', p2: '二。', p3: '三。' } } } };

describe('24-2 场景/区域 bg/bgm 经解析器产出（FR-MEDIA-02）', () => {
  const DEF: SceneRunnerDef = makeDef({
    scenes: [
      {
        id: 'scene_scene_wins',
        area: 'old_town',
        segments: [{ key: 'scenes.a.p1' }],
        choices: [],
        media: { bg: 'bg_scene', bgm: 'bgm_scene' },
      },
      {
        id: 'scene_partial',
        area: 'old_town',
        segments: [{ key: 'scenes.a.p1' }],
        choices: [],
        media: { bg: 'bg_scene' },
      },
    ],
    locales: BASE_LOCALES,
  });

  const AREA_MEDIA = new Map([['old_town', { media: { bg: 'bg_area', bgm: 'bgm_area' } }]]);

  it('场景绑定 → 解析器产出的 intent 序列（bg 无 loop，bgm 恒 loop）', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_scene_wins',
      mediaResolver: stubResolver(['bg_scene', 'bgm_scene']),
    });
    expect(imageSegments(runner.renderList())).toEqual([
      { type: 'bg', assetId: 'bg_scene' },
      { type: 'bgm', assetId: 'bgm_scene', loop: true },
    ]);
  });

  it('逐项回落：场景已声明 bg → 不再解析区域 bg；未声明的 bgm 取区域值', () => {
    const resolved: string[] = [];
    const runner = makeRunner(DEF, {
      sceneId: 'scene_partial',
      mediaResolver: stubResolver(['bg_scene'], (assetId) => resolved.push(assetId)),
      areas: AREA_MEDIA,
    });
    expect(imageSegments(runner.renderList())).toEqual([
      { type: 'bg', assetId: 'bg_scene' },
      { type: 'bgm', assetId: 'bgm_area', loop: true, missing: true },
    ]);
    expect(resolved).toEqual(['bg_scene', 'bgm_area']);
  });

  it('资源缺失 → 占位 intent 照常产出（missing 标记来自解析器，FR-MEDIA-06）', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_partial',
      mediaResolver: stubResolver([]),
      areas: AREA_MEDIA,
    });
    expect(imageSegments(runner.renderList())).toEqual([
      { type: 'bg', assetId: 'bg_scene', missing: true },
      { type: 'bgm', assetId: 'bgm_area', loop: true, missing: true },
    ]);
  });

  it('未注入解析器 → 08 号既有行为（裸 intent，无 missing；向后兼容）', () => {
    const runner = makeRunner(DEF, { sceneId: 'scene_scene_wins' });
    expect(imageSegments(runner.renderList())).toEqual([
      { type: 'bg', assetId: 'bg_scene' },
      { type: 'bgm', assetId: 'bgm_scene', loop: true },
    ]);
  });

  it('无绑定（场景与区域均无）→ 不产出 image 段落', () => {
    const def = makeDef({
      scenes: [{ id: 'scene_plain', area: 'a', segments: [{ key: 'scenes.a.p1' }], choices: [] }],
      locales: BASE_LOCALES,
    });
    const runner = makeRunner(def, {
      sceneId: 'scene_plain',
      mediaResolver: stubResolver(),
      areas: AREA_MEDIA,
    });
    expect(imageSegments(runner.renderList())).toEqual([]);
  });

  it('只读会话同样产出媒体意图（回想重放需还原场景氛围，FR-GAL-01）', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_scene_wins',
      readonly: true,
      mediaResolver: stubResolver(['bg_scene', 'bgm_scene']),
    });
    expect(imageSegments(runner.renderList())).toHaveLength(2);
  });
});

describe('24-4 段落级 CG 与立绘切换（FR-MEDIA-04/03）', () => {
  const DEF = makeDef({
    scenes: [
      {
        id: 'scene_cg',
        area: 'a',
        segments: [
          { key: 'scenes.a.p1' },
          { key: 'scenes.a.p2', cg: 'cg_rain' },
          { key: 'scenes.a.p3', cg: 'cg_missing' },
        ],
        choices: [],
      },
      {
        id: 'scene_sprite',
        area: 'a',
        segments: [{ key: 'scenes.a.p1' }, { key: 'scenes.a.p2', sprite: { npc: 'npc_raven' } }],
        choices: [],
      },
      {
        id: 'scene_both',
        area: 'a',
        segments: [
          { key: 'scenes.a.p1' },
          { key: 'scenes.a.p2', cg: 'cg_rain', sprite: { npc: 'npc_raven' } },
        ],
        choices: [],
      },
    ],
    locales: BASE_LOCALES,
  });

  const NPCS = new Map([
    [
      'npc_raven',
      {
        sprites: [
          { base: 'sprite_base', variants: [{ when: 'ravenBonded', asset: 'sprite_bonded' }] },
        ],
      },
    ],
  ]);

  it('CG 随段落揭示产出（未揭示段落不产出）', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_cg',
      mediaResolver: stubResolver(['cg_rain']),
    });
    expect(segmentMedia(runner.renderList())).toEqual([]);
    runner.advance();
    expect(segmentMedia(runner.renderList())).toEqual([{ type: 'cg', assetId: 'cg_rain' }]);
    runner.advance();
    expect(segmentMedia(runner.renderList())).toEqual([
      { type: 'cg', assetId: 'cg_rain' },
      { type: 'cg', assetId: 'cg_missing', missing: true },
    ]);
  });

  it('CG 与文本同段落：媒体挂在文本段落上（不额外产生 image 段）', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_cg',
      mediaResolver: stubResolver(['cg_rain']),
    });
    runner.renderList();
    runner.advance();
    const segments = runner.renderList();
    const text = segments.find(
      (segment) => segment.kind === 'text' && segment.key === 'scenes.a.p2',
    );
    expect(text?.media).toEqual([{ type: 'cg', assetId: 'cg_rain' }]);
  });

  it('CG 揭示即登记 seen.cg（去重；图鉴数据源 FR-MEDIA-04）', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_cg',
      mediaResolver: stubResolver(['cg_rain']),
    });
    runner.renderList();
    expect(runner.cgSeen()).toEqual([]);
    runner.advance();
    runner.renderList();
    expect(runner.cgSeen()).toEqual(['cg_rain']);
    runner.advance();
    runner.renderList();
    expect(runner.cgSeen()).toEqual(['cg_rain', 'cg_missing']);
  });

  it('重复 renderList 不重复登记（游标推进才登记）', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_cg',
      mediaResolver: stubResolver(['cg_rain']),
    });
    runner.renderList();
    runner.advance();
    runner.renderList();
    runner.renderList();
    runner.renderList();
    expect(runner.cgSeen()).toEqual(['cg_rain']);
  });

  it('只读会话不登记 seen.cg（回想重放无副作用，FR-GAL-01）', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_cg',
      readonly: true,
      mediaResolver: stubResolver(['cg_rain']),
    });
    runner.renderList();
    runner.advance();
    runner.renderList();
    expect(runner.cgSeen()).toEqual([]);
  });

  it('内容过滤屏蔽的段落不产出 CG、不登记（不泄漏被屏蔽内容）', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_cg',
      mediaResolver: stubResolver(['cg_rain']),
      contentFilter: { passes: () => false, placeholderFor: () => null },
    });
    runner.renderList();
    runner.advance();
    runner.renderList();
    expect(runner.cgSeen()).toEqual([]);
  });

  it('段落级 sprite：按 NPC 差分声明选立绘（条件命中 → 差分资产）', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_sprite',
      mediaResolver: stubResolver(['sprite_bonded']),
      npcs: NPCS,
      evalSpriteCondition: (expr) => expr === 'ravenBonded',
    });
    runner.renderList();
    runner.advance();
    const text = runner
      .renderList()
      .find((segment) => segment.kind === 'text' && segment.key === 'scenes.a.p2');
    expect(text?.media).toEqual([{ type: 'sprite', assetId: 'sprite_bonded' }]);
  });

  it('差分不命中 → 回落基图', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_sprite',
      mediaResolver: stubResolver(['sprite_base']),
      npcs: NPCS,
      evalSpriteCondition: () => false,
    });
    runner.renderList();
    runner.advance();
    const text = runner
      .renderList()
      .find((segment) => segment.kind === 'text' && segment.key === 'scenes.a.p2');
    expect(text?.media).toEqual([{ type: 'sprite', assetId: 'sprite_base' }]);
  });

  it('未声明立绘的 NPC → 不产出 sprite（无资产可呈现）', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_sprite',
      mediaResolver: stubResolver(),
      npcs: new Map(),
      evalSpriteCondition: () => true,
    });
    runner.renderList();
    runner.advance();
    const text = runner
      .renderList()
      .find((segment) => segment.kind === 'text' && segment.key === 'scenes.a.p2');
    expect(text?.media).toBeUndefined();
  });

  it('CG 与 sprite 同段落：intent 序 cg 在前、sprite 在后', () => {
    const runner = makeRunner(DEF, {
      sceneId: 'scene_both',
      mediaResolver: stubResolver(['cg_rain', 'sprite_bonded']),
      npcs: NPCS,
      evalSpriteCondition: () => true,
    });
    runner.renderList();
    runner.advance();
    const text = runner
      .renderList()
      .find((segment) => segment.kind === 'text' && segment.key === 'scenes.a.p2');
    expect(text?.media?.map((m) => m.type)).toEqual(['cg', 'sprite']);
  });
});
