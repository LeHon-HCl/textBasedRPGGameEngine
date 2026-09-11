import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  achievementDefSchema,
  areaDefSchema,
  attrDefsSchema,
  bodyDefSchema,
  contentTagsDefSchema,
  endingDefSchema,
  eventDefSchema,
  factionDefSchema,
  itemDefSchema,
  loopConfigSchema,
  manifestSchema,
  npcDefSchema,
  perkDefSchema,
  questDefSchema,
  sceneDefSchema,
  shopDefSchema,
  statsPageDefSchema,
} from '../../src/index.js';

/**
 * mini-game 夹具 × schema 全域正例校验（02 任务 C1）：
 * fixtures/mini-game 的每个数据域文件必须通过对应 Zod schema（设计 §2.4），
 * 并做少量跨域一致性抽检（完整 crossRef 归 06 号加载器，§3.4 步骤 4）。
 */

const ROOT = 'fixtures/mini-game';

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`);
}

const yamlFiles = listFiles(ROOT)
  .filter((file) => file.endsWith('.yaml'))
  .sort();
const parsed = new Map(
  yamlFiles.map((file) => [file, parse(readFileSync(file, 'utf8')) as unknown]),
);

function parseArray<T>(schema: { parse: (v: unknown) => T }, file: string): T[] {
  const data = parsed.get(file);
  expect(data, `夹具文件 ${file} 应存在且为列表`).toEqual(expect.any(Array));
  return (data as unknown[]).map((entry) => schema.parse(entry));
}

describe('fixtures/mini-game × schema 全域正例（02 任务 C1，FR-L10N-02/DD-02）', () => {
  it('manifest.yaml 通过 manifestSchema', () => {
    expect(manifestSchema.parse(parsed.get(`${ROOT}/manifest.yaml`))).toMatchObject({
      gameId: 'mini_game',
      schemaVersion: 1,
      mainLang: 'zh-CN',
    });
  });

  it('data/attrs.yaml 通过 attrDefsSchema（numeric/level/derived 三形态）', () => {
    const attrs = attrDefsSchema.parse(parsed.get(`${ROOT}/data/attrs.yaml`));
    expect(Object.keys(attrs.numeric)).toContain('insight');
  });

  it('data/areas/*.yaml 通过 areaDefSchema', () => {
    const areas = yamlFiles.filter((f) => f.startsWith(`${ROOT}/data/areas/`));
    expect(areas).toHaveLength(1);
    for (const file of areas) {
      const area = areaDefSchema.parse(parsed.get(file));
      expect(Object.keys(area.locations)).toEqual(['market', 'gate']);
    }
  });

  it('data/scenes/**/*.yaml 全部通过 sceneDefSchema（5 场景，goto 引用跳转）', () => {
    const sceneFiles = yamlFiles.filter((f) => f.includes('/data/scenes/'));
    expect(sceneFiles).toHaveLength(5);
    for (const file of sceneFiles) {
      const scene = sceneDefSchema.parse(parsed.get(file));
      expect(scene.area).toBe('old_town');
    }
    const withGoto = sceneFiles.some((file) => {
      const scene = parsed.get(file) as { choices?: Array<{ goto?: unknown }> };
      return (scene.choices ?? []).some((choice) => typeof choice['goto'] === 'string');
    });
    expect(withGoto).toBe(true);
  });

  it('data/events.yaml 通过 eventDefSchema（condition + random 两型）', () => {
    const events = parseArray(eventDefSchema, `${ROOT}/data/events.yaml`);
    expect(events.map((e) => e.trigger.type)).toEqual(['condition', 'random']);
  });

  it('data/quests/*.yaml 通过 questDefSchema', () => {
    const questFiles = yamlFiles.filter((f) => f.startsWith(`${ROOT}/data/quests/`));
    expect(questFiles).toHaveLength(1);
    const quest = questDefSchema.parse(parsed.get(questFiles[0] as string));
    expect(quest.stages).toHaveLength(2);
    expect(quest.rewards).toHaveLength(2);
  });

  it('data/npcs/*.yaml 通过 npcDefSchema（日程 + 好感阈值 / 最简形态）', () => {
    const npcFiles = yamlFiles.filter((f) => f.startsWith(`${ROOT}/data/npcs/`));
    expect(npcFiles).toHaveLength(2);
    for (const file of npcFiles) {
      const npc = npcDefSchema.parse(parsed.get(file));
      expect(npc.nameKey).toBeTruthy();
    }
    const guard = npcDefSchema.parse(parsed.get(`${ROOT}/data/npcs/old_guard.yaml`));
    expect(guard.favor?.max).toBeGreaterThanOrEqual(guard.favor?.min ?? 0);
  });

  it('data/factions.yaml 通过 factionDefSchema', () => {
    const factions = parseArray(factionDefSchema, `${ROOT}/data/factions.yaml`);
    expect(factions[0]?.thresholds).toHaveLength(2);
  });

  it('data/items/*.yaml 通过 itemDefSchema（消耗品 + 服装）', () => {
    const itemFiles = yamlFiles.filter((f) => f.startsWith(`${ROOT}/data/items/`));
    expect(itemFiles).toHaveLength(2);
    const types = itemFiles.map((file) => itemDefSchema.parse(parsed.get(file)).type);
    expect([...types].sort()).toEqual(['consumable', 'garment']);
  });

  it('data/body.yaml 通过 bodyDefSchema（parts + pronouns）', () => {
    const body = bodyDefSchema.parse(parsed.get(`${ROOT}/data/body.yaml`));
    expect(body.parts.ears?.default).toBe('normal');
    expect(body.pronouns?.rule).toBe('by_part');
  });

  it('data/shops.yaml 通过 shopDefSchema', () => {
    const shops = parseArray(shopDefSchema, `${ROOT}/data/shops.yaml`);
    expect(shops[0]?.entries).toHaveLength(2);
  });

  it('data/achievements.yaml 通过 achievementDefSchema（normal + progress）', () => {
    const achievements = parseArray(achievementDefSchema, `${ROOT}/data/achievements.yaml`);
    expect(achievements.map((a) => a.type)).toEqual(['normal', 'progress']);
  });

  it('data/perks.yaml 通过 perkDefSchema', () => {
    const perks = parseArray(perkDefSchema, `${ROOT}/data/perks.yaml`);
    expect(perks[0]?.effects.length).toBeGreaterThan(0);
  });

  it('data/endings.yaml 通过 endingDefSchema（nextLoop + galleryInfo）', () => {
    const endings = parseArray(endingDefSchema, `${ROOT}/data/endings.yaml`);
    expect(endings[0]?.nextLoop).toBe(true);
  });

  it('data/loops.yaml 通过 loopConfigSchema（policy 五形态抽检）', () => {
    const loop = loopConfigSchema.parse(parsed.get(`${ROOT}/data/loops.yaml`));
    expect(loop.inherit?.flags).toEqual({ whitelist: ['heard_rumor', 'wall_rubbing_taken'] });
    expect(loop.inherit?.items).toEqual({ keepRatio: 'wallet.town_silver * 0.1' });
    expect(loop.reset?.body).toBe('reset');
  });

  it('data/content-tags.yaml 通过 contentTagsDefSchema 且被 manifest 引用（FR-CGRD-01）', () => {
    const tags = contentTagsDefSchema.parse(parsed.get(`${ROOT}/data/content-tags.yaml`));
    const manifest = parsed.get(`${ROOT}/manifest.yaml`) as { contentTags?: string[] };
    const tagIds = tags.tags.map((t) => t.id);
    for (const ref of manifest.contentTags ?? []) {
      expect(tagIds).toContain(ref);
    }
  });

  it('data/stats-page.yaml 通过 statsPageDefSchema', () => {
    const page = statsPageDefSchema.parse(parsed.get(`${ROOT}/data/stats-page.yaml`));
    expect(page.groups[0]?.entries).toHaveLength(3);
  });

  it('跨域一致性抽检：事件场景 / 任务发布者 / 商店商品 / 周目开局场景均可解析（完整 crossRef 归 06 号）', () => {
    const sceneIds = new Set(
      yamlFiles
        .filter((f) => f.includes('/data/scenes/'))
        .map((f) => (parsed.get(f) as { id: string }).id),
    );
    const npcIds = new Set(
      yamlFiles
        .filter((f) => f.startsWith(`${ROOT}/data/npcs/`))
        .map((f) => (parsed.get(f) as { id: string }).id),
    );
    const itemIds = new Set(
      yamlFiles
        .filter((f) => f.startsWith(`${ROOT}/data/items/`))
        .map((f) => (parsed.get(f) as { id: string }).id),
    );

    const events = parseArray(eventDefSchema, `${ROOT}/data/events.yaml`);
    for (const event of events) expect(sceneIds.has(event.scene)).toBe(true);

    const quest = questDefSchema.parse(parsed.get(`${ROOT}/data/quests/wall_rubbing.yaml`));
    expect(quest.giver === undefined || npcIds.has(quest.giver)).toBe(true);

    const shops = parseArray(shopDefSchema, `${ROOT}/data/shops.yaml`);
    for (const shop of shops) {
      for (const entry of shop.entries) expect(itemIds.has(entry.item)).toBe(true);
    }

    const loop = loopConfigSchema.parse(parsed.get(`${ROOT}/data/loops.yaml`));
    expect(sceneIds.has(loop.openingScene)).toBe(true);
  });

  it('全部夹具数据的表达式字段为非空字符串且括号配平（编译校验归 03 号，DD-01）', () => {
    const EXPR_KEYS = new Set([
      'showIf',
      'unlockIf',
      'require',
      'completeWhen',
      'acceptIf',
      'failWhen',
      'reachWhen',
      'progressExpr',
      'priceBuy',
      'priceSell',
      'keepRatio',
      'formula',
    ]);
    const exprs: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node !== null && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (EXPR_KEYS.has(key) && typeof value === 'string') exprs.push(value);
          else walk(value);
        }
      }
    };
    for (const file of yamlFiles.filter((f) => f.includes('/data/'))) {
      walk(parsed.get(file));
    }
    expect(exprs.length).toBeGreaterThanOrEqual(10);
    for (const expr of exprs) {
      expect(expr.length, `表达式非空：${expr}`).toBeGreaterThan(0);
      let depth = 0;
      for (const ch of expr) {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        expect(depth, `括号配平：${expr}`).toBeGreaterThanOrEqual(0);
      }
      expect(depth, `括号配平：${expr}`).toBe(0);
    }
  });
});
