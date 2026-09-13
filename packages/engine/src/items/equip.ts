import { createRng } from '@game/shared';
import type { GameState, ItemDef } from '@game/shared';
import { compileExpr, createBuiltinFunctionRegistry, evalExpr } from '../expr-eval/index.js';
import { buildExprScope } from '../state/index.js';

/**
 * 装备修正明细投影（FR-STAT-03「面板显示修正明细」，§4.7，13 任务 2）。
 *
 * 纯函数：GameState + 物品目录 → 逐栏位/逐物品的已解析修正值列表。
 * 收集口径与重算（state/derived.ts 的装备修正并入）一致（equip 栏位 +
 * outfit 部位层），但不写状态——面板展示与调试面。
 */

/** 单栏位装备的修正明细（mods 值为已解析数值，按声明序） */
export interface EquipModDetail {
  /** 栏位标识：equip 栏位 id，服装为 `outfit.<part>.<layer>` */
  readonly slot: string;
  readonly itemId: string;
  /** attrId → 修正值（求值失败降级为 NaN 供调试呈现，不阻塞面板） */
  readonly mods: Readonly<Record<string, number>>;
}

/** 装备修正明细投影（顺序：equip 栏位在前，outfit 部位在后） */
export function equipModDetails(
  state: GameState,
  items: ReadonlyMap<string, ItemDef>,
): EquipModDetail[] {
  // 明细求值用独立内置注册表与固定种子 Rng：投影不得消耗运行时随机序列
  // （DD-09），含脚本函数的修正降级为 NaN（面板容忍，重算面才是权威）
  const registry = createBuiltinFunctionRegistry();
  const rng = createRng(0);
  const scope = buildExprScope(state);
  const details: EquipModDetail[] = [];
  const collect = (slot: string, itemId: string): void => {
    const def = items.get(itemId);
    if (def?.equipMods === undefined) return;
    const mods: Record<string, number> = {};
    for (const [attrId, source] of Object.entries(def.equipMods)) {
      try {
        const expr = compileExpr(source, registry);
        const value = evalExpr(expr, { state: scope, rng, registry });
        mods[attrId] = typeof value === 'number' ? value : Number.NaN;
      } catch {
        mods[attrId] = Number.NaN;
      }
    }
    details.push({ slot, itemId, mods });
  };
  for (const [slot, itemId] of Object.entries(state.player.equip)) collect(slot, itemId);
  for (const [part, layers] of Object.entries(state.player.outfit)) {
    for (const [layer, itemId] of Object.entries(layers)) {
      collect(`outfit.${part}.${layer}`, itemId);
    }
  }
  return details;
}
