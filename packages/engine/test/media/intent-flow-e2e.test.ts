import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import type { MediaIntent } from '../../src/runtime/index.js';
import type { SceneRunnerRuntime } from '../../src/narrative/index.js';
import { SceneRunner } from '../../src/narrative/index.js';
import { GameRuntime } from '../../src/runtime/index.js';
import { createBuiltinEffectRegistry } from '../../src/effects/index.js';
import { newGameState } from '../../src/state/index.js';
import { InMemoryPackageSource } from '../../src/loader/source-memory.js';
import { loadGamePackage } from '../../src/loader/pipeline.js';
import { MediaResolver } from '../../src/media/index.js';
import { compileExpr, createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';

/**
 * 24 任务 6：完整 intent 流端到端断言（进入场景 → 段落 → 选项）。
 *
 * 走真实管线：InMemory 包源（含 assets/ 二进制）→ 七步加载器 → GameDefinition
 * → MediaResolver(mediaCatalog) → SceneRunner。断言从场景进入到选项呈现的全
 * 序列：bg/bgm（场景级）→ cg/sprite（段落级，随揭示）→ 选项消费后的 sfx
 * （效果指令面）——引擎侧全链路零图像/音频依赖（模块验收红线）。
 */

const MANIFEST = [
  'gameId: media_fixture',
  'entryScene: media_start',
  'mainLang: zh-CN',
  'langs: [zh-CN]',
  'contentTags: []',
  'gameVersion: 1.0.0',
  'schemaVersion: 1',
  'minEngineVersion: 0.1.0',
  'redirects: {}',
  'credits: 24 号媒体解析测试夹具',
].join('\n');

// assetId = assets/ 下路径去前缀与扩展名（保留目录层级，collect 约定）
// 此处用平铺命名让 assetId 即为下划线形态（'bg_town' 等）
const ASSET_FILES: Record<string, Uint8Array> = {
  'assets/bg_town.webp': new Uint8Array([1, 2, 3]),
  'assets/bgm_town.ogg': new Uint8Array([4, 5, 6]),
  'assets/cg_rain.webp': new Uint8Array([7, 8, 9]),
  'assets/raven_base.webp': new Uint8Array([10, 11]),
  'assets/raven_bonded.webp': new Uint8Array([12, 13]),
  'assets/sfx_click.ogg': new Uint8Array([14, 15]),
};

const FILES: Record<string, string> = {
  'manifest.yaml': MANIFEST,
  'data/attrs.yaml':
    'numeric:\n  hp: {min: 0, max: 100, init: 100, show: true}\nlevel: {}\nderived: {}',
  'data/areas/old_town.yaml': [
    'id: old_town',
    'nameKey: areas.old_town.name',
    'media: {bg: bg_town, bgm: bgm_town}',
    'locations:',
    '  market: {nameKey: areas.old_town.market, moveCost: 1, mapPos: [10, 20]}',
  ].join('\n'),
  'data/scenes/old_town/media_start.yaml': [
    'id: media_start',
    'area: old_town',
    'media: {bg: bg_town, bgm: bgm_town}',
    'segments:',
    '  - key: scenes.media.p1',
    '  - key: scenes.media.p2',
    '    cg: cg_rain',
    '  - key: scenes.media.p3',
    '    sprite: {npc: raven}',
    'choices:',
    '  - id: click',
    '    textKey: scenes.media.choice.click',
    '    effects:',
    '      - media: {type: sfx, assetId: sfx_click}',
  ].join('\n'),
  'data/npcs/raven.yaml': [
    'id: raven',
    'nameKey: npcs.raven.name',
    'sprites:',
    '  - base: raven_base',
    '    variants:',
    '      - {when: "attr.hp > 50", asset: raven_bonded}',
  ].join('\n'),
  'locales/zh-CN/scenes/media.yaml': [
    'media:',
    '  p1: 一段。',
    '  p2: 二段（含插图）。',
    '  p3: 三段（立绘）。',
    '  choice:',
    '    click: 点一下。',
  ].join('\n'),
  'locales/zh-CN/areas/old_town.yaml': 'old_town:\n  name: 旧镇\n  market: 集市\n',
  'locales/zh-CN/npcs/raven.yaml': 'raven:\n  name: 渡鸦\n',
};

/** 构造包源（文本 + 二进制资产；InMemoryPackageSource 以记录构造） */
function makeSource(overrides: Record<string, string> = {}): InMemoryPackageSource {
  return new InMemoryPackageSource({ ...FILES, ...overrides, ...ASSET_FILES });
}

/** 加载夹具包 + 装配运行时会话（真实管线，非桩） */
async function makeSession(state?: { hp?: number }): Promise<{
  runner: SceneRunner;
  runtime: GameRuntime;
  definition: Awaited<ReturnType<typeof loadGamePackage>>;
  warnings: string[];
}> {
  const definition = await loadGamePackage(makeSource());
  const warnings: string[] = [];
  const resolver = new MediaResolver({
    catalog: definition.mediaCatalog,
    onWarn: (warning) => warnings.push(warning.where['assetId'] as string),
  });
  const runtime = new GameRuntime({
    state: newGameState(
      {
        versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
        attrs: { hp: state?.hp ?? 100 },
      },
      createRng(42),
    ),
    rng: createRng(7),
    effectExecutor: definition.effectRegistry ?? createBuiltinEffectRegistry(),
  });
  // GameDefinition 结构化满足 SceneRunnerDef（npcs/areas 域已由加载器发布）
  const runner = new SceneRunner(runtime as unknown as SceneRunnerRuntime, {
    def: definition,
    sceneId: 'media_start',
    mediaResolver: resolver,
    evalSpriteCondition: (source) =>
      runtime.evalCondition(compileExpr(source, createBuiltinFunctionRegistry())),
  });
  return { runner, runtime, definition, warnings };
}

/** 渲染序展开的完整 intent 流（image 段 + 文本段各按其序） */
function intentStream(
  segments: readonly { kind: string; media?: readonly MediaIntent[] }[],
): MediaIntent[] {
  return segments.flatMap((segment) => segment.media ?? []);
}

describe('24-6 完整 intent 流（进入场景 → 段落 → 选项，真实管线）', () => {
  it('包加载：assets/ 登记入 mediaCatalog（assetId 去前缀与扩展名）', async () => {
    const { definition } = await makeSession();
    expect(definition.mediaCatalog.size).toBe(6);
    expect(definition.mediaCatalog.resolve('bg_town')?.path).toBe('assets/bg_town.webp');
    expect(definition.mediaCatalog.resolve('bg_town')?.type).toBe('image');
    expect(definition.mediaCatalog.resolve('sfx_click')?.type).toBe('audio');
    expect(definition.mediaCatalog.resolve('nonexistent')).toBeNull();
  });

  it('进入场景：场景级 bg/bgm（场景声明覆盖区域回落）作为前置 image 段产出', async () => {
    const { runner } = await makeSession();
    const first = runner.renderList();
    expect(first[0]?.kind).toBe('image');
    expect(first[0]?.media).toEqual([
      { type: 'bg', assetId: 'bg_town' },
      { type: 'bgm', assetId: 'bgm_town', loop: true },
    ]);
  });

  it('段落揭示序：p1 → p2 携 cg → p3 携 sprite（差分按状态求值）', async () => {
    const { runner } = await makeSession({ hp: 100 });
    runner.renderList();
    expect(intentStream(runner.renderList())).toEqual([
      { type: 'bg', assetId: 'bg_town' },
      { type: 'bgm', assetId: 'bgm_town', loop: true },
    ]);
    runner.advance();
    expect(intentStream(runner.renderList()).slice(2)).toEqual([
      { type: 'cg', assetId: 'cg_rain' },
    ]);
    runner.advance();
    expect(intentStream(runner.renderList()).slice(2)).toEqual([
      { type: 'cg', assetId: 'cg_rain' },
      { type: 'sprite', assetId: 'raven_bonded' },
    ]);
  });

  it('立绘差分随状态变化：hp 低 → 回落基图（同一场景同一段落）', async () => {
    const { runner } = await makeSession({ hp: 10 });
    runner.renderList();
    runner.advance();
    runner.advance();
    const intents = intentStream(runner.renderList());
    expect(intents.at(-1)).toEqual({ type: 'sprite', assetId: 'raven_base' });
  });

  it('段落媒体仅在揭示（含未揭示）时依序累积：sprite 属最后一次揭示', async () => {
    const { runner } = await makeSession({ hp: 100 });
    runner.renderList();
    const afterFirst = intentStream(runner.renderList());
    expect(afterFirst.map((intent) => intent.type)).toEqual(['bg', 'bgm']);
    runner.advance();
    expect(intentStream(runner.renderList()).map((intent) => intent.type)).toEqual([
      'bg',
      'bgm',
      'cg',
    ]);
  });

  it('段落尽后选项呈现：intent 流不因选项相位而增加（媒体由选择驱动）', async () => {
    const { runner } = await makeSession();
    runner.renderList();
    runner.advance();
    runner.advance();
    runner.advance(); // 段落尽 → await_choice
    expect(runner.phase).toBe('await_choice');
    const beforeChoice = intentStream(runner.renderList());
    expect(beforeChoice.map((intent) => intent.type)).toEqual(['bg', 'bgm', 'cg', 'sprite']);
  });

  it('选择执行：sfx 意图经效果指令产出（一次性播放，FR-MEDIA-05）并进入事件流', async () => {
    const { runner, runtime } = await makeSession();
    const mediaEvents: MediaIntent[] = [];
    runtime.on('media', (event) => mediaEvents.push(event.intent));
    runner.renderList();
    runner.advance();
    runner.advance();
    runner.advance();
    runner.choose('click');
    expect(mediaEvents).toEqual([{ type: 'sfx', assetId: 'sfx_click' }]);
  });

  it('CG 自动登记 seen.cg（图鉴数据源）且随选择持久（非只读会话）', async () => {
    const { runner, runtime } = await makeSession();
    runner.renderList();
    runner.advance();
    runner.renderList();
    expect(runtime.state.seen.cg).toEqual(['cg_rain']);
    runner.advance();
    runner.advance();
    runner.renderList();
    runner.choose('click');
    expect(runtime.state.seen.cg).toEqual(['cg_rain']);
  });

  it('零缺失：全链路无 media_missing 告警（资产齐备时）', async () => {
    const { runner, warnings } = await makeSession();
    runner.renderList();
    runner.advance();
    runner.advance();
    expect(warnings).toEqual([]);
  });

  it('缺失资产：intent 流仍完整（占位标记）+ 告警按 assetId 去重', async () => {
    // 场景声明一个不存在的 bg（区域回落被覆盖），段落 CG 亦缺失
    const original = FILES['data/scenes/old_town/media_start.yaml'] ?? '';
    const files = {
      'data/scenes/old_town/media_start.yaml': original
        .replace('media: {bg: bg_town, bgm: bgm_town}', 'media: {bg: bg_gone, bgm: bgm_town}')
        .replace('cg: cg_rain', 'cg: cg_gone'),
    };
    const definition = await loadGamePackage(makeSource(files));
    // crossRef 对缺失媒体发 warning（不阻断加载）——此处验证运行期占位语义
    const warnings: string[] = [];
    const resolver = new MediaResolver({
      catalog: definition.mediaCatalog,
      onWarn: (warning) => warnings.push(warning.where['assetId'] as string),
    });
    const runtime = new GameRuntime({
      state: newGameState(
        {
          versions: { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.1.0' },
          attrs: { hp: 100 },
        },
        createRng(42),
      ),
      rng: createRng(7),
      effectExecutor: createBuiltinEffectRegistry(),
    });
    const runner = new SceneRunner(runtime as unknown as SceneRunnerRuntime, {
      def: definition,
      sceneId: 'media_start',
      mediaResolver: resolver,
      evalSpriteCondition: () => true,
    });
    const first = intentStream(runner.renderList());
    expect(first[0]).toEqual({ type: 'bg', assetId: 'bg_gone', missing: true });
    runner.advance();
    expect(intentStream(runner.renderList())).toContainEqual({
      type: 'cg',
      assetId: 'cg_gone',
      missing: true,
    });
    // 重复渲染不重复告警（按 assetId 去重）
    runner.renderList();
    expect(warnings).toEqual(['bg_gone', 'cg_gone']);
  });
});
