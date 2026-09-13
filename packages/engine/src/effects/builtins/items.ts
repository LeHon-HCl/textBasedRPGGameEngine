import { effectParamSchemas } from '@game/shared';
import type { GameId, ItemDef } from '@game/shared';
import type { WritableDraft } from 'immer';
import type { GameState } from '../../state/index.js';
import { bagGive, bagTake } from '../../items/index.js';
import type { EffectExecuteContext, EffectRegistryOptions } from '../types.js';
import { eraseDef } from '../types.js';
import type { EffectInstructionDef, ErasedEffectDef, TouchReport } from '../types.js';
import { evalNumberParam, instructionError } from './util.js';

/**
 * 物品类内置指令（设计 §3.3 give/take/equip/unequip/wear/remove；05 任务 B2，
 * 13 任务 2 起接入 Inventory 纯函数层与完整装备规则）。
 *
 * - 背包操作全部经 items/inventory.ts 纯函数（bagGive/bagTake）：堆叠封顶、
 *   容量按条目数计（新建条目校验）、失败即 EFFECT_FAILED（事务回滚）；
 * - equip（FR-ITEM-03 完整规则）：占用槽位 = 交换（现装备回收背包——容量不足
 *   整体失败，再穿新件）；equipMods 修正并入派生重算（state/derived.ts）；
 * - wear（FR-ITEM-04）：冲突规则（swappable 替换/拒绝）属 13 任务 3，本提交
 *   保持「占用即报错」；preset 应用属 13 任务 4；
 * - remove：按 itemId 查找穿戴位，清除后回收至背包；未穿戴即报错。
 */

/** 数量参数：非负整数（0 = 无操作，指令层短路；纯函数层要求 ≥ 1） */
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

/** 目录缺失时的合成定义（give/take 不依赖目录；按不可堆叠处理） */
function fallbackDef(itemId: GameId): ItemDef {
  return { id: itemId, nameKey: `items.${itemId}`, type: 'normal' };
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
      const def = items?.get(arg.item) ?? fallbackDef(arg.item);
      ectx.draft.player.bag = bagGive(ectx.draft.player.bag, def, count, options.bagCapacity);
    },
  };

  const takeDef: EffectInstructionDef<{ item: string; count?: string | number }> = {
    id: 'take',
    schema: effectParamSchemas.take,
    touch: (): TouchReport => ({ reads: [], writes: ['player.bag'] }),
    execute: (arg, ectx) => {
      const count = evalCountParam(ectx, 'take', arg.count);
      if (count === 0) return;
      ectx.draft.player.bag = bagTake(ectx.draft.player.bag, arg.item, count);
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
      // 占用槽位 = 交换：现装备先回收背包（容量不足 → EFFECT_FAILED 整体回滚），
      // 新件经 bagTake 消耗后穿上（FR-ITEM-03 完整规则，13 任务 2）
      const occupied = ectx.draft.player.equip[def.equipSlot];
      ectx.draft.player.bag = bagTake(ectx.draft.player.bag, arg.item, 1, 'equip');
      if (occupied !== undefined) {
        const oldDef = items?.get(occupied) ?? fallbackDef(occupied);
        ectx.draft.player.bag = bagGive(ectx.draft.player.bag, oldDef, 1, options.bagCapacity, 'equip');
      }
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
      // 卸下 = 槽位键移除（immer remove patch）+ 回收背包（容量校验经 bagGive）
      ectx.draft.player.equip = omitKey(ectx.draft.player.equip, arg.slot);
      const def = items?.get(current) ?? fallbackDef(current);
      ectx.draft.player.bag = bagGive(ectx.draft.player.bag, def, 1, options.bagCapacity, 'unequip');
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
      if (worn !== undefined && def.garment.swappable !== true) {
        // 冲突规则（§4.7，13 任务 3）：以新穿戴件的 swappable 为准——缺省拒绝
        throw instructionError(
          'wear',
          `部位 '${def.garment.part}' 第 ${layerKey} 层已被 '${worn}' 占用（新件不可替换，FR-ITEM-04）`,
          { part: def.garment.part, layer: layerKey },
        );
      }
      ectx.draft.player.bag = bagTake(ectx.draft.player.bag, arg.item, 1, 'wear');
      if (worn !== undefined) {
        // swappable 替换：旧件回收背包（容量不足 → EFFECT_FAILED 整体回滚）
        const oldDef = items?.get(worn) ?? fallbackDef(worn);
        ectx.draft.player.bag = bagGive(
          ectx.draft.player.bag,
          oldDef,
          1,
          options.bagCapacity,
          'wear',
        );
      }
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
      const def = items?.get(arg.item) ?? fallbackDef(arg.item);
      ectx.draft.player.bag = bagGive(ectx.draft.player.bag, def, 1, options.bagCapacity, 'unequip');
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
