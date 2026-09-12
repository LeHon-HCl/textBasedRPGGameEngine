import { InMemoryPackageSource } from '../../src/loader/source-memory.js';
import { loadGamePackage } from '../../src/loader/pipeline.js';
import type { GameDefinition, LoadGameOptions } from '../../src/loader/types.js';

/**
 * 06 号模块共用加载夹具：一个覆盖多域的最小合法游戏包（B2/B3/C 用例共享）。
 *
 * 结构：1 区域 2 地点、3 场景、3 事件（condition/random × 互斥组）、
 * 1 任务、1 成就、1 物品、1 商店、2 语言（zh-CN 主）、2 媒体资产。
 * 除目标缺陷注入外保持全绿（零 warning），使单缺陷断言精确定位。
 */

export const FIXTURE_MANIFEST = [
  'gameId: loader_fixture',
  'entryScene: arrival',
  'mainLang: zh-CN',
  'langs: [zh-CN, en-US]',
  'contentTags: []',
  'gameVersion: 1.0.0',
  'schemaVersion: 1',
  'minEngineVersion: 0.1.0',
  'redirects: {}',
  'credits: 06 号加载器测试夹具',
].join('\n');

export const FIXTURE_FILES: Record<string, string> = {
  'manifest.yaml': FIXTURE_MANIFEST,
  'data/attrs.yaml':
    'numeric:\n  hp: {min: 0, max: 100, init: 100, show: true}\n  insight: {min: 0, max: 20, init: 0, show: true}\nlevel: {}\nderived: {}',
  'data/areas/old_town.yaml': [
    'id: old_town',
    'nameKey: areas.old_town.name',
    'locations:',
    '  gate: {nameKey: areas.old_town.gate, unlockIf: "attr.insight >= 2", moveCost: 1, mapPos: [10, 20]}',
    '  market: {nameKey: areas.old_town.market, moveCost: 1, mapPos: [30, 40]}',
  ].join('\n'),
  'data/scenes/old_town/arrival.yaml': [
    'id: arrival',
    'area: old_town',
    'entry: {require: "flag.game_started"}',
    'segments:',
    '  - key: scenes.arrival.open',
    'choices:',
    '  - id: go_market',
    '    textKey: scenes.arrival.choice.go_market',
    '    showIf: "attr.stamina > 0"',
    '    goto: market_street',
  ].join('\n'),
  'data/scenes/old_town/market_street.yaml': [
    'id: market_street',
    'area: old_town',
    'segments:',
    '  - key: scenes.market_street.enter',
    'choices:',
    '  - id: back',
    '    textKey: scenes.market_street.choice.back',
    '    goto: arrival',
  ].join('\n'),
  'data/scenes/old_town/ev_whisper_scene.yaml': [
    'id: ev_whisper_scene',
    'area: old_town',
    'segments:',
    '  - key: scenes.ev_whisper_scene.open',
    'choices:',
    '  - id: done',
    '    textKey: scenes.ev_whisper_scene.choice.done',
    '    goto: market_street',
  ].join('\n'),
  'data/events.yaml': [
    '- id: ev_whisper',
    '  where: {area: old_town, location: gate}',
    '  when:',
    '    slots: [evening]',
    '  trigger:',
    '    type: condition',
    '    require: "flag.wall_seen && npc.guard.met"',
    '  priority: 10',
    '  mutexGroup: wall_line',
    '  scene: ev_whisper_scene',
    '- id: ev_rumor',
    '  where: {area: old_town, location: market}',
    '  when: {}',
    '  trigger:',
    '    type: random',
    '    weight: 5',
    '    require: "!flag.heard_rumor"',
    '    cooldown: {days: 2}',
    '  mutexGroup: wall_line',
    '  scene: ev_whisper_scene',
    '- id: ev_roam',
    '  where: {area: old_town}',
    '  when: {}',
    '  trigger:',
    '    type: explore',
    '    weight: 3',
    '  scene: market_street',
  ].join('\n'),
  'data/quests/wall_rubbing.yaml': [
    'id: wall_rubbing',
    'giver: guard',
    'acceptIf: "flag.heard_rumor"',
    'stages:',
    '  - id: inspect',
    '    objectiveKey: quests.wall_rubbing.obj',
    '    completeWhen: "flag.rubbing_taken"',
    'rewards:',
    '  - money: {town_silver: 20}',
  ].join('\n'),
  'data/npcs/guard.yaml': [
    'id: guard',
    'nameKey: npcs.guard.name',
    'schedule:',
    '  - at: {slots: [morning]}',
    '    location: gate',
  ].join('\n'),
  'data/items/warm_bun.yaml': [
    'id: warm_bun',
    'nameKey: items.warm_bun.name',
    'type: consumable',
    'stack: 5',
    'price: 5',
  ].join('\n'),
  'data/shops.yaml': [
    '- id: market_stall',
    '  nameKey: shops.market_stall.name',
    '  entries:',
    '    - {item: warm_bun, stock: 5}',
    '  priceBuy: "10"',
    '  priceSell: "4"',
  ].join('\n'),
  'data/achievements.yaml': [
    '- id: sharp_eye',
    '  nameKey: achievements.sharp_eye.name',
    '  when: "attr.insight >= 20"',
    '  points: 10',
    '  type: progress',
    '  progressExpr: "attr.insight"',
    '  goal: 20',
  ].join('\n'),
  'locales/zh-CN/scenes/arrival.yaml': 'open: 石板路口\nchoice:\n  go_market: 去集市',
  'locales/zh-CN/scenes/market_street.yaml': 'enter: 集市\nchoice:\n  back: 回去',
  'locales/zh-CN/scenes/ev_whisper_scene.yaml': 'open: 低语\nchoice:\n  done: 离开',
  'locales/zh-CN/areas/old_town.yaml': 'name: 旧镇\ngate: 镇口\nmarket: 集市',
  'locales/zh-CN/npcs/guard.yaml': 'name: 老卫兵',
  'locales/zh-CN/items/warm_bun.yaml': 'name: 热包子',
  'locales/zh-CN/shops/market_stall.yaml': 'name: 集市摊位',
  'locales/zh-CN/quests/wall_rubbing.yaml': 'obj: 辨认徽记',
  'locales/zh-CN/achievements/sharp_eye.yaml': 'name: 锐眼',
  'locales/en-US/scenes/arrival.yaml': 'open: The stone road\nchoice:\n  go_market: To the market',
  'locales/en-US/scenes/market_street.yaml': 'enter: Market\nchoice:\n  back: Back',
  'locales/en-US/scenes/ev_whisper_scene.yaml': 'open: Whisper\nchoice:\n  done: Leave',
  'locales/en-US/areas/old_town.yaml': 'name: Old Town\ngate: Gate\nmarket: Market',
  'locales/en-US/npcs/guard.yaml': 'name: Old Guard',
  'locales/en-US/items/warm_bun.yaml': 'name: Warm Bun',
  'locales/en-US/shops/market_stall.yaml': 'name: Market Stall',
  'locales/en-US/quests/wall_rubbing.yaml': 'obj: Read the mark',
  'locales/en-US/achievements/sharp_eye.yaml': 'name: Sharp Eye',
  'assets/bg_town.png': 'png:fake-town-bytes',
  'assets/media/cg_rain.png': 'png:fake-rain-bytes',
};

export function makeFixtureSource(
  overrides?: (files: Record<string, string>) => void,
): InMemoryPackageSource {
  const files = { ...FIXTURE_FILES };
  if (overrides !== undefined) overrides(files);
  return new InMemoryPackageSource(files);
}

/** 加载夹具（默认全绿）；注入缺陷的用例期望抛出，自行 try/catch */
export async function loadFixture(
  overrides?: (files: Record<string, string>) => void,
  options?: LoadGameOptions,
): Promise<GameDefinition> {
  return loadGamePackage(makeFixtureSource(overrides), options);
}
