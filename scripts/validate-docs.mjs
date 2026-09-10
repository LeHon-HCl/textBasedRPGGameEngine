#!/usr/bin/env node
/**
 * 文档校验脚本（零依赖，Node 18+）
 *
 * AGENTS.md 约定：每次文档改动必须先通过本脚本再提交。
 * 用法：node scripts/validate-docs.mjs
 *
 * 检查项：
 *  1. 必需文档存在且非空，以一级标题开头
 *  2. 无遗留占位符（CONTINUE/TODO/FIXME/TBD/lorem 等）
 *  3. 代码围栏（```）配对闭合，mermaid 块非空
 *  4. 交叉引用一致性：文档中引用的 FR-xx、NFR-xx、OQ-xx、DD-xx 编号必须在其
 *     定义文档（proposal.md / detail-design.md）中存在
 *  5. 需求模块覆盖率：proposal 定义的每个 FR 模块（FR-XXX-01 等）必须
 *     至少被 detail-design.md 引用一次（模块级，保证设计无遗漏）
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED = ['docs/proposal.md', 'docs/detail-design.md'];
const DEFINITION_DOC = 'docs/proposal.md'; // FR/NFR/OQ 编号的权威定义处
const DESIGN_DOC = 'docs/detail-design.md';

let failed = false;
const fail = (msg) => { failed = true; console.error('  ✗ ' + msg); };
const pass = (msg) => console.log('  ✓ ' + msg);

function readDoc(rel) {
  const abs = join(process.cwd(), rel);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8');
}

const docs = {};
for (const rel of REQUIRED) {
  const text = readDoc(rel);
  if (text === null) { fail(`缺少必需文档 ${rel}`); continue; }
  if (text.trim().length < 200) { fail(`${rel} 内容过短（<200 字符）`); continue; }
  docs[rel] = text;
}
if (docs['docs/proposal.md']) pass('必需文档存在且非空');

for (const [rel, text] of Object.entries(docs)) {
  if (!/^#\s+\S/.test(text)) fail(`${rel} 未以一级标题开头`);
  const fences = (text.match(/^```/gm) || []).length;
  if (fences % 2 !== 0) fail(`${rel} 代码围栏不配对（${fences} 个 \`\`\`）`);
  if (/```mermaid\s*\n\s*```/.test(text)) fail(`${rel} 存在空的 mermaid 块`);
  const m = text.match(/CONTINUE|TODO|FIXME|TBD|lorem ipsum/i);
  if (m) fail(`${rel} 存在遗留占位符：「${m[0]}」`);
}
if (!failed) pass('标题/围栏/占位符检查通过');

// ---- 编号提取与交叉引用 ----
const FR_RE = /\bFR-[A-Z0-9]+-\d+\b/g;
const NFR_RE = /\bNFR-\d+\b/g;
const OQ_RE = /\bOQ-\d+\b/g;
const DD_RE = /\bDD-\d+\b/g;
const idsIn = (text, re) => new Set(text.match(re) || []);

const proposal = docs[DEFINITION_DOC] ?? '';
const defined = {
  fr: idsIn(proposal, FR_RE),
  nfr: idsIn(proposal, NFR_RE),
  oq: idsIn(proposal, OQ_RE),
};

for (const [rel, text] of Object.entries(docs)) {
  for (const id of idsIn(text, FR_RE)) if (!defined.fr.has(id)) fail(`${rel} 引用了不存在的 ${id}`);
  for (const id of idsIn(text, NFR_RE)) if (!defined.nfr.has(id)) fail(`${rel} 引用了不存在的 ${id}`);
  for (const id of idsIn(text, OQ_RE)) if (!defined.oq.has(id)) fail(`${rel} 引用了不存在的 ${id}`);
}
if (!failed) pass('FR/NFR/OQ 交叉引用一致');

// DD 编号在 detail-design 内自洽（定义表引用的必须存在）
if (docs[DESIGN_DOC]) {
  const design = docs[DESIGN_DOC];
  const ddIds = idsIn(design, DD_RE);
  if (ddIds.size === 0) fail(`${DESIGN_DOC} 未定义任何 DD-* 设计决策`);
  for (const id of ddIds) {
    if (!new RegExp(`^\\|\\s*${id}\\b`, 'm').test(design))
      fail(`${DESIGN_DOC} 引用了未在决策表中登记的 ${id}`);
  }
  if (!failed) pass(`DD 设计决策自洽（${ddIds.size} 个）`);

  // FR 模块覆盖率：proposal 的每个模块至少被设计文档引用一次
  const designFrs = idsIn(design, FR_RE);
  const modules = new Set([...defined.fr].map((id) => id.replace(/-\d+$/, '')));
  const missing = [...modules].filter((mod) => ![...designFrs].some((id) => id.startsWith(mod + '-')));
  if (missing.length) fail(`${DESIGN_DOC} 未覆盖需求模块：${missing.join(', ')}`);
  else pass(`FR 模块覆盖率 100%（${modules.size} 个模块）`);
}

console.log(failed ? '\n校验失败：请修复上述问题后再提交。' : '\n文档校验全部通过。');
process.exit(failed ? 1 : 0);
