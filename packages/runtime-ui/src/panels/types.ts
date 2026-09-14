import type { AttrDefs, GameId, ItemDef, StatusInstance, TextKey } from '@game/shared';
import type { EquipModDetail, GameState } from '@game/engine';

/**
 * 功能面板投影（设计 §6.4 / FR-UI-03/04）。
 *
 * 投影 = 纯函数：GameState + 目录 → 面板视图（props 受控组件的输入面）。
 * 为什么先投影而不是让组件直接读 state：面板的呈现口径（显示哪些、排序、
 * 折叠、缺省隐藏）是**产品决策**，集中在一处便于测试与复用（编辑器预览、
 * 调试面同理）；组件只做渲染，可无状态测试。
 */

// ---- 属性与技能 -------------------------------------------------------------

/** 面板属性条目（数值型带区间，等级型带等级名） */
export interface StatusAttrView {
  readonly id: string;
  /** numeric = 数值型（带 min/max）；level = 等级型（display 为等级名） */
  readonly kind: 'numeric' | 'level';
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  /** 等级型当前等级名（levels[value]；越界时回落为 undefined） */
  readonly display?: string;
  /** 显示名文本键（缺省 `attrs.<id>.name`，由 UI 侧经 TextResolver 物化） */
  readonly nameKey: TextKey;
}

/** 技能条目（FR-STAT-02） */
export interface StatusSkillView {
  readonly id: string;
  readonly value: number;
  readonly exp: number;
  readonly nameKey: TextKey;
}

/** 状态效果条目（FR-STAT-03） */
export interface StatusEffectView {
  readonly id: string;
  /** 剩余时段（无期限时不写入） */
  readonly remaining?: number;
  /** 层数（>1 时呈现「×N」） */
  readonly stacks?: number;
  readonly source?: string;
  readonly nameKey: TextKey;
}

/** 钱包条目（FR-ECON-01 多货币；按面额值降序） */
export interface StatusWalletView {
  readonly id: string;
  readonly amount: number;
  readonly nameKey: TextKey;
}

/** 装备栏条目（FR-ITEM-03） */
export interface StatusEquipView {
  readonly slot: string;
  readonly itemId: GameId;
  readonly nameKey: TextKey;
}

/** 着装条目（FR-ITEM-04 多层服装；按部位/层号排序） */
export interface StatusOutfitView {
  readonly part: string;
  readonly layer: number;
  readonly itemId: GameId;
  readonly nameKey: TextKey;
}

/** 状态面板视图（五块内容 + 可选的装备修正明细） */
export interface StatusPanelView {
  readonly attrs: readonly StatusAttrView[];
  readonly skills: readonly StatusSkillView[];
  readonly statuses: readonly StatusEffectView[];
  readonly wallet: readonly StatusWalletView[];
  readonly equip: readonly StatusEquipView[];
  readonly outfit: readonly StatusOutfitView[];
}

/** 投影选项 */
export interface StatusProjectionOptions {
  /** 属性定义（FR-STAT-01 的 show/max/levels 判据；缺省 = 无属性可显示） */
  readonly attrDefs?: AttrDefs | undefined;
  /** 物品目录（名称键来源；缺省回落到 `items.<id>.name`） */
  readonly items?: ReadonlyMap<string, ItemDef> | undefined;
}

/** 属性显示名缺省键（作者未提供目录时仍可渲染） */
const attrNameKey = (id: string): TextKey => `attrs.${id}.name`;
const itemNameKey = (id: string): TextKey => `items.${id}.name`;
const skillNameKey = (id: string): TextKey => `skills.${id}.name`;
const statusNameKey = (id: string): TextKey => `statuses.${id}.name`;

/**
 * 投影状态面板（见模块 TSDoc）。
 *
 * 口径细节：
 * - 数值型属性只收 `show === true`（FR-STAT-01「false = 仅内部计算」）；
 * - 等级型属性以 `levels[value]` 映射等级名，值越界不臆造名称；
 * - 不在 attrDefs 中的属性（如派生缓存）不列出——面板只显示作者声明的属性；
 * - 钱包过滤零额（避免列出全币种）；着装按部位名 + 层号升序（由内到外）。
 *
 * @param state 游戏状态（只读消费）
 * @param options 目录注入（attrDefs / items）
 */
export function projectStatusPanel(
  state: Pick<GameState, 'player'>,
  options: StatusProjectionOptions = {},
): StatusPanelView {
  const { attrDefs, items } = options;
  const attrs: StatusAttrView[] = [];
  if (attrDefs !== undefined) {
    for (const [id, def] of Object.entries(attrDefs.numeric)) {
      if (!def.show) continue;
      attrs.push({
        id,
        kind: 'numeric',
        value: state.player.attrs[id] ?? def.init,
        min: def.min,
        max: def.max,
        nameKey: attrNameKey(id),
      });
    }
    for (const [id, def] of Object.entries(attrDefs.level)) {
      const value = state.player.attrs[id] ?? def.init;
      const name = def.levels[value];
      attrs.push({
        id,
        kind: 'level',
        value,
        ...(name !== undefined ? { display: name } : {}),
        nameKey: attrNameKey(id),
      });
    }
  }

  const skills: StatusSkillView[] = Object.entries(state.player.skills).map(([id, skill]) => ({
    id,
    value: skill.value,
    exp: skill.exp,
    nameKey: skillNameKey(id),
  }));

  const statuses: StatusEffectView[] = state.player.statuses.map(
    (effect: StatusInstance): StatusEffectView => ({
      id: effect.id,
      ...(effect.remaining !== undefined ? { remaining: effect.remaining } : {}),
      ...(effect.stacks !== undefined ? { stacks: effect.stacks } : {}),
      ...(effect.source !== undefined ? { source: effect.source } : {}),
      nameKey: statusNameKey(effect.id),
    }),
  );

  const wallet: StatusWalletView[] = Object.entries(state.player.wallet)
    .filter(([, amount]) => amount !== 0)
    .map(([id, amount]) => ({ id, amount, nameKey: `wallet.${id}.name` }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));

  const equip: StatusEquipView[] = Object.entries(state.player.equip).map(([slot, itemId]) => ({
    slot,
    itemId,
    nameKey: items?.get(itemId)?.nameKey ?? itemNameKey(itemId),
  }));

  const outfit: StatusOutfitView[] = [];
  for (const [part, layers] of Object.entries(state.player.outfit)) {
    for (const [layer, itemId] of Object.entries(layers)) {
      outfit.push({
        part,
        layer: Number.parseInt(layer, 10),
        itemId,
        nameKey: items?.get(itemId)?.nameKey ?? itemNameKey(itemId),
      });
    }
  }
  outfit.sort((a, b) => a.part.localeCompare(b.part) || a.layer - b.layer);

  return { attrs, skills, statuses, wallet, equip, outfit };
}

/** 装备修正明细 → 可读文本（调试与状态面板共用；`attr +N` / `attr -N`） */
export function describeEquipMods(detail: EquipModDetail): string {
  const parts = Object.entries(detail.mods).map(([attr, value]) =>
    value >= 0 ? `${attr} +${value}` : `${attr} ${value}`,
  );
  return parts.join('，');
}
