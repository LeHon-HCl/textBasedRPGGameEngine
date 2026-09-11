import { effectParamSchemas } from '@game/shared';
import type { GameId } from '@game/shared';
import type { WritableDraft } from 'immer';
import type { GameState } from '../../state/index.js';
import type { EffectExecuteContext, EffectRegistryOptions } from '../types.js';
import { eraseDef } from '../types.js';
import type { EffectInstructionDef, ErasedEffectDef, TouchReport } from '../types.js';
import { evalNumberParam, instructionError } from './util.js';

/**
 * 物品类内置指令（设计 §3.3 give/take/equip/unequip/wear/remove；05 任务 B2）。
 *
 * - 背包为 `player.bag`（BagEntry[]，{itemId, count}，FR-ITEM-02）：give/take
 *   增减计数；数量须为非负整数（0 = 无操作），不足即 EFFECT_FAILED；
 * - 容量（FR-ITEM-02 可选启用）：`bagCapacity` 按物品种类数（bag 条目数）计，
 *   仅在「获得新种类」（give 建新条目）时校验——堆叠与卸下（unequip/remove
 *   回收）不触发容量拒绝，避免穿戴物无法卸下的软锁；
 * - equip（FR-ITEM-03 最简版）：从背包消耗 1 件放入 `player.equip[slot]`
 *   （slot 取 ItemDef.equipSlot）；已占用即报错——完整交换/冲突规则属 13 号；
 * - wear（FR-ITEM-04 最简版）：消耗 1 件写入 `player.outfit[part][layer]`；
 *   **同 part 同 layer 已占用即报错**（§4.7 冲突基础规则；swappable/替换等
 *   完整规则与换装预设 preset 应用属 13 号，本模块对 preset 显性报错）；
 * - remove：按 itemId 查找穿戴位，清除后回收至背包；未穿戴即报错。
 */

/** 背包条目查找 */
function findBagIndex(draft: WritableDraft<GameState>, itemId: GameId): number {
  return draft.player.bag.findIndex((entry) => entry.itemId === itemId);
}

/** 背包增加（容量仅在新建条目时校验，见模块 TSDoc） */
function addToBag(
  draft: WritableDraft<GameState>,
  itemId: GameId,
  count: number,
  op: string,
  capacity?: number,
): void {
  const index = findBagIndex(draft, itemId);
  const entry = index >= 0 ? draft.player.bag[index] : undefined;
  if (entry !== undefined) {
    entry.count += count;
    return;
  }
  if (capacity !== undefined && draft.player.bag.length >= capacity) {
    throw instructionError(op, `背包已满（容量 ${String(capacity)}，FR-ITEM-02）`, {
      item: itemId,
    });
  }
  draft.player.bag.push({ itemId, count });
}

/** 背包扣减（不足即 EFFECT_FAILED；归零移除条目） */
function removeFromBag(
  draft: WritableDraft<GameState>,
  itemId: GameId,
  count: number,
  op: string,
): void {
  const index = findBagIndex(draft, itemId);
  const entry = index >= 0 ? draft.player.bag[index] : undefined;
  if (entry === undefined || entry.count < count) {
    throw instructionError(
      op,
      `未持有足够物品 '${itemId}'（需要 ${String(count)}，实际 ${entry === undefined ? '0' : String(entry.count)}）`,
      { item: itemId },
    );
  }
  entry.count -= count;
  if (entry.count === 0) draft.player.bag.splice(index, 1);
}

/** 数量参数：非负整数（0 = 无操作） */
function evalCountParam(
  ectx: EffectExecuteContext,
  op: string,
  value: string | number | undefined,
): number {
  const count = evalNumberParam(ectx, op, 'count', value ?? 1);
  if (!Number.isInteger(count) || count < 0) {
    throw instructionError(op, `数量须为非负整数，实际 ${String(count)}`, {
      sourceExpr: String(value),
    });
  }
  return count;
}

/**
 * 键移除（浅拷贝后按运行期键名删除）：穿脱装需要按 slot/layer 键移除字段，
 * immer 将差分为 remove patch。局部副本上的动态 delete 是此处唯一语义清晰
 * 的写法，故对本辅助集中豁免 no-dynamic-delete。
 */
function omitKey<T extends object>(source: T, key: string): T {
  const copy = { ...source };
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete (copy as Record<string, unknown>)[key];
  return copy;
}

/** 物品类指令全集（id 固定，§3.3 表格） */
export function createItemDefs(options: EffectRegistryOptions): ErasedEffectDef[] {
  const items = options.items;

  const requireItemDef = (op: string, itemId: GameId) => {
    const def = items?.get(itemId);
    if (def === undefined) {
      throw instructionError(op, `未知物品 '${itemId}'（物品目录未注册或缺失）`, { item: itemId });
    }
    return def;
  };

  const giveDef: EffectInstructionDef<{ item: string; count?: string | number }> = {
    id: 'give',
    schema: effectParamSchemas.give,
    touch: (): TouchReport => ({ reads: [], writes: ['player.bag'] }),
    execute: (arg, ectx) => {
      const count = evalCountParam(ectx, 'give', arg.count);
      if (count === 0) return;
      addToBag(ectx.draft, arg.item, count, 'give', options.bagCapacity);
    },
  };

  const takeDef: EffectInstructionDef<{ item: string; count?: string | number }> = {
    id: 'take',
    schema: effectParamSchemas.take,
    touch: (): TouchReport => ({ reads: [], writes: ['player.bag'] }),
    execute: (arg, ectx) => {
      const count = evalCountParam(ectx, 'take', arg.count);
      if (count === 0) return;
      removeFromBag(ectx.draft, arg.item, count, 'take');
    },
  };

  const equipDef: EffectInstructionDef<{ item: string }> = {
    id: 'equip',
    schema: effectParamSchemas.equip,
    touch: (): TouchReport => ({ reads: [], writes: ['player.equip', 'player.bag'] }),
    execute: (arg, ectx) => {
      const def = requireItemDef('equip', arg.item);
      if (def.type !== 'equip' || def.equipSlot === undefined) {
        throw instructionError('equip', `物品 '${arg.item}' 非 equip 类型（缺 equipSlot）`, {
          item: arg.item,
        });
      }
      if (ectx.draft.player.equip[def.equipSlot] !== undefined) {
        throw instructionError(
          'equip',
          `装备栏 '${def.equipSlot}' 已被 '${String(ectx.draft.player.equip[def.equipSlot])}' 占用（完整交换规则属 13 号）`,
          { slot: def.equipSlot },
        );
      }
      removeFromBag(ectx.draft, arg.item, 1, 'equip');
      ectx.draft.player.equip[def.equipSlot] = arg.item;
    },
  };

  const unequipDef: EffectInstructionDef<{ slot: string }> = {
    id: 'unequip',
    schema: effectParamSchemas.unequip,
    touch: (): TouchReport => ({ reads: [], writes: ['player.equip', 'player.bag'] }),
    execute: (arg, ectx) => {
      const current = ectx.draft.player.equip[arg.slot];
      if (current === undefined) {
        throw instructionError('unequip', `装备栏 '${arg.slot}' 为空`, { slot: arg.slot });
      }
      // 卸下 = 槽位键移除（immer remove patch）
      ectx.draft.player.equip = omitKey(ectx.draft.player.equip, arg.slot);
      addToBag(ectx.draft, current, 1, 'unequip');
    },
  };

  const wearDef: EffectInstructionDef<{ item?: string; preset?: string }> = {
    id: 'wear',
    schema: effectParamSchemas.wear,
    touch: (): TouchReport => ({ reads: [], writes: ['player.outfit', 'player.bag'] }),
    execute: (arg, ectx) => {
      if (arg.preset !== undefined) {
        throw instructionError(
          'wear',
          `换装预设 '${arg.preset}' 的应用属 13 号（FR-ITEM-05），本模块仅支持单件穿戴`,
          { preset: arg.preset },
        );
      }
      if (arg.item === undefined) {
        throw instructionError('wear', 'wear 需要 item 或 preset 之一', {});
      }
      const def = requireItemDef('wear', arg.item);
      if (def.type !== 'garment' || def.garment === undefined) {
        throw instructionError('wear', `物品 '${arg.item}' 非 garment 类型`, { item: arg.item });
      }
      const layerKey = String(def.garment.layer);
      const worn = ectx.draft.player.outfit[def.garment.part]?.[layerKey];
      if (worn !== undefined) {
        throw instructionError(
          'wear',
          `部位 '${def.garment.part}' 第 ${layerKey} 层已被 '${worn}' 占用（冲突基础规则，完整规则属 13 号）`,
          { part: def.garment.part, layer: layerKey },
        );
      }
      removeFromBag(ectx.draft, arg.item, 1, 'wear');
      const partLayers = ectx.draft.player.outfit[def.garment.part];
      ectx.draft.player.outfit[def.garment.part] = { ...(partLayers ?? {}), [layerKey]: arg.item };
    },
  };

  const removeDef: EffectInstructionDef<{ item: string }> = {
    id: 'remove',
    schema: effectParamSchemas.remove,
    touch: (): TouchReport => ({ reads: [], writes: ['player.outfit', 'player.bag'] }),
    execute: (arg, ectx) => {
      let found: { part: string; layerKey: string } | undefined;
      for (const [part, layers] of Object.entries(ectx.draft.player.outfit)) {
        for (const [layerKey, wornItem] of Object.entries(layers)) {
          if (wornItem === arg.item) {
            found = { part, layerKey };
            break;
          }
        }
        if (found !== undefined) break;
      }
      if (found === undefined) {
        throw instructionError('remove', `物品 '${arg.item}' 未穿戴`, { item: arg.item });
      }
      // 卸下 = 层/部位键移除（immer remove patch）
      const restLayers = omitKey(
        ectx.draft.player.outfit[found.part] as { [layer: string]: string },
        found.layerKey,
      );
      if (Object.keys(restLayers).length === 0) {
        ectx.draft.player.outfit = omitKey(ectx.draft.player.outfit, found.part);
      } else {
        ectx.draft.player.outfit = {
          ...omitKey(ectx.draft.player.outfit, found.part),
          [found.part]: restLayers,
        };
      }
      addToBag(ectx.draft, arg.item, 1, 'remove');
    },
  };

  return [
    eraseDef(giveDef),
    eraseDef(takeDef),
    eraseDef(equipDef),
    eraseDef(unequipDef),
    eraseDef(wearDef),
    eraseDef(removeDef),
  ];
}
