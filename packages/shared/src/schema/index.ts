/**
 * Schema 体系统一出口（设计 §2.4：游戏包全部数据域的 Zod schema 单一来源）。
 *
 * - 每个数据域一个文件，导出 Zod schema 并 `z.infer` 出 TS 类型（NFR-12）；
 * - 包外一律经 `@game/shared` 根出口消费，不深入本目录路径（设计 §10.4 导出约定）；
 * - schema 变更遵循「只增不改」（NFR-15），破坏性变更会红 02 号模块的
 *   JSON Schema 快照守护测试，并必须伴随 schemaVersion 与迁移方案（FR-MIGR-01）。
 */

// ---- 基础构件（§2.1 ID 与引用、表达式原文、语义化版本） --------------------
export {
  exprOrNumberSchema,
  exprSchema,
  gameIdSchema,
  mediaRefSchema,
  semverSchema,
  textKeySchema,
} from './common.js';

// ---- Manifest（包根清单） ---------------------------------------------------
export { manifestSchema } from './manifest.js';
export type { Manifest } from './manifest.js';

// ---- 效果指令（§3.3 指令联合，25 个内置 id + call 扩展） -------------------
export {
  effectDataSchema,
  effectListSchema,
  effectParamSchemas,
  effectSchemas,
} from './effects.js';
export type {
  BattleEffectParams,
  CheckEffectParams,
  EffectData,
  EffectList,
  EffectSeq,
} from './effects.js';

// ---- AttrDefs（属性定义） ---------------------------------------------------
export { attrDefsSchema } from './attrs.js';
export type { AttrDefs, DerivedAttrDef, LevelAttrDef, NumericAttrDef } from './attrs.js';

// ---- SceneDef / AreaDef（场景与区域） ---------------------------------------
export { choiceSchema, sceneDefSchema, sceneMediaSchema, segmentSchema } from './scene.js';
export type { ChoiceDef, SceneDef, SegmentDef } from './scene.js';
export { areaDefSchema, locationDefSchema } from './area.js';
export type { AreaDef, LocationDef } from './area.js';

// ---- EventDef / QuestDef / NpcDef / FactionDef（事件、任务、NPC、阵营） ----
export { eventDefSchema, eventTriggerSchema } from './event.js';
export type { EventDef, EventTrigger } from './event.js';
export { questDefSchema, questStageSchema } from './quest.js';
export type { QuestDef, QuestStage } from './quest.js';
export {
  favorDefSchema,
  favorStageSchema,
  npcDefSchema,
  scheduleEntrySchema,
  scheduleWindowSchema,
} from './npc.js';
export type { FavorDef, FavorStage, NpcDef, ScheduleEntry } from './npc.js';
export { factionDefSchema, factionThresholdSchema } from './faction.js';
export type { FactionDef, FactionThreshold } from './faction.js';

// ---- ItemDef / BodyDef / ShopDef（物品、身体、商店） -------------------------
export { garmentDefSchema, itemDefSchema, itemTypeSchema } from './item.js';
export type { GarmentDef, ItemDef, ItemType } from './item.js';
export { bodyDefSchema, bodyPartDefSchema, pronounsDefSchema } from './body.js';
export type { BodyDef, BodyPartDef, PronounsDef } from './body.js';
export { shopDefSchema, shopEntrySchema } from './shop.js';
export type { ShopDef, ShopEntry } from './shop.js';

// ---- AchievementDef / PerkDef / EndingDef / LoopConfig / ContentTagsDef / StatsPageDef ----
export { achievementDefSchema } from './achievement.js';
export type { AchievementDef } from './achievement.js';
export { perkDefSchema } from './perk.js';
export type { PerkDef } from './perk.js';
export { endingDefSchema, endingGalleryInfoSchema } from './ending.js';
export type { EndingDef, EndingGalleryInfo } from './ending.js';
export { loopCategorySchema, loopConfigSchema, loopPolicySchema } from './loop.js';
export type { LoopCategory, LoopConfig, LoopPolicy } from './loop.js';
export { contentTagDefSchema, contentTagsDefSchema } from './tags.js';
export type { ContentTagDef, ContentTagsDef } from './tags.js';
export {
  statsEntrySchema,
  statsEntryStyleSchema,
  statsGroupSchema,
  statsPageDefSchema,
} from './stats-page.js';
export type { StatsEntry, StatsEntryStyle, StatsGroup, StatsPageDef } from './stats-page.js';

// ---- SaveBlob / SerializedState / Profile（存档与跨存档 Profile） ------------
export {
  clockSchema,
  flagValueSchema,
  npcStateSchema,
  questStateSchema,
  saveBlobSchema,
  serializedStateSchema,
  statusInstanceSchema,
} from './save.js';
export type {
  Clock,
  FlagValue,
  NpcState,
  QuestState,
  SaveBlob,
  SerializedState,
  StatusInstance,
} from './save.js';
export { profileAchievementEntrySchema, profileSchema } from './profile.js';
export type { Profile } from './profile.js';

// ---- TimeConfig（时段制日历，§4.3；data/time.yaml，09 号） --------------------
export { monthDefSchema, timeConfigSchema, timeSlotDefSchema, weekdayDefSchema } from './time.js';
export type { MonthDef, TimeConfig, TimeSlotDef, WeekdayDef } from './time.js';
