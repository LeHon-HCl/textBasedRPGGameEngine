#!/usr/bin/env node
/**
 * JSON Schema 快照基线再生成（维护工具）。
 *
 * 用途：schema 发生**批准的**变更（新增可选字段、勘误补齐等）后，重新生成
 * `test/schema/__json_snapshots__/` 下的基线文件，供 `json-schema-snapshot.test.ts`
 * 的「只增不改」守护比对（NFR-12/15，02 任务 C2）。
 *
 * 使用前置：必须先构建（读取 dist 的编译产物，保证与运行时同一份 schema）
 *   pnpm --filter @game/shared build
 *   pnpm --filter @game/shared schema:baselines
 *
 * 输出经 Prettier 归一化（仓库基线为 Prettier 格式；不归一化会产生纯格式噪音 diff）。
 *
 * 纪律：基线更新必须与触发它的 schema 变更**同一个 PR** 评审提交；破坏性变更
 * （字段删除/变必填/类型收窄）不允许通过本工具掩盖，须走 schemaVersion 升级与
 * 迁移方案（DD-07 / FR-MIGR-01）。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  achievementDefSchema, areaDefSchema, attrDefsSchema, bodyDefSchema,
  contentTagsDefSchema, effectDataSchema, endingDefSchema, eventDefSchema,
  factionDefSchema, itemDefSchema, loopConfigSchema, manifestSchema,
  npcDefSchema, perkDefSchema, profileSchema, questDefSchema, saveBlobSchema,
  sceneDefSchema, serializedStateSchema, shopDefSchema, statsPageDefSchema,
  timeConfigSchema,
} from '../dist/index.js';

/** schema 名称 → schema 实例（与 json-schema-snapshot.test.ts 的 CASES 同集同序） */
const CASES = {
  manifest: manifestSchema,
  effects: effectDataSchema,
  attrs: attrDefsSchema,
  scene: sceneDefSchema,
  area: areaDefSchema,
  event: eventDefSchema,
  quest: questDefSchema,
  npc: npcDefSchema,
  faction: factionDefSchema,
  item: itemDefSchema,
  body: bodyDefSchema,
  shop: shopDefSchema,
  achievement: achievementDefSchema,
  perk: perkDefSchema,
  ending: endingDefSchema,
  loop: loopConfigSchema,
  'content-tags': contentTagsDefSchema,
  'stats-page': statsPageDefSchema,
  'serialized-state': serializedStateSchema,
  'save-blob': saveBlobSchema,
  profile: profileSchema,
  time: timeConfigSchema,
};

const snapshotDir = join(dirname(fileURLToPath(import.meta.url)), '../test/schema/__json_snapshots__');
mkdirSync(snapshotDir, { recursive: true });

const stale = new Set(readdirSync(snapshotDir));
for (const [name, schema] of Object.entries(CASES)) {
  writeFileSync(`${snapshotDir}/${name}.json`, `${JSON.stringify(z.toJSONSchema(schema, { io: 'input' }), null, 2)}\n`);
  stale.delete(`${name}.json`);
}

console.log(`已再生成 ${Object.keys(CASES).length} 份基线；无对应 schema 的陈旧文件：${[...stale].join(', ') || '无'}`);
if (stale.size > 0) {
  console.error('警告：存在无主基线文件，请确认是否应删除（本工具不自动删除）。');
}

// 归一化格式（仓库基线为 Prettier 风格；失败仅告警，由提交者手工执行）
try {
  execSync(`pnpm exec prettier --write "${snapshotDir}"`, { stdio: 'inherit' });
} catch {
  console.error(`警告：Prettier 归一化失败，请手工执行 \`pnpm exec prettier --write "${snapshotDir}"\``);
}
