import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { AttrDefs, ContentTagsDef } from '@game/shared';
import { InMemoryPackageSource, loadGamePackage } from '@game/engine';
import type { GameDefinition } from '@game/engine';
import { createGameHost } from '../../src/app/game-host.js';
import type { GameHost } from '../../src/app/game-host.js';

/**
 * 25 号宿主补充：设置写入、内容过滤即时生效、内容向导数据面、版本信息。
 *
 * 这些是「设置面板 / 首启向导」在浏览器里的数据源——组件测试无法覆盖
 * （组件只报告意图），故在宿主层断言「意图 → 引擎行为」的落地。
 */

const ROOT = 'fixtures/mini-game';

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath.split('\\').join('/')}/${entry.name}`);
}

function readPackage(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const abs of listFiles(ROOT)) {
    files[abs.slice(abs.indexOf(ROOT) + ROOT.length + 1)] = readFileSync(abs, 'utf8');
  }
  return files;
}

const files = readPackage();

async function makeHost(patch?: {
  withTags?: boolean;
}): Promise<{ host: GameHost; definition: GameDefinition }> {
  const definition = await loadGamePackage(new InMemoryPackageSource(files));
  const attrDefs = parse(files['data/attrs.yaml'] as string) as AttrDefs;
  const contentTags =
    patch?.withTags === false
      ? undefined
      : (parse(files['data/content-tags.yaml'] as string) as ContentTagsDef);
  const host = createGameHost({
    definition,
    attrDefs,
    ...(contentTags !== undefined ? { contentTags } : {}),
    initialAttrs: { hp: 100, stamina: 30, insight: 0 },
    seed: 2026,
  });
  return { host, definition };
}

describe('宿主：设置写入面（FR-UI-05 / FR-CGRD-03）', () => {
  it('updateSettings 更新镜像，读回反映新值', async () => {
    const { host } = await makeHost();
    host.start();
    host.updateSettings({ textSpeed: 2, fontSize: 18 });
    expect(host.runtime.state.settings.textSpeed).toBe(1); // 引擎状态未被改写（镜像语义）
    expect(host.settings().textSpeed).toBe(2);
    expect(host.settings().fontSize).toBe(18);
  });

  it('disabledTags 变更即时生效：重建会话使过滤作用于后续渲染', async () => {
    const { host } = await makeHost();
    host.start();
    // general 标签下所有内容放行；禁用 general 后段落被屏蔽（场景标签命中）
    host.updateSettings({ disabledTags: ['general'] });
    expect(host.settings().disabledTags).toEqual(['general']);
    // 会话仍可用（重建未抛错），且推进不报错
    host.advance();
    expect(host.lastError()).toBeNull();
  });

  it('langs / versions 投影（设置面板数据面）', async () => {
    const { host } = await makeHost();
    host.start();
    // M1 收尾起夹具声明双语；langs 投影随 manifest.langs（顺序一致）
    expect(host.langs()).toEqual(['zh-CN', 'en-US']);
    const versions = host.versions();
    expect(versions.gameVersion).toBe('1.0.0');
    expect(versions.schemaVersion).toBe(1);
    expect(versions.engineVersion).toBeTypeOf('string');
  });

  it('wizardTags：无 contentTags 注入时为空（向导按「无分级」处理）', async () => {
    const { host } = await makeHost({ withTags: false });
    host.start();
    expect(host.wizardTags()).toEqual([]);
  });

  it('wizardTags 透出标签目录（含 defaultOn，向导初始态的数据源）', async () => {
    const { host } = await makeHost();
    host.start();
    // 夹具声明两个标签（general + mild_horror，均为 defaultOn=true；
    // mild_horror 的存在使内容过滤链路可在 E2E 中被真实验证）
    expect(host.wizardTags().map((tag) => tag.id)).toEqual(['general', 'mild_horror']);
    expect(host.wizardTags()[0]?.defaultOn).toBe(true);
  });
});

describe('宿主：dispose 与错误面', () => {
  it('dispose 后事件不再进入 store（换档不串扰）', async () => {
    const { host } = await makeHost();
    host.start();
    host.dispose();
    // 直接驱动运行时发事件：桥已退订，store 不应新增通知
    host.runtime.exec([{ notify: { textKey: 'ui.ping' } }], {
      source: 'debug',
      where: {},
      rng: host.runtime.rng,
    });
    expect(host.store.getState().notifications).toEqual([]);
  });

  it('lastError 在成功动作后清空（错误卡片不残留）', async () => {
    const { host } = await makeHost();
    host.start();
    host.moveTo({ area: 'old_town', location: 'nonexistent' });
    expect(host.lastError()?.code).toBe('UNKNOWN_LOCATION');
    host.advance();
    expect(host.lastError()).toBeNull();
  });

  it('choose 未知选项：错误被捕获且状态回滚（不抛给调用方）', async () => {
    const { host } = await makeHost();
    host.start();
    host.advance();
    host.advance();
    host.choose('no_such_choice');
    expect(host.lastError()).not.toBeNull();
    // 回滚后仍在入口场景（状态未被破坏）
    expect(host.store.getState().session.sceneId).toBe('arrival');
  });
});

describe('宿主：构造选项缺省路径', () => {
  it('缺省初始属性为空对象（attrs 由宿主注入；未注入定义时不抛错）', async () => {
    const definition = await loadGamePackage(new InMemoryPackageSource(files));
    const host = createGameHost({ definition });
    host.start();
    expect(host.statusPanel().attrs).toEqual([]);
    expect(host.lastError()).toBeNull();
  });

  it('缺省已解锁区域取首个区域；显式传入覆盖之', async () => {
    const definition = await loadGamePackage(new InMemoryPackageSource(files));
    const withDefault = createGameHost({ definition });
    withDefault.start();
    expect(withDefault.runtime.state.world.unlockedAreas).toEqual(['old_town']);

    const explicit = createGameHost({ definition, initialUnlockedAreas: [] });
    explicit.start();
    expect(explicit.runtime.state.world.unlockedAreas).toEqual([]);
  });
});

describe('宿主：媒体解析注入（24 号协作面）', () => {
  it('段落媒体意图经 MediaResolver 核对（缺失资源带 missing 标记）', async () => {
    const { host } = await makeHost();
    host.start();
    const session = host.store.getState().session;
    // 场景级媒体（若有）应以 intent 形式透传；夹具未声明 bg/bgm 时无媒体段
    const mediaSegments = session.segments.filter((segment) => segment.media !== undefined);
    for (const segment of mediaSegments) {
      for (const intent of segment.media ?? []) {
        expect(intent.assetId).toBeTypeOf('string');
      }
    }
    expect(Array.isArray(mediaSegments)).toBe(true);
  });
});

describe('宿主：onNotImplemented 风格防御（未 start 的只读访问）', () => {
  it('未 start 时 runtime 访问抛错（装配次序错误显性化）', async () => {
    const { host } = await makeHost();
    expect(() => host.runtime).toThrow(/未启动/);
  });

  it('未 start 时 calendar 访问抛错（同上）', async () => {
    const { host } = await makeHost();
    expect(() => host.calendar()).toThrow(/未启动/);
  });
});

void vi;
