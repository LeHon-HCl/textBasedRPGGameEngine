import { effectParamSchemas } from '@game/shared';
import { eraseDef } from '../types.js';
import type { EffectInstructionDef, ErasedEffectDef, TouchReport } from '../types.js';
import type { JumpTarget } from '../../runtime/exec-context.js';

/**
 * 商店指令（设计 §3.3 / §5.3，17 号；FR-ECON-02/03）。
 *
 * 与 `battle` 同款的 **jump 类指令**：只产出 `{type: 'shop', shop}` 跳转意图 +
 * `shop_open` 事件，**不改状态**——商店界面由宿主（runtime-ui 商店面板 / 编辑器
 * 试玩）经事件消费后调用 ShopService（§5.3）。这样引擎侧保持「不接触 UI」的
 * 边界（DD-05 同款哲学），交易事务仍走 ShopService 的原子事务。
 *
 * `shop` 引用存在性由加载期 crossRef 核对（refId('shop')，error 级）——
 * 与 battle.encounter 同款口径（约束 8：加载期完整性）。
 */

/** 商店类指令全集（id 固定，§3.3 表格） */
export function createShopDefs(): ErasedEffectDef[] {
  const shopDef: EffectInstructionDef<{ shop: string }> = {
    id: 'shop',
    schema: effectParamSchemas.shop,
    touch: (): TouchReport => ({ reads: [], writes: [] }),
    execute: (arg, ectx) => {
      // 事件携带 shopId：宿主打开商店界面的唯一入口（与 battle_start 同款通道）
      ectx.emit({ type: 'shop_open', shop: arg.shop });
    },
    jumps: (arg): readonly JumpTarget[] => [{ type: 'shop', shop: arg.shop }],
  };

  return [eraseDef(shopDef)];
}
