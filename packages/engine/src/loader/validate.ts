import { z } from 'zod';
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
} from '@game/shared';
import type {
  AchievementDef,
  AreaDef,
  AttrDefs,
  BodyDef,
  ContentTagsDef,
  EndingDef,
  EventDef,
  FactionDef,
  GameId,
  ItemDef,
  Lang,
  LoopConfig,
  Manifest,
  NpcDef,
  PerkDef,
  QuestDef,
  SceneDef,
  ShopDef,
  StatsPageDef,
  TextKey,
} from '@game/shared';
import { PACKAGE_PATHS } from './collect.js';
import { mergeDiagnostics } from './diagnostics.js';
import type {
  CompiledScene,
  Diagnostic,
  LocalePack,
  LocaleRecord,
  LocaleValue,
  PackageDomains,
  ParsedPackage,
  ValidatedPackage,
} from './types.js';

/**
 * 管线步骤 3 validate（设计 §3.4「逐域 Zod + 重复 ID 检测」，NFR-12 单一
 * schema 来源、FR-L10N-02 语言包加载）。
 *
 * - 逐域 Zod 校验：schema 全部来自 shared（02 号，规则只有一份）；失败 →
 *   error 级 SCHEMA_INVALID（where.file 定位，detail 携带首个 issue）；
 * - 重复 ID → error 级 DUP_ID：跨文件域（scenes/areas/quests/npcs/items）、
 *   单文件数组域（events/factions/shops/achievements/perks/endings）、内容
 *   标签 id，以及 attrs 三个记录域之间的属性 id 重叠；
 * - 语言包：locales/<lang>/ 按命名空间目录镜像展开为键级 Map（FR-L10N-02）；
 *   仅加载 manifest.langs 声明的语言；声明语言缺少语言包（或主语言包零键）
 *   → warning（§3.4「主语言缺失键 → warning」，容错不阻断）；
 * - 未识别的 data/ 文件静默忽略（向前兼容后续数据域，如 P2 crafting）。
 */

// ---- 数据域文件约定（§10.4 游戏包结构） --------------------------------------

/** 单对象域：data/<name>.yaml → 一个定义对象 */
const SINGLE_FILE_DOMAINS = {
  'data/attrs.yaml': attrDefsSchema,
  'data/body.yaml': bodyDefSchema,
  'data/content-tags.yaml': contentTagsDefSchema,
  'data/stats-page.yaml': statsPageDefSchema,
  'data/loops.yaml': loopConfigSchema,
} as const;

/** 单文件数组域：data/<name>.yaml → 定义对象数组（域内重复 id 检测） */
const ARRAY_FILE_DOMAINS = {
  'data/events.yaml': eventDefSchema,
  'data/factions.yaml': factionDefSchema,
  'data/shops.yaml': shopDefSchema,
  'data/achievements.yaml': achievementDefSchema,
  'data/perks.yaml': perkDefSchema,
  'data/endings.yaml': endingDefSchema,
} as const;

/** 多文件实体域：data/<dir>/<file>.yaml → 每文件一个定义对象 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---- 诊断构造 ----------------------------------------------------------------

/** schema 校验失败的诊断（error 级，定位到文件与首个 issue） */
function schemaError(file: string, result: z.ZodError): Diagnostic {
  const issue = result.issues[0];
  const pathText =
    issue !== undefined && issue.path.length > 0 ? issue.path.map(String).join('.') : '';
  const at =
    pathText !== ''
      ? pathText
      : issue !== undefined && issue.code === 'unrecognized_keys'
        ? issue.keys.join(',')
        : '';
  return {
    severity: 'error',
    code: 'SCHEMA_INVALID',
    where: {
      file,
      phase: 'validate',
      messageKey: 'error.loader.schemaInvalid',
      ...(at !== '' ? { at } : {}),
      detail: issue !== undefined ? issue.message : '未知校验问题',
    },
  };
}

/** 重复 id 诊断（error 级 DUP_ID；files 为来源清单的逗号并联） */
function dupIdError(kind: string, id: string, files: readonly string[]): Diagnostic {
  return {
    severity: 'error',
    code: 'DUP_ID',
    where: {
      kind,
      id,
      files: files.join(','),
      phase: 'validate',
      messageKey: 'error.loader.dupId',
      detail: `${kind} id '${id}' 重复声明`,
    },
  };
}

/** parse 阶段是否已为该文件产出 error（避免同文件双报） */
function parseAlreadyReported(parsed: ParsedPackage, file: string): boolean {
  return parsed.diagnostics.some((d) => d.severity === 'error' && d.where['file'] === file);
}

// ---- 实体收集（Zod 校验 + 重复 id） -------------------------------------------

interface EntityInput {
  readonly file: string;
  readonly data: unknown;
}

/** 逐条目 Zod 校验并登记；跨条目重复 id → DUP_ID（重复方仍登记，管线随后阻断） */
function collectEntities<T extends { id: GameId }>(
  kind: string,
  entries: readonly EntityInput[],
  schema: z.ZodType,
  out: Map<GameId, T>,
  diagnostics: Diagnostic[],
): void {
  const seen = new Map<GameId, string[]>();
  for (const entry of entries) {
    const parsed = schema.safeParse(entry.data);
    if (!parsed.success) {
      diagnostics.push(schemaError(entry.file, parsed.error));
      continue;
    }
    const def = parsed.data as T;
    const files = seen.get(def.id) ?? [];
    files.push(entry.file);
    seen.set(def.id, files);
    out.set(def.id, def);
  }
  for (const [id, files] of seen) {
    if (files.length > 1) diagnostics.push(dupIdError(kind, id, files));
  }
}

/** 单文件数组域：整表校验（数组形态错误归文件）后逐条收集重复 id */
function collectArrayDomain<T extends { id: GameId }>(
  path: string,
  kind: string,
  itemSchema: z.ZodType,
  doc: unknown,
  out: Map<GameId, T>,
  diagnostics: Diagnostic[],
): void {
  const parsedList = z.array(itemSchema).safeParse(doc);
  if (!parsedList.success) {
    diagnostics.push(schemaError(path, parsedList.error));
    return;
  }
  const entries = (parsedList.data as T[]).map((data, index) => ({
    file: `${path}#${index}`,
    data,
  }));
  collectEntities(kind, entries, itemSchema, out, diagnostics);
}

/** 多文件实体域：目录下每文件一个定义对象（跨文件重复 id 检测） */
function collectPerFileDomain<T extends { id: GameId }>(
  kind: string,
  dir: string,
  schema: z.ZodType,
  out: Map<GameId, T>,
  docs: ReadonlyMap<string, unknown>,
  diagnostics: Diagnostic[],
): void {
  const entries: EntityInput[] = [];
  for (const [path, doc] of docs) {
    if (path.startsWith(dir)) entries.push({ file: path, data: doc });
  }
  collectEntities(kind, entries, schema, out, diagnostics);
}

// ---- 语言包（FR-L10N-02 命名空间目录镜像） ------------------------------------

/** 语言键值收敛：非字符串标量转字符串，数组逐元素收敛，记录由展开器递归 */
function toLocaleValue(value: unknown): LocaleValue | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(toLocaleValue).filter((item): item is LocaleValue => item !== undefined);
  }
  return undefined;
}

/**
 * 语言包文件路径 → 命名空间：locales/<lang>/ 之后的目录段 + 去扩展名文件名，
 * 以 '.' 连接（locales/zh-CN/scenes/arrival.yaml → 'scenes.arrival'）。
 */
function namespaceOf(lang: Lang, path: string): string {
  const prefix = `locales/${lang}/`;
  const under = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  return withoutExtension(under)
    .split('/')
    .filter((part) => part.length > 0)
    .join('.');
}

function withoutExtension(path: string): string {
  return path.replace(/\.(yaml|yml|json)$/i, '');
}

function flattenLocaleDoc(namespace: string, doc: unknown, out: Map<TextKey, LocaleValue>): void {
  if (!isRecord(doc)) return;
  for (const [key, value] of Object.entries(doc)) {
    const full = namespace.length === 0 ? key : `${namespace}.${key}`;
    if (isRecord(value)) {
      const structural = structuralTextValue(value);
      if (structural !== undefined) {
        out.set(full, structural);
        continue;
      }
      flattenLocaleDoc(full, value, out);
      continue;
    }
    const leaf = toLocaleValue(value);
    if (leaf !== undefined) out.set(full, leaf);
  }
}

// —— 结构文本值透传（§4.1「键值可为结构」/ FR-L10N-04，07 号文本解析器消费） ——

/** 文本值保留字（记录值顶层属性）：命中即整体透传，不再按命名空间展开 */
const RESERVED_TEXT_KEYS: readonly string[] = [
  'plural',
  'select',
  'first',
  'again',
  'if',
  'random',
];

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * 结构文本值识别：记录值含顶层保留字属性时视为结构值，整体透传不再按命名
 * 空间展开——`plural`/`select` 为复数/选择变体（§4.1 / FR-L10N-04，07 号
 * TextResolver 解释）；`first`/`again`/`if`/`random` 为叙事宏判别属性
 * （FR-NARR-04，08 号 narrative 宏展开解释，结构校验归宏解析器）。
 * 保留字为文本值专用——组织性嵌套命名应避用；普通记录（如 choice 分组）
 * 仍按命名空间展开为键级条目。
 */
function structuralTextValue(value: Record<string, unknown>): LocaleRecord | undefined {
  if (RESERVED_TEXT_KEYS.some((key) => hasOwnKey(value, key))) {
    return toStructuralRecord(value);
  }
  return undefined;
}

/** 结构文本值深转换：标量收敛规则同 toLocaleValue，嵌套记录保留结构 */
function toStructuralRecord(value: Record<string, unknown>): LocaleRecord {
  const out: Record<string, LocaleValue> = {};
  for (const [key, child] of Object.entries(value)) {
    const converted = toStructuralValue(child);
    if (converted !== undefined) out[key] = converted;
  }
  return out;
}

function toStructuralValue(value: unknown): LocaleValue | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(toStructuralValue).filter((item): item is LocaleValue => item !== undefined);
  }
  if (isRecord(value)) return toStructuralRecord(value);
  return undefined;
}

function buildLocalePack(
  lang: Lang,
  files: readonly string[],
  docs: ReadonlyMap<string, unknown>,
): LocalePack {
  const keys = new Map<TextKey, LocaleValue>();
  for (const path of files) {
    const doc = docs.get(path);
    if (doc === undefined) continue; // parse 失败文件已另有诊断
    flattenLocaleDoc(namespaceOf(lang, path), doc, keys);
  }
  return { lang, keys };
}

/** 声明语言缺少语言包（或主语言包零键）→ warning（§3.4 主语言缺失 warning） */
function localePackMissingWarning(lang: Lang, detail: string): Diagnostic {
  return {
    severity: 'warning',
    code: 'SCHEMA_INVALID',
    where: {
      lang,
      phase: 'validate',
      messageKey: 'error.loader.localePackMissing',
      detail,
    },
  };
}

// ---- validate 步骤入口 --------------------------------------------------------

/** validate 选项：lang = 优先加载语言（仅加载主语言与该语言，内存受限宿主用） */
export interface ValidateOptions {
  readonly lang?: Lang;
}

/** validate 步骤入口：逐域校验 + 重复 ID + 语言包编译（manifest 缺省域允许为 undefined） */
export function validatePackage(
  parsed: ParsedPackage,
  options: ValidateOptions = {},
): ValidatedPackage {
  const diagnostics: Diagnostic[] = [];
  const docs = parsed.docs;

  // —— manifest（包根，必需；parse 缺失/不可解析时已报，不双报） ——
  const manifestDoc = docs.get(PACKAGE_PATHS.manifest);
  const manifestParsed = manifestSchema.safeParse(manifestDoc);
  let manifest: Manifest | undefined;
  if (manifestParsed.success) {
    manifest = manifestParsed.data;
  } else if (manifestDoc !== undefined || !parseAlreadyReported(parsed, PACKAGE_PATHS.manifest)) {
    diagnostics.push(schemaError(PACKAGE_PATHS.manifest, manifestParsed.error));
  }

  const areas = new Map<GameId, AreaDef>();
  const scenes = new Map<GameId, CompiledScene>();
  const events = new Map<GameId, EventDef>();
  const quests = new Map<GameId, QuestDef>();
  const npcs = new Map<GameId, NpcDef>();
  const items = new Map<GameId, ItemDef>();
  const shops = new Map<GameId, ShopDef>();
  const achievements = new Map<GameId, AchievementDef>();
  const perks = new Map<GameId, PerkDef>();
  const endings = new Map<GameId, EndingDef>();
  const factions = new Map<GameId, FactionDef>();
  const locales = new Map<Lang, LocalePack>();
  let attrs: AttrDefs | undefined;
  let body: BodyDef | undefined;
  let contentTags: ContentTagsDef | undefined;
  let statsPage: StatsPageDef | undefined;
  let loop: LoopConfig | undefined;

  if (manifest !== undefined) {
    // —— 单文件对象域（缺省 = 空定义，schema 逐一装配） ——
    for (const [path, schema] of Object.entries(SINGLE_FILE_DOMAINS)) {
      const doc = docs.get(path);
      if (doc === undefined) continue;
      const result = (schema as z.ZodType).safeParse(doc);
      if (!result.success) {
        diagnostics.push(schemaError(path, result.error));
        continue;
      }
      if (path === 'data/attrs.yaml') attrs = result.data as AttrDefs;
      else if (path === 'data/body.yaml') body = result.data as BodyDef;
      else if (path === 'data/content-tags.yaml') contentTags = result.data as ContentTagsDef;
      else if (path === 'data/stats-page.yaml') statsPage = result.data as StatsPageDef;
      else if (path === 'data/loops.yaml') loop = result.data as LoopConfig;
    }

    // —— 单文件数组域 ——
    for (const [path, itemSchema] of Object.entries(ARRAY_FILE_DOMAINS)) {
      const doc = docs.get(path);
      if (doc === undefined) continue;
      const kind = withoutExtension(path.replace('data/', ''));
      if (path === 'data/events.yaml') {
        collectArrayDomain(path, kind, itemSchema as z.ZodType, doc, events, diagnostics);
      } else if (path === 'data/factions.yaml') {
        collectArrayDomain(path, kind, itemSchema as z.ZodType, doc, factions, diagnostics);
      } else if (path === 'data/shops.yaml') {
        collectArrayDomain(path, kind, itemSchema as z.ZodType, doc, shops, diagnostics);
      } else if (path === 'data/achievements.yaml') {
        collectArrayDomain(path, kind, itemSchema as z.ZodType, doc, achievements, diagnostics);
      } else if (path === 'data/perks.yaml') {
        collectArrayDomain(path, kind, itemSchema as z.ZodType, doc, perks, diagnostics);
      } else if (path === 'data/endings.yaml') {
        collectArrayDomain(path, kind, itemSchema as z.ZodType, doc, endings, diagnostics);
      }
    }

    // —— 多文件实体域 ——
    collectPerFileDomain('area', 'data/areas/', areaDefSchema, areas, docs, diagnostics);
    collectPerFileDomain('quest', 'data/quests/', questDefSchema, quests, docs, diagnostics);
    collectPerFileDomain('npc', 'data/npcs/', npcDefSchema, npcs, docs, diagnostics);
    collectPerFileDomain('item', 'data/items/', itemDefSchema, items, docs, diagnostics);

    // —— 场景（DD-02 目录聚合：validate 域 schema + 跨文件重复 id） ——
    const sceneSeen = new Map<GameId, string[]>();
    for (const [path, doc] of docs) {
      if (!path.startsWith('data/scenes/')) continue;
      const result = sceneDefSchema.safeParse(doc);
      if (!result.success) {
        diagnostics.push(schemaError(path, result.error));
        continue;
      }
      const def = result.data as SceneDef;
      const files = sceneSeen.get(def.id) ?? [];
      files.push(path);
      sceneSeen.set(def.id, files);
      scenes.set(def.id, { def, file: path });
    }
    for (const [id, files] of sceneSeen) {
      if (files.length > 1) diagnostics.push(dupIdError('scene', id, files));
    }

    // —— 内容标签 id 重复（FR-CGRD-01 标签集合唯一） ——
    if (contentTags !== undefined) {
      const tagSeen = new Map<GameId, number>();
      for (const tag of contentTags.tags) {
        tagSeen.set(tag.id, (tagSeen.get(tag.id) ?? 0) + 1);
      }
      for (const [id, count] of tagSeen) {
        if (count > 1) {
          diagnostics.push(dupIdError('contentTag', id, ['data/content-tags.yaml']));
        }
      }
    }

    // —— 属性 id 跨形态重叠（numeric/level/derived 记录键不可重复） ——
    if (attrs !== undefined) {
      const attrSeen = new Map<GameId, string>();
      const visitRecord = (record: Record<string, unknown>, shape: string): void => {
        for (const id of Object.keys(record)) {
          const first = attrSeen.get(id);
          if (first !== undefined) {
            diagnostics.push(dupIdError('attr', id, [first, `data/attrs.yaml#${shape}`]));
          } else {
            attrSeen.set(id, `data/attrs.yaml#${shape}`);
          }
        }
      };
      visitRecord(attrs.numeric, 'numeric');
      visitRecord(attrs.level, 'level');
      visitRecord(attrs.derived, 'derived');
    }

    // —— 语言包（FR-L10N-02）：仅加载 manifest.langs 声明的语言；
    // options.lang 优先时只加载主语言与该语言（未声明 → warning） ——
    let langsToLoad = manifest.langs;
    if (options.lang !== undefined && !manifest.langs.includes(options.lang)) {
      diagnostics.push({
        severity: 'warning',
        code: 'SCHEMA_INVALID',
        where: {
          lang: options.lang,
          phase: 'validate',
          messageKey: 'error.loader.langNotDeclared',
          detail: 'options.lang 未在 manifest.langs 声明，仅加载主语言',
        },
      });
      langsToLoad = [manifest.mainLang];
    } else if (options.lang !== undefined) {
      langsToLoad = manifest.langs.filter(
        (lang) => lang === manifest.mainLang || lang === options.lang,
      );
    }
    for (const lang of langsToLoad) {
      const files = parsed.collected.localeFiles.get(lang);
      if (files === undefined || files.length === 0) {
        diagnostics.push(
          localePackMissingWarning(
            lang,
            `manifest 声明的语言缺少 locales/${lang}/ 语言包（§3.4 主语言缺失 warning）`,
          ),
        );
        locales.set(lang, { lang, keys: new Map() });
        continue;
      }
      const pack = buildLocalePack(lang, files, docs);
      if (lang === manifest.mainLang && pack.keys.size === 0) {
        diagnostics.push(
          localePackMissingWarning(
            lang,
            `主语言 ${lang} 语言包存在但不含任何键（§3.4 主语言缺失 warning）`,
          ),
        );
      }
      locales.set(lang, pack);
    }
  }

  const domains: PackageDomains = {
    manifest,
    attrs,
    body,
    contentTags,
    statsPage,
    loop,
    areas,
    scenes,
    events: [...events.values()],
    quests,
    npcs,
    items,
    shops,
    achievements,
    perks,
    endings,
    factions,
  };

  return {
    parsed,
    domains,
    locales,
    diagnostics: mergeDiagnostics(parsed.diagnostics, diagnostics),
  };
}
