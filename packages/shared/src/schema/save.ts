import { z } from 'zod';
import { refId } from '../ids.js';
import { gameIdSchema, semverSchema } from './common.js';

/**
 * 存档与状态投影（设计 §2.4 SaveBlob、§3.1 GameState、FR-SAVE/FR-MIGR/DD-07/DD-09/10）。
 *
 * - SerializedState 是 GameState 的可序列化投影：engine 的 GameState 为手写 TS 类型，
 *   其入档面由本 schema 终验（读档管线步骤「Zod SerializedState 终验」，DD-10）；
 * - checkpoints（回滚栈元数据，§3.1）与 npcLocationCache（日程解析缓存，可重建，
 *   §4.6）不入档，读档后重建；
 * - 存档为整体迁移单位：全包单一 schemaVersion（DD-07），读档先比较版本再迁移，
 *   redirects 按 refId(kind) 元数据定向改写后终验（§5.7，21 号模块）。
 */

/** flag 值域（§3.1 world.flags：boolean | number | string） */
export const flagValueSchema = z.union([z.boolean(), z.number(), z.string()]);

export type FlagValue = z.infer<typeof flagValueSchema>;

/** 时钟（§4.3 Clock：day/slotIndex 递进，week/month 可选启用） */
export const clockSchema = z.strictObject({
  day: z.number().int().min(0),
  slotIndex: z.number().int().min(0),
  week: z.number().int().min(0).optional(),
  month: z.number().int().min(0).optional(),
});

export type Clock = z.infer<typeof clockSchema>;

/** 状态效果实例（FR-STAT-03：实例面；定义面随 attrs.yaml，游戏自定义字段开放） */
export const statusInstanceSchema = z.strictObject({
  id: z.string().min(1),
  remaining: z.number().int().optional(),
  stacks: z.number().int().min(1).optional(),
  source: z.string().optional(),
});

export type StatusInstance = z.infer<typeof statusInstanceSchema>;

const playerStateSchema = z.strictObject({
  /** 数值型 + 等级型统一存值（§3.1） */
  attrs: z.record(z.string(), z.number()),
  skills: z.record(z.string(), z.strictObject({ value: z.number(), exp: z.number() })),
  statuses: z.array(statusInstanceSchema),
  /** 身体部位 → 当前值（FR-BODY-01） */
  body: z.record(z.string(), z.string()),
  /** 装备栏 slot → itemId（FR-ITEM-03） */
  equip: z.record(z.string(), refId('item')),
  /** 多层服装 part → layer → itemId（FR-ITEM-04，§4.7 Outfit） */
  outfit: z.record(z.string(), z.record(z.string(), refId('item'))),
  /** 背包（关键道具按 ItemDef.key 独立分区标记，FR-ITEM-02） */
  bag: z.array(z.strictObject({ itemId: refId('item'), count: z.number().int().min(1) })),
  /** 多货币钱包（FR-ECON-01） */
  wallet: z.record(z.string(), z.number()),
  /** 派生属性缓存（FR-STAT-05，读档后 recomputeDerived 重算） */
  derived: z.record(z.string(), z.number()),
  /** 新档 Perk 结算产物 + 玩家命名（FR-ACHV-06） */
  bootstrap: z.strictObject({ perks: z.array(z.string()), name: z.string() }),
});

const worldStateSchema = z.strictObject({
  time: clockSchema,
  unlockedAreas: z.array(refId('area')),
  flags: z.record(z.string(), flagValueSchema),
  /** 事件计数/收集率数据源（FR-GAL-04） */
  counters: z.record(z.string(), z.number()),
  /** 事件冷却（§4.4 prune；随档持久） */
  eventCooldowns: z.record(
    z.string(),
    z.strictObject({ lastDay: z.number().int().min(0), fired: z.number().int().min(0) }),
  ),
});

export const npcStateSchema = z.strictObject({
  favor: z.number(),
  /** 当前好感阶段（favor.stages[].id） */
  stage: z.string().optional(),
  met: z.boolean(),
  /** NPC 独立记忆命名空间（FR-NPCR-03） */
  flags: z.record(z.string(), flagValueSchema),
});

export type NpcState = z.infer<typeof npcStateSchema>;

export const questStateSchema = z.strictObject({
  state: z.enum(['undiscovered', 'available', 'active', 'ready_to_submit', 'done', 'failed']),
  /** 当前阶段 id（QuestDef.stages[].id） */
  stage: z.string().optional(),
  /** 目标进度（FR-QUEST-05 插值数据源） */
  objectives: z.record(z.string(), z.number()),
  startedDay: z.number().int().min(0).optional(),
});

export type QuestState = z.infer<typeof questStateSchema>;

const seenStateSchema = z.strictObject({
  /** 已读场景（FR-READ-01 已读跳过数据源） */
  scenes: z.array(refId('scene')),
  /** 场景回想解锁（FR-GAL-01，unlock{kind:'gallery'} 写入；勘误 2026-09-12：原误标 media） */
  gallery: z.array(refId('scene')),
  /** CG 解锁位（FR-GAL-03，媒体显示自动登记或 unlock{kind:'cg'}） */
  cg: z.array(refId('media')),
  /** 本档结局记录（跨存档收集在 Profile.endings） */
  endings: z.array(gameIdSchema),
  /** 百科解锁（FR-XTRA-06 预留） */
  codex: z.array(gameIdSchema),
});

/** 游玩统计（FR-STAP-03：用时/事件计数/判定/战斗；周目数在 state.loop） */
const readStatsSchema = z.strictObject({
  playSeconds: z.number().min(0),
  eventCounts: z.record(z.string(), z.number().int().min(0)),
  checks: z.strictObject({ attempts: z.number().int().min(0), successes: z.number().int().min(0) }),
  battles: z.strictObject({
    wins: z.number().int().min(0),
    losses: z.number().int().min(0),
    escapes: z.number().int().min(0),
  }),
});

/** 玩家设置（FR-UI-05；内容过滤 disabledTags，FR-CGRD-03；向导标志，FR-CGRD-04） */
const playerSettingsSchema = z.strictObject({
  lang: z.string().min(1),
  textSpeed: z.number().min(0),
  fontSize: z.number().min(1),
  lineHeight: z.number().min(1),
  bgmOn: z.boolean(),
  sfxOn: z.boolean(),
  imagesOn: z.boolean(),
  /** 减弱动画（NFR-26；动图降级联动，FR-MEDIA-09） */
  reducedMotion: z.boolean(),
  /** 被关闭的内容标签（FR-CGRD-03 过滤执行输入） */
  disabledTags: z.array(z.string()),
  /** 主题 id（FR-READ-05 联动游戏级主题，FR-XTRA-05 预留） */
  themeId: z.string().optional(),
  /** 首启向导完成标志（FR-CGRD-04） */
  wizardDone: z.boolean(),
});

/**
 * GameState 可序列化投影（§3.1 状态树入档面）。
 * 04 号模块的 GameState 结构须与本投影保持一致；字段级只增不改（NFR-15）。
 */
export const serializedStateSchema = z.strictObject({
  /** 周目数（FR-LOOP-01） */
  loop: z.number().int().min(0),
  player: playerStateSchema,
  world: worldStateSchema,
  /** NPC 状态表（键为 npc 引用） */
  npcs: z.record(refId('npc'), npcStateSchema),
  /** 阵营声望表（键为 faction 引用） */
  factions: z.record(refId('faction'), z.number()),
  /** 任务状态表（键为 quest 引用） */
  quests: z.record(refId('quest'), questStateSchema),
  seen: seenStateSchema,
  readStats: readStatsSchema,
  settings: playerSettingsSchema,
});

export type SerializedState = z.infer<typeof serializedStateSchema>;

/** 存档槽内元信息快照（SaveMeta 投影的数据源，FR-SAVE-01/06） */
const saveMetaSchema = z.strictObject({
  /** 槽位显示名（缺省 = 自动命名） */
  name: z.string().min(1).optional(),
  /** 创建时刻（epoch 毫秒） */
  createdAt: z.number().int().min(0),
  playSeconds: z.number().min(0),
  /** 存档时刻所在场景 */
  location: refId('scene'),
  day: z.number().int().min(0),
  loop: z.number().int().min(0),
});

/**
 * 存档 blob（§2.4 SaveBlob；导出/导入即本文档的 JSON，FR-SAVE-04）。
 *
 * 读档管线（DD-10 固定次序）：校验 → 迁移 → redirects 应用 → SerializedState 终验
 * → 周目状态恢复。version 高于引擎能力 → VERSION_UNSUPPORTED 拒绝（FR-MIGR-02）。
 */
export const saveBlobSchema = z.strictObject({
  /** 存档文档格式版本（blob 结构级，与 schemaVersion 分离演进） */
  formatVersion: z.number().int().min(1),
  /** 引擎实际版本（FR-MIGR-01 三层版本 + 引擎版本） */
  engineVersion: semverSchema,
  gameVersion: semverSchema,
  /** 全包单一 schema 版本快照（DD-07） */
  schemaVersion: z.number().int().min(1),
  state: serializedStateSchema,
  /** RNG 内部状态（uint32，随档保存可回放，DD-09；类型见 RngState） */
  rngState: z.number().int().min(0),
  meta: saveMetaSchema,
  /** 完整性校验和（P2，FR-SAVE-07） */
  checksum: z.string().optional(),
});

export type SaveBlob = z.infer<typeof saveBlobSchema>;
