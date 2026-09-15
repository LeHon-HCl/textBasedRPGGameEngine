import type { GameDefinition } from '@game/engine';

/**
 * 宿主接线自检（develop.md 约束 8「宿主接线完整性」；2026-09-15 新增）。
 *
 * **问题**：引擎大量能力是「可选注入」——`TimePipeline` 的 6 个步骤槽位、
 * `EffectRegistry` 的可选依赖全部缺省静默跳过。当游戏包**有对应数据**、宿主却
 * 没接线时（如包内有 `data/events.yaml`、宿主未配 `eventEval`），引擎不报错、
 * 测试不红、加载诊断干净——但功能整块失效。
 *
 * M1 收尾实测即此情形：10 条事件零触发，而全量测试与加载器诊断全绿
 * （见 `docs/retros/content-integrity-postmortem.md`）。
 *
 * **对策**：装配宿主时按「包内数据 × 已接线能力」交叉核对，把缺口报成
 * **可诊断告警**（而非静默）——与引擎既有的「数据错误显性化」标准对齐。
 *
 * 本模块是**纯函数**（输入：定义 + 已接线能力描述；输出：告警列表），
 * 便于单测覆盖各种缺口组合，也便于 26 号编辑器复用（DD-12 同一规则集）。
 */

/** 已接线的宿主能力描述（由 GameHost 装配时如实填写） */
export interface WiredCapabilities {
  /** 时间管线步骤 6：事件池评估是否已接线 */
  readonly eventEval: boolean;
  /** 时间管线步骤 2：状态效果 tick（含物品耐久/时效）是否已接线 */
  readonly statusTick: boolean;
  /** 时间管线步骤 5：NPC 日程移动是否已接线 */
  readonly npcSchedule: boolean;
  /** 时间管线步骤 7：任务截止检查是否已接线 */
  readonly questDeadline: boolean;
  /** 时间管线步骤 3：临时身体回退是否已接线 */
  readonly bodyRevert: boolean;
}

/** 接线缺口告警（宿主启动时经 console 与调试面板可见） */
export interface WiringWarning {
  /** 规则 id（与设计 §7.7 规则清单同规；本组归 `host-wiring-gap`） */
  readonly code: 'host-wiring-gap';
  /** 缺失的能力名（英文标识，便于检索） */
  readonly capability: keyof WiredCapabilities;
  /** 包内触发该能力的数据域（用于告警文案：'events' / 'npcs' 等） */
  readonly dataDomain: string;
  /** 可读细节 */
  readonly detail: string;
}

/**
 * 交叉核对「包内数据」与「已接线能力」，返回缺口告警。
 *
 * 口径：**只有当包内确实存在对应数据、且宿主未接线时**才告警——
 * 包内没有事件的自然不需要 `eventEval`（避免误报，约束 8 的「接线完整性」
 * 不是「全部能力必须接线」）。
 */
export function checkHostWiring(
  definition: GameDefinition,
  wired: WiredCapabilities,
): readonly WiringWarning[] {
  const warnings: WiringWarning[] = [];

  // 事件评估（§4.4）：包内有事件却未接线 → 事件永不触发
  if (definition.events.length > 0 && !wired.eventEval) {
    warnings.push({
      code: 'host-wiring-gap',
      capability: 'eventEval',
      dataDomain: 'events',
      detail:
        `包内声明了 ${definition.events.length} 条事件，但时间管线未配置 eventEval 步骤` +
        `（步骤 6）——事件永远不会触发。`,
    });
  }

  // NPC 日程（§4.6）：包内有带 schedule 的 NPC 却未接线 → 日程不生效
  const npcsWithSchedule = [...definition.npcs.values()].filter(
    (npc) => npc.schedule !== undefined && npc.schedule.length > 0,
  );
  if (npcsWithSchedule.length > 0 && !wired.npcSchedule) {
    warnings.push({
      code: 'host-wiring-gap',
      capability: 'npcSchedule',
      dataDomain: 'npcs',
      detail:
        `包内有 ${npcsWithSchedule.length} 个 NPC 声明了日程，但时间管线未配置` +
        ` npcSchedule 步骤（步骤 5）——NPC 不会按时段移动。`,
    });
  }

  // 任务截止（§4.5）：包内有任务声明 failWhen 却未接线 → 截止不生效
  const questsWithDeadline = [...definition.quests.values()].filter(
    (quest) => quest.failWhen !== undefined,
  );
  if (questsWithDeadline.length > 0 && !wired.questDeadline) {
    warnings.push({
      code: 'host-wiring-gap',
      capability: 'questDeadline',
      dataDomain: 'quests',
      detail:
        `包内有 ${questsWithDeadline.length} 条任务声明了 failWhen，但时间管线未配置` +
        ` questDeadline 步骤（步骤 7）——任务的时限失败不会触发。`,
    });
  }

  // 身体回退（§4.8）：**无法从 GameDefinition 判定**——body 域未发布到定义面
  // （与 attrs/contentTags 同属 06 号导出面缺口，宿主以显式注入承接）。
  // 故此项不在此检查：调用方可经 `wired.bodyRevert === false` 自行提示；
  // 待 06 号补齐定义面后此检可升级为数据驱动（与其余四项同口径）。

  // 状态 tick（§5.5）：包内有物品声明耐久/时效却未接线
  const itemsWithTicking = [...definition.items.values()].filter(
    (item) =>
      item.garment?.durability !== undefined || item.garment?.expiresAfterSlots !== undefined,
  );
  if (itemsWithTicking.length > 0 && !wired.statusTick) {
    warnings.push({
      code: 'host-wiring-gap',
      capability: 'statusTick',
      dataDomain: 'items',
      detail:
        `包内有 ${itemsWithTicking.length} 件物品声明了耐久/时效，但时间管线未配置` +
        ` statusTick 步骤（步骤 2）——耐久与时效不会随时段推进结算。`,
    });
  }

  return warnings;
}
