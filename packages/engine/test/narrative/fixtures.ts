import { createRng } from '@game/shared';
import type {
  CompiledExpr,
  EffectData,
  EventDef,
  FlagValue,
  GameId,
  Lang,
  Rng,
  SceneDef,
} from '@game/shared';
import { compileExpr, createBuiltinFunctionRegistry } from '../../src/expr-eval/index.js';
import { newGameState } from '../../src/state/new-game.js';
import { GameRuntime } from '../../src/runtime/game-runtime.js';
import type { ExecContext, ExecOutcome } from '../../src/runtime/index.js';
import type { Patch } from 'immer';
import { createBuiltinEffectRegistry } from '../../src/effects/builtins/index.js';
import type { LocalePack } from '../../src/loader/index.js';
import type {
  ChoiceView,
  NarrativeWarning,
  SceneRunnerDef,
  SceneRunnerOptions,
  SceneRunnerRuntime,
} from '../../src/narrative/types.js';
import { SceneRunner } from '../../src/narrative/scene-runner.js';

/**
 * narrative 测试夹具（08 号任务共用，§4.2「独立测试」口径）：
 * - `makeDef`：仅含被测场景的最小 SceneRunnerDef 夹具——showIf/disabledIf/
   entry.require 表达式按加载期语义预编译入 exprCache（§3.4 步骤 5 的测试面）；
 * - `makeRuntime`：真实 GameRuntime + 内置效果注册表（固定种子 Rng，§1.3），
 *   选项事务走真实指令管线；
 * - `stubRuntime`：记录型最小桩（§4.2「以桩 GameRuntime 驱动状态机」的缝），
 *   供错误注入与调用记录用例；
 * - `pack`：嵌套记录 → 命名空间镜像展开 LocalePack（FR-L10N-02 键形态）。
 */

/** 新档版本三元组（测试基线，与 runtime/effects 夹具一致） */
export const BASE_VERSIONS = { gameVersion: '1.0.0', schemaVersion: 1, minEngineVersion: '0.0.1' };

const FN_REGISTRY = createBuiltinFunctionRegistry();

/**
 * 嵌套记录 → 命名空间镜像展开的 LocalePack（'scenes.a.open' 形态键）。
 * 镜像规则与 06 号加载器 flattenLocaleDoc 一致：顶层命中保留字
 * （plural/select/first/again/if/random）的记录值整体透传（深转换：
 * 数值/布尔字符串化），其余记录按命名空间递归展开。
 */
export function pack(lang: Lang, record: Record<string, unknown>): LocalePack {
  const keys = new Map<string, unknown>();
  const RESERVED = ['plural', 'select', 'first', 'again', 'if', 'random'];
  const structural = (value: unknown): unknown => {
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(structural);
    if (typeof value === 'object' && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        out[name] = structural(child);
      }
      return out;
    }
    return value;
  };
  const walk = (prefix: string, value: unknown): void => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (RESERVED.some((name) => Object.prototype.hasOwnProperty.call(record, name))) {
        keys.set(prefix, structural(record));
        return;
      }
      for (const [name, child] of Object.entries(record)) {
        walk(prefix === '' ? name : `${prefix}.${name}`, child);
      }
      return;
    }
    keys.set(prefix, value);
  };
  walk('', record);
  return { lang, keys: keys as LocalePack['keys'] };
}

/** 收集场景数据中的全部表达式原文并按加载期语义预编译（§3.4 exprCache） */
function compileSceneExprs(scenes: readonly SceneDef[]): Map<string, CompiledExpr> {
  const cache = new Map<string, CompiledExpr>();
  const add = (source: string | undefined): void => {
    if (source === undefined || cache.has(source)) return;
    cache.set(source, compileExpr(source, FN_REGISTRY));
  };
  for (const scene of scenes) {
    add(scene.entry?.require);
    for (const segment of scene.segments) add(segment.showIf);
    for (const choice of scene.choices) {
      add(choice.showIf);
      add(choice.disabledIf);
    }
  }
  return cache;
}

/** makeDef 选项：场景集 + 事件集（事件场景判定面）+ 语言包记录 + 媒体数据源 */
export interface DefSpec {
  readonly scenes: readonly SceneDef[];
  readonly events?: readonly EventDef[];
  readonly locales?: Record<string, Record<string, unknown>>;
  readonly mainLang?: Lang;
  /** NPC 定义投影（立绘差分声明，24 号） */
  readonly npcs?: SceneRunnerDef['npcs'];
  /** 区域定义投影（区域级 bg/bgm 绑定，24 号） */
  readonly areas?: SceneRunnerDef['areas'];
}

/** 构造最小 SceneRunnerDef 夹具（GameDefinition 结构化满足该接口） */
export function makeDef(spec: DefSpec): SceneRunnerDef {
  const scenes = new Map<GameId, { def: SceneDef; file: string }>();
  for (const def of spec.scenes) {
    scenes.set(def.id, { def, file: `data/scenes/${def.id}.yaml` });
  }
  const mainLang = spec.mainLang ?? 'zh-CN';
  const locales: Record<Lang, LocalePack> = {};
  for (const [lang, record] of Object.entries(spec.locales ?? {})) {
    locales[lang] = pack(lang, record);
  }
  if (locales[mainLang] === undefined) locales[mainLang] = pack(mainLang, {});
  return {
    manifest: { mainLang },
    scenes,
    events: spec.events ?? [],
    locales,
    exprCache: compileSceneExprs(spec.scenes),
    ...(spec.npcs !== undefined ? { npcs: spec.npcs } : {}),
    ...(spec.areas !== undefined ? { areas: spec.areas } : {}),
  };
}

/** makeRuntime 选项：新档初始 flag/attr/内容过滤便于 showIf/disabledIf 分支驱动 */
export interface RuntimeSpec {
  readonly flags?: Record<string, FlagValue>;
  readonly attrs?: Record<string, number>;
  /** 玩家禁用的内容标签（FR-CGRD-02 选项内容过滤驱动） */
  readonly disabledTags?: readonly string[];
  readonly rng?: Rng;
}

/** 构造真实 GameRuntime（内置效果注册表接线 + 固定种子 Rng） */
export function makeRuntime(spec: RuntimeSpec = {}): GameRuntime {
  const state = newGameState(
    {
      versions: BASE_VERSIONS,
      attrs: { hp: 30, stamina: 5, insight: 0, ...spec.attrs },
      flags: spec.flags ?? {},
      settings:
        spec.disabledTags === undefined ? undefined : { disabledTags: [...spec.disabledTags] },
    },
    createRng(42),
  );
  return new GameRuntime({
    state,
    rng: spec.rng ?? createRng(7),
    effectExecutor: createBuiltinEffectRegistry(),
  });
}

/** makeRunner 选项（SceneRunnerOptions 的直接透传 + 缺省 def 注入） */
export interface RunnerSpec extends Pick<
  SceneRunnerOptions,
  'params' | 'readonly' | 'onWarn' | 'contentFilter' | 'mediaResolver' | 'evalSpriteCondition'
> {
  readonly runtime?: SceneRunnerRuntime;
  readonly def?: SceneRunnerDef;
  readonly sceneId?: GameId;
  /** 便捷：媒体数据源经 def 注入（与 runtime 解耦，24 号测试面） */
  readonly npcs?: SceneRunnerDef['npcs'];
  readonly areas?: SceneRunnerDef['areas'];
}

/** 构造 SceneRunner（缺省真实 runtime + spec.def） */
export function makeRunner(def: SceneRunnerDef, spec: RunnerSpec = {}): SceneRunner {
  const merged =
    spec.npcs === undefined && spec.areas === undefined
      ? def
      : {
          ...def,
          ...(spec.npcs !== undefined ? { npcs: spec.npcs } : {}),
          ...(spec.areas !== undefined ? { areas: spec.areas } : {}),
        };
  return new SceneRunner(spec.runtime ?? makeRuntime(), {
    def: merged,
    sceneId: spec.sceneId ?? 'scene_start',
    params: spec.params,
    readonly: spec.readonly,
    onWarn: spec.onWarn,
    contentFilter: spec.contentFilter,
    mediaResolver: spec.mediaResolver,
    evalSpriteCondition: spec.evalSpriteCondition,
  });
}

/** 记录型最小桩运行时（§4.2 桩化缝）：exec 记录入参并可注入失败/跳转产出 */
export interface StubRuntimeSpec {
  /** exec 抛出的错误（注入事务失败路径） */
  readonly failExec?: unknown;
  /** exec 固定返回的跳转产出（驱动跳转消费面） */
  readonly jumps?: readonly unknown[];
  readonly flags?: Record<string, FlagValue>;
}

/** 记录型桩运行时：exec/evalCondition 调用全量记录，状态以最小 GameState 承载 */
export function stubRuntime(spec: StubRuntimeSpec = {}): SceneRunnerRuntime & {
  execCalls: { effects: readonly EffectData[]; ctx: ExecContext }[];
  evalCalls: string[];
} {
  const runtime = makeRuntime({ flags: spec.flags });
  const calls: { effects: readonly EffectData[]; ctx: ExecContext }[] = [];
  const evalCalls: string[] = [];
  return {
    get state() {
      return runtime.state;
    },
    get rng() {
      return runtime.rng;
    },
    exec(effects: readonly EffectData[], ctx: ExecContext): ExecOutcome {
      calls.push({ effects, ctx });
      if (spec.failExec !== undefined) throw spec.failExec;
      const jumps = (spec.jumps ?? []) as ExecOutcome['jumps'];
      return { jumps: [...jumps], events: [], patches: [] as Patch[] };
    },
    eval(expr: CompiledExpr): unknown {
      evalCalls.push(expr.source);
      return runtime.eval(expr);
    },
    evalCondition(expr: CompiledExpr): boolean {
      evalCalls.push(expr.source);
      return runtime.evalCondition(expr);
    },
    markSceneSeen(sceneId: string): void {
      runtime.markSceneSeen(sceneId);
    },
    markCgSeen(assetId: string): void {
      runtime.markCgSeen(assetId);
    },
    execCalls: calls,
    evalCalls,
  };
}

/** 选项视图辅助：仅取可见（未被过滤隐藏）选项 id 序列 */
export function visibleIds(views: readonly ChoiceView[]): string[] {
  return views.filter((view) => view.hiddenByFilter !== true).map((view) => view.id);
}

/** warning 收集器（onWarn 注入面） */
export function warningSink(): {
  warnings: NarrativeWarning[];
  onWarn: (w: NarrativeWarning) => void;
} {
  const warnings: NarrativeWarning[] = [];
  return { warnings, onWarn: (warning) => warnings.push(warning) };
}
