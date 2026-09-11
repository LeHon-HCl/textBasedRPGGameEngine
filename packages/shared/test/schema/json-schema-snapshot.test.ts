import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  achievementDefSchema,
  areaDefSchema,
  attrDefsSchema,
  bodyDefSchema,
  contentTagsDefSchema,
  effectDataSchema,
  endingDefSchema,
  eventDefSchema,
  factionDefSchema,
  itemDefSchema,
  loopConfigSchema,
  manifestSchema,
  npcDefSchema,
  perkDefSchema,
  profileSchema,
  questDefSchema,
  saveBlobSchema,
  sceneDefSchema,
  serializedStateSchema,
  shopDefSchema,
  statsPageDefSchema,
} from '../../src/index.js';

/**
 * Schema 快照守护（02 任务 C2，NFR-12/15「只增不改」的机械化守护）：
 *
 * 对全部数据域 schema 生成 JSON Schema（zod v4 z.toJSONSchema，输入面 io=input），
 * 与 test/schema/__json_snapshots__/ 下的基线做结构化深比较。未来任何对字段、
 * 类型、可选性、refKind 元数据的破坏性变更都会使比较变红：
 * - 只增不改：新增字段只允许以可选形态追加（required 数组变化同样红）；
 * - 废弃字段保留一个版本周期并在校验器中警告（NFR-15），期间基线保持不变；
 * - 破坏性变更必须升级 schemaVersion（DD-07）并附带迁移方案（FR-MIGR-01），
 *   基线更新须随这类变更一起评审提交；
 * - 基线为已提交文件且按语义比较（格式化工具重排不改判），refKind 引用标注
 *   （§2.1）一并受守护——21 号迁移改写依赖该元数据不被遗失。
 */

const SNAPSHOT_DIR = join(import.meta.dirname, '__json_snapshots__');

const CASES: ReadonlyArray<[name: string, schema: z.ZodType]> = [
  ['manifest', manifestSchema],
  ['effects', effectDataSchema],
  ['attrs', attrDefsSchema],
  ['scene', sceneDefSchema],
  ['area', areaDefSchema],
  ['event', eventDefSchema],
  ['quest', questDefSchema],
  ['npc', npcDefSchema],
  ['faction', factionDefSchema],
  ['item', itemDefSchema],
  ['body', bodyDefSchema],
  ['shop', shopDefSchema],
  ['achievement', achievementDefSchema],
  ['perk', perkDefSchema],
  ['ending', endingDefSchema],
  ['loop', loopConfigSchema],
  ['content-tags', contentTagsDefSchema],
  ['stats-page', statsPageDefSchema],
  ['serialized-state', serializedStateSchema],
  ['save-blob', saveBlobSchema],
  ['profile', profileSchema],
];

describe('schema JSON Schema 快照守护（NFR-12/15，02 任务 C2）', () => {
  it('全部 21 份 schema 均可生成 JSON Schema（结构可导出，编辑器表单生成的数据前提）', () => {
    expect(CASES).toHaveLength(21);
    for (const [, schema] of CASES) {
      expect(() => z.toJSONSchema(schema, { io: 'input' })).not.toThrow();
    }
  });

  for (const [name, schema] of CASES) {
    it(`${name} 的 JSON Schema 与基线一致`, () => {
      const generated = z.toJSONSchema(schema, { io: 'input' });
      const baselineText = readFileSync(`${SNAPSHOT_DIR}/${name}.json`, 'utf8');
      expect(JSON.parse(JSON.stringify(generated))).toEqual(JSON.parse(baselineText));
    });
  }
});
