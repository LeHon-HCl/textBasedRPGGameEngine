import { z } from 'zod';
import { effectDataSchema, effectParamSchemas, exprSchema } from '@game/shared';
import type { ExprNode, ExprSource, RefKind } from '@game/shared';
import {
  achievementDefSchema,
  areaDefSchema,
  attrDefsSchema,
  bodyDefSchema,
  contentTagsDefSchema,
  encounterDefSchema,
  enemyDefSchema,
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
import type { PackageDomains } from './types.js';

/**
 * schema 元数据驱动的包内容盘点（06 任务 B1，设计 §3.4 步骤 4「refKind 元
 * 数据驱动」/ §2.1 refId 约定）。
 *
 * 遍历「域 schema × 已解析数据」对，抽出三类位点——引用字段沿 zod
 * globalRegistry 的 refKind 元数据识别（§2.1 refId 辅助器登记，规则只有一份），
 * 表达式字段沿 exprSchema 的 schema 身份识别（exprOrNumber 联合中字符串恒为
 * 表达式；exprOrLiteral 的宽松字符串不在此列，由指令执行期 evalSource 裁决），
 * call 指令沿 effectParamSchemas.call 身份识别（x.* 存在性校验归 scripts 步骤，
 * FR-SCR-04）：
 * - {@link PackageInventory.refs} → crossRef 步骤悬空引用检查；
 * - {@link PackageInventory.exprs} → compile 步骤表达式编译入缓存；
 * - {@link PackageInventory.calls} → scripts 步骤 x.* 指令存在性核对。
 */

/** 引用位点（RefKind 全集见 shared §2.1） */
export interface RefSite {
  readonly kind: RefKind;
  readonly value: string;
  /** 数据路径（如 'scenes[arrival].choices[0].goto'），诊断定位用 */
  readonly dataPath: string;
  /** location 引用的作用域区域（事件 where.location 限定在其 where.area 内） */
  readonly scopeArea?: string;
}

/** 表达式位点（requirePure = 缓存敏感位置，如事件 require，DD-01） */
export interface ExprSite {
  readonly source: ExprSource;
  readonly dataPath: string;
  readonly requirePure: boolean;
}

/** call 指令位点（DD-08：fn 'x.<script>.<name>'） */
export interface CallSite {
  readonly fn: string;
  readonly dataPath: string;
}

/**
 * 效果指令位点（develop.md 约束 8；设计 §7.7 `invalid-instruction-arg`）。
 *
 * 抽取「数据结构里出现的每一条 effect」（指令 id + 已通过 schema 校验的参数 +
 * 数据路径），供加载期跑各指令注册表的 `validateArg` 语义校验。
 * 为什么在 walker 里抽：它已是「域 schema × 数据」的单遍遍历，effect 位点
 * 与 refs/exprs/calls 同源——避免为校验再扫一遍 YAML 树。
 */
export interface EffectSite {
  readonly id: string;
  readonly arg: unknown;
  readonly dataPath: string;
}

/**
 * 包内容盘点结果（设计 §3.4 步骤 4-6 的共享数据源；06 号）。
 *
 * 单遍遍历「域 schema × 已解析数据」抽出三类位点：`refs`（引用，供 crossRef 悬空
 * 检查）、`exprs`（表达式，供 compile 编译入缓存）、`calls`（`x.*` 调用，供
 * scripts 步骤核对）。三类位点共用一次遍历，避免各步骤各扫一遍 YAML 树。
 */
export interface PackageInventory {
  readonly refs: readonly RefSite[];
  readonly exprs: readonly ExprSite[];
  readonly calls: readonly CallSite[];
  /** 效果指令位点（约束 8：加载期 validateArg 语义校验的输入） */
  readonly effects: readonly EffectSite[];
}

/** zod v4 运行时 def 的访问面（walker 只依赖本结构） */
interface ZodDefLike {
  readonly type: string;
  readonly innerType?: z.ZodType;
  readonly getter?: () => z.ZodType;
  readonly element?: z.ZodType;
  readonly keyType?: z.ZodType;
  readonly valueType?: z.ZodType;
  readonly options?: readonly z.ZodType[];
  readonly discriminator?: string;
  /** z.literal 的允许值集合（zod v4：def.values） */
  readonly values?: unknown;
}

interface Wip {
  refs: RefSite[];
  exprs: ExprSite[];
  calls: CallSite[];
  effects: EffectSite[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defOf(schema: z.ZodType): ZodDefLike {
  return (schema as unknown as { _def: ZodDefLike })._def;
}

function shapeOf(schema: z.ZodType): Readonly<Record<string, z.ZodType>> {
  const shape = (schema as unknown as { shape?: Record<string, z.ZodType> }).shape;
  return shape ?? {};
}

function joinKey(path: string, key: string): string {
  return path.length === 0 ? key : `${path}.${key}`;
}

/** 联合是否「表达式安全」：exprSchema 之外的全部选项都只收数值（exprOrNumber 形态） */
function isExprSafeUnion(options: readonly z.ZodType[]): boolean {
  return options.every((option) => option === exprSchema || defOf(option).type === 'number');
}

/** 事件 require 是缓存敏感位置（DD-01：pure=false 函数禁入事件 require） */
function isRequireSensitivePath(path: string): boolean {
  return path.endsWith('.trigger.require');
}

/**
 * 效果指令位点收集（约束 8）：抽出「单键 id + 参数」。
 *
 * 调用点已确认 schema 是 effectDataSchema（见 union 分支），此处按结构取值：
 * 恰一个键，键即指令 id。键不在 effectParamSchemas 时跳过（未知指令由 schema
 * 校验与 scripts 步骤各自负责，避免重复诊断）。
 */
function maybeCollectEffect(data: unknown, path: string, out: Wip): void {
  if (!isRecord(data)) return;
  const keys = Object.keys(data);
  if (keys.length !== 1) return;
  const id = keys[0] as string;
  if (!(id in effectParamSchemas)) return;
  out.effects.push({ id, arg: data[id], dataPath: path });
}

/** 单遍遍历：refKind 元数据、exprSchema 身份与 call 指令同趟收集 */
function walk(schema: z.ZodType, data: unknown, path: string, out: Wip): void {
  if (data === undefined || data === null) return;
  const def = defOf(schema);
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly': {
      if (def.innerType !== undefined) walk(def.innerType, data, path, out);
      return;
    }
    case 'lazy': {
      if (def.getter !== undefined) walk(def.getter(), data, path, out);
      return;
    }
    case 'string': {
      if (typeof data !== 'string') return;
      if (schema === exprSchema) {
        out.exprs.push({ source: data, dataPath: path, requirePure: isRequireSensitivePath(path) });
        return;
      }
      const meta = z.globalRegistry.get(schema) as { refKind?: RefKind } | undefined;
      if (meta !== undefined && typeof meta.refKind === 'string') {
        out.refs.push({ kind: meta.refKind, value: data, dataPath: path });
      }
      return;
    }
    case 'object': {
      if (schema === effectParamSchemas.call) {
        const fn = (data as { fn?: unknown }).fn;
        if (typeof fn === 'string') out.calls.push({ fn, dataPath: path });
      }
      if (!isRecord(data)) return;
      for (const [key, child] of Object.entries(shapeOf(schema))) {
        walk(child, data[key], joinKey(path, key), out);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(data) || def.element === undefined) return;
      const element = def.element;
      data.forEach((item, index) => walk(element, item, `${path}[${index}]`, out));
      return;
    }
    case 'record': {
      if (!isRecord(data)) return;
      for (const [key, value] of Object.entries(data)) {
        if (def.keyType !== undefined) walk(def.keyType, key, joinKey(path, `<key:${key}>`), out);
        if (def.valueType !== undefined) walk(def.valueType, value, joinKey(path, key), out);
      }
      return;
    }
    case 'union': {
      const options = def.options ?? [];
      const discriminator = def.discriminator;
      let matched: z.ZodType | undefined;
      if (discriminator !== undefined && isRecord(data)) {
        const discValue = data[discriminator];
        matched = options.find((option) => {
          const literal = shapeOf(option)[discriminator];
          if (literal === undefined) return false;
          const values = defOf(literal).values;
          return Array.isArray(values) ? values.includes(discValue) : values === discValue;
        });
      }
      if (matched === undefined && isRecord(data)) {
        const keys = Object.keys(data);
        if (keys.length === 1) {
          const key = keys[0];
          matched = options.find((option) => key !== undefined && key in shapeOf(option));
        }
      }
      if (matched === undefined) {
        matched = options.find((option) => option.safeParse(data).success);
      }
      if (matched === undefined) return;
      // 效果指令位点（约束 8）：effectDataSchema 是**普通 union**（非 discriminated），
      // 其成员形态为「单键对象，键 = 指令 id」。命中后此处按 schema 身份记录位点
      // ——不能在 object 分支判（那里递归进来的是 matched 成员 schema，已非 union）。
      if (schema === effectDataSchema) {
        maybeCollectEffect(data, path, out);
      }
      // 宽松字符串联合（exprOrLiteral：字符串可能是字面量）不下探表达式识别
      if (typeof data === 'string' && matched === exprSchema && !isExprSafeUnion(options)) {
        return;
      }
      walk(matched, data, path, out);
      return;
    }
    default:
      return; // number / boolean / literal / enum / tuple 等无引用与表达式位点
  }
}

/** AST 扫描：收集表达式中引用的 x.* 函数名（scripts 步骤存在性核对的数据源） */
export function collectXFunctionCalls(ast: ExprNode, out: Set<string>): void {
  switch (ast.kind) {
    case 'call':
      if (ast.name.startsWith('x.')) out.add(ast.name);
      for (const arg of ast.args) collectXFunctionCalls(arg, out);
      return;
    case 'unary':
      collectXFunctionCalls(ast.operand, out);
      return;
    case 'binary':
      collectXFunctionCalls(ast.left, out);
      collectXFunctionCalls(ast.right, out);
      return;
    case 'cond':
      collectXFunctionCalls(ast.test, out);
      collectXFunctionCalls(ast.then, out);
      collectXFunctionCalls(ast.else, out);
      return;
    default:
      return;
  }
}

/**
 * 盘点入口：对全部数据域跑「schema × 数据」遍历（管线在 validate 后调用一次，
 * 结果分别供 crossRef / compile / scripts 消费）。
 */
export function inventoryPackage(domains: PackageDomains): PackageInventory {
  const out: Wip = { refs: [], exprs: [], calls: [], effects: [] };

  const walkDomain = (schema: z.ZodType, data: unknown, basePath: string): void => {
    walk(schema, data, basePath, out);
  };

  if (domains.manifest !== undefined) walkDomain(manifestSchema, domains.manifest, 'manifest');
  if (domains.attrs !== undefined) walkDomain(attrDefsSchema, domains.attrs, 'attrs');
  if (domains.body !== undefined) walkDomain(bodyDefSchema, domains.body, 'body');
  if (domains.contentTags !== undefined) {
    walkDomain(contentTagsDefSchema, domains.contentTags, 'contentTags');
  }
  if (domains.statsPage !== undefined) {
    walkDomain(statsPageDefSchema, domains.statsPage, 'statsPage');
  }
  if (domains.loop !== undefined) walkDomain(loopConfigSchema, domains.loop, 'loop');

  for (const [id, compiled] of domains.scenes) {
    walkDomain(sceneDefSchema, compiled.def, `scenes[${id}]`);
  }
  for (const [id, area] of domains.areas) {
    walkDomain(areaDefSchema, area, `areas[${id}]`);
  }
  domains.events.forEach((event, index) => {
    const basePath = `events[${index}]`;
    walkDomain(eventDefSchema, event, basePath);
    // location 引用限定在事件自身的 where.area 内（§4.4 PoolIndex key 语义）
    for (const ref of out.refs) {
      if (ref.kind === 'location' && ref.dataPath === `${basePath}.where.location`) {
        out.refs[out.refs.indexOf(ref)] = { ...ref, scopeArea: event.where.area };
      }
    }
  });
  for (const [id, quest] of domains.quests) {
    walkDomain(questDefSchema, quest, `quests[${id}]`);
  }
  for (const [id, npc] of domains.npcs) {
    walkDomain(npcDefSchema, npc, `npcs[${id}]`);
  }
  for (const [id, item] of domains.items) {
    walkDomain(itemDefSchema, item, `items[${id}]`);
  }
  for (const [id, shop] of domains.shops) {
    walkDomain(shopDefSchema, shop, `shops[${id}]`);
  }
  for (const [id, enemy] of domains.enemies) {
    walkDomain(enemyDefSchema, enemy, `enemies[${id}]`);
  }
  for (const [id, encounter] of domains.encounters) {
    walkDomain(encounterDefSchema, encounter, `encounters[${id}]`);
  }
  for (const [id, achievement] of domains.achievements) {
    walkDomain(achievementDefSchema, achievement, `achievements[${id}]`);
  }
  for (const [id, perk] of domains.perks) {
    walkDomain(perkDefSchema, perk, `perks[${id}]`);
  }
  for (const [id, ending] of domains.endings) {
    walkDomain(endingDefSchema, ending, `endings[${id}]`);
  }
  for (const [id, faction] of domains.factions) {
    walkDomain(factionDefSchema, faction, `factions[${id}]`);
  }

  return { refs: out.refs, exprs: out.exprs, calls: out.calls, effects: out.effects };
}
