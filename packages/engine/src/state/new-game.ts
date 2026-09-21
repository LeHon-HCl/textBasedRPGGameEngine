import type { AttrDefs, FlagValue, GameId, NpcState, Rng } from '@game/shared';
import type { BagEntry, GameState, PlayerSettings, SkillValue } from './game-state.js';
import { DERIVED_TRIGGER_DOMAINS, recomputeDerived } from './derived.js';

/**
 * 新档状态初始化（设计 §3.1，04 任务 A1）。
 *
 * `NewGameBootstrap` 是本模块的本地接口：06 号加载器以 GameDefinition 投影喂入
 * （属性初始值 / 技能初始 / 身体默认 / NPC 初始好感与阶段 / faction 初始 /
 * 时间起点 / manifest 版本三元组），04 号不 import 尚不存在的 loader 类型。
 * 新档初始化为纯数据投影——除派生属性公式求值（经传入 rng 的求值上下文，
 * DD-09）外不消耗随机序列、不做 IO；PerkDef.effects 的执行在运行时事务中
 * 进行（§5.4），此处只登记 `player.bootstrap.perks`。
 */

/**
 * 引擎实际版本（FR-MIGR-01：存档记录三层版本 + 引擎实际版本）。
 * 与 packages/engine/package.json 的 version 同步维护（M0 手动；后续可由
 * 构建期注入）。新档与读档（restoreState）均以此填充 state.versions.engineVersion。
 */
export const ENGINE_VERSION = '0.0.0';

/**
 * 玩家设置缺省值（FR-UI-05）。lang 缺省 'zh-CN'——实际游戏应以
 * bootstrap.settings 覆盖（06 号投影 manifest.mainLang）。
 */
export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = Object.freeze({
  lang: 'zh-CN',
  textSpeed: 1,
  fontSize: 16,
  lineHeight: 1.6,
  bgmOn: true,
  sfxOn: true,
  imagesOn: true,
  reducedMotion: false,
  disabledTags: [],
  wizardDone: false,
});

/**
 * manifest 版本三元组（FR-MIGR-01：gameVersion / schemaVersion / minEngineVersion）。
 * minEngineVersion 属加载兼容判定面（FR-MIGR-02，06 号消费），不进状态树；
 * 状态树 versions 承载 engineVersion + gameVersion + schemaVersion（§3.1）。
 */
export interface NewGameVersions {
  gameVersion: string;
  schemaVersion: number;
  minEngineVersion: string;
}

/** NPC 初始状态（NpcDef.favor / favor.stages 的投影面，12 号接线） */
export interface NewGameNpcInit {
  favor: number;
  /** 初始好感阶段（favor.stages[].id；未声明 = 尚未进入任何阶段） */
  stage?: string;
  /** 是否已登场（缺省 false） */
  met?: boolean;
  /** NPC 记忆命名空间初值（FR-NPCR-03） */
  flags?: Record<string, FlagValue>;
}

/**
 * 新档初始化数据（§3.1 状态树的投影面）。
 * 全部域可选（除版本三元组）；缺省域落为空档缺省值（见 newGameState）。
 */
export interface NewGameBootstrap {
  /** manifest 版本三元组（FR-MIGR-01） */
  versions: NewGameVersions;
  /** 属性初始值（数值型 init / 等级型 init 档位下标统一存 number，FR-STAT-01） */
  attrs?: Record<string, number>;
  /** 派生属性公式（key = 派生属性 id；初始化时经 recomputeDerived 求值，FR-STAT-05） */
  derivedFormulas?: Record<string, string>;
  /** 技能初始值（FR-STAT-02） */
  skills?: Record<string, SkillValue>;
  /** 身体部位默认值（BodyDef.parts[].default 的投影面，FR-BODY-01） */
  body?: Record<string, string>;
  /** NPC 初始好感与阶段 */
  npcs?: Record<GameId, NewGameNpcInit>;
  /** 阵营初始声望（FactionDef.init 的投影面，FR-NPCR-04） */
  factions?: Record<GameId, number>;
  /** 时间起点（缺省 = 第 1 天第 0 时段，FR-TIME-01） */
  time?: { day: number; slotIndex: number; week?: number; month?: number };
  /** 初始解锁区域 */
  unlockedAreas?: GameId[];
  /** 初始 flag */
  flags?: Record<string, FlagValue>;
  /** 初始计数器（FR-GAL-04） */
  counters?: Record<string, number>;
  /** 初始背包 */
  bag?: BagEntry[];
  /** 初始钱包 */
  wallet?: Record<string, number>;
  /** 新档 Perk 清单（PerkDef.effects 的执行在运行时事务中进行，§5.4） */
  perks?: string[];
  /** 玩家命名（缺省空串） */
  playerName?: string;
  /** 初始玩家设置（逐项覆盖 DEFAULT_PLAYER_SETTINGS） */
  settings?: Partial<PlayerSettings>;
}

/**
 * 创建新档 GameState（§3.1 状态树全量初始化，04 任务 A1）。
 *
 * - 逐层拷贝 bootstrap 输入（初始化后改写 bootstrap 不影响状态）；
 * - 存在 derivedFormulas 时以传入 rng 构造求值上下文做初始派生重算
 *   （DD-09：同种子新档的派生初值可复现）；
 * - 返回未冻结的普通对象：调用方仍可直接修正；交给 GameRuntime 后由运行时
 *   冻结为不可变状态。
 */
export function newGameState(bootstrap: NewGameBootstrap, rng: Rng): GameState {
  const state: GameState = {
    versions: {
      engineVersion: ENGINE_VERSION,
      gameVersion: bootstrap.versions.gameVersion,
      schemaVersion: bootstrap.versions.schemaVersion,
    },
    loop: 0,
    player: {
      attrs: { ...bootstrap.attrs },
      skills: copyRecord(bootstrap.skills, (skill) => ({ ...skill })),
      statuses: [],
      body: { ...bootstrap.body },
      bodyTemp: {},
      bodyProgress: {},
      equip: {},
      outfit: {},
      bag: (bootstrap.bag ?? []).map((entry) => ({ ...entry })),
      wallet: { ...bootstrap.wallet },
      derived: {},
      outfitPresets: {},
      wornMeta: {},
      bootstrap: { perks: [...(bootstrap.perks ?? [])], name: bootstrap.playerName ?? '' },
    },
    world: {
      time: bootstrap.time ? { ...bootstrap.time } : { day: 1, slotIndex: 0 },
      unlockedAreas: [...(bootstrap.unlockedAreas ?? [])],
      flags: { ...bootstrap.flags },
      counters: { ...bootstrap.counters },
      npcLocationCache: {},
      eventCooldowns: {},
      shopStock: {},
    },
    npcs: buildNpcs(bootstrap.npcs),
    factions: { ...bootstrap.factions },
    quests: {},
    seen: { scenes: [], gallery: [], cg: [], endings: [], codex: [] },
    readStats: {
      playSeconds: 0,
      eventCounts: {},
      checks: { attempts: 0, successes: 0 },
      battles: { wins: 0, losses: 0, escapes: 0 },
    },
    settings: { ...DEFAULT_PLAYER_SETTINGS, ...bootstrap.settings },
    checkpoints: [],
  };

  const formulas = bootstrap.derivedFormulas;
  if (formulas !== undefined && Object.keys(formulas).length > 0) {
    recomputeDerived(state, DERIVED_TRIGGER_DOMAINS, attrDefsFromFormulas(formulas), { rng });
  }
  return state;
}

/** 派生公式表 → 02 号 AttrDefs 形状（recomputeDerived 的入参契约） */
function attrDefsFromFormulas(formulas: Record<string, string>): AttrDefs {
  const derived: AttrDefs['derived'] = {};
  for (const [id, formula] of Object.entries(formulas)) {
    derived[id] = { formula };
  }
  return { numeric: {}, level: {}, derived };
}

/** NPC 初始状态落位（met 缺省 false、flags 缺省空表） */
function buildNpcs(init: Record<GameId, NewGameNpcInit> | undefined): Record<GameId, NpcState> {
  const npcs: Record<GameId, NpcState> = {};
  for (const [id, npc] of Object.entries(init ?? {})) {
    npcs[id] = {
      favor: npc.favor,
      ...(npc.stage !== undefined ? { stage: npc.stage } : {}),
      met: npc.met ?? false,
      flags: { ...npc.flags },
    };
  }
  return npcs;
}

/** 浅层逐值拷贝（一层嵌套记录），保持键序 */
function copyRecord<T>(
  source: Record<string, T> | undefined,
  clone: (value: T) => T,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    result[key] = clone(value);
  }
  return result;
}
