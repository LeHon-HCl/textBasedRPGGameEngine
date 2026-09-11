import { effectParamSchemas } from '@game/shared';
import type { EffectRegistryOptions } from '../types.js';
import { eraseDef } from '../types.js';
import type { EffectInstructionDef, ErasedEffectDef, TouchReport } from '../types.js';
import { evalNumberParam, instructionError } from './util.js';

/**
 * 关系类内置指令（设计 §3.3 / §4.6，FR-NPCR-02 / FR-NPCR-04；05 任务 B3）。
 *
 * - `favor`：好感变更唯一入口（§4.6）。收敛区间取 NPC 目录 FavorDef{min,max}
 *   （未注入目录时不收敛）；阶段阈值表（FavorDef.stages，按 at 升序二分）驱动
 *   stage 更新，阶段变化 emit `favor_stage_changed`（FR-NPCR-02）。未建档 NPC
 *   自动建档（favor 自 0 起算、met 保持 false）；无好感系统的 NPC 只改数值；
 * - `reputation`：声望变更（faction.<id> 变量域的写入口）。收敛区间经
 *   options.reputationBounds 全局注入（FactionDef 无 min/max 字段，§4.6）；
 *   波段阈值表（FactionDef.thresholds）变化 emit `reputation_band_changed`
 *   （FR-NPCR-04）。阵营为封闭域（bootstrap 建档），未知阵营即 EFFECT_FAILED
 *   （与 rep() 求值口径一致，eval.ts）。
 */

/** 阈值表条目形状（FavorStage / FactionThreshold 的公共切片） */
interface ThresholdEntry {
  readonly id: string;
  readonly at: number;
}

/**
 * 阈值表二分定位（§4.6「阈值表二分」）：返回 at ≤ value 的最后一档；
 * 表不依赖声明顺序（内部按 at 升序排序后二分）。
 */
function thresholdFor<T extends ThresholdEntry>(
  thresholds: readonly T[],
  value: number,
): T | undefined {
  const sorted = [...thresholds].sort((a, b) => a.at - b.at);
  let low = 0;
  let high = sorted.length - 1;
  let hit = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((sorted[mid] as T).at <= value) {
      hit = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return hit >= 0 ? sorted[hit] : undefined;
}

/** 收敛到 [min, max]（clamp 语义，与内置函数 clamp() 同口径） */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 关系类指令全集（id 固定，§3.3 表格） */
export function createRelationDefs(options: EffectRegistryOptions): ErasedEffectDef[] {
  const favorDef: EffectInstructionDef<{ npc: string; amount: string | number }> = {
    id: 'favor',
    schema: effectParamSchemas.favor,
    touch: (): TouchReport => ({ reads: [], writes: ['npcs'] }),
    execute: (arg, ectx) => {
      const amount = evalNumberParam(ectx, 'favor', 'amount', arg.amount);
      const draft = ectx.draft;
      let record = draft.npcs[arg.npc];
      if (record === undefined) {
        record = { favor: 0, met: false, flags: {} };
        draft.npcs[arg.npc] = record;
      }
      const favor = options.npcs?.get(arg.npc)?.favor;
      const next =
        favor !== undefined
          ? clamp(record.favor + amount, favor.min, favor.max)
          : record.favor + amount;
      const fromStage = record.stage;
      let toStage = fromStage;
      if (favor !== undefined && favor.stages.length > 0) {
        toStage = thresholdFor(favor.stages, next)?.id;
        record.stage = toStage;
      }
      record.favor = next;
      if (toStage !== fromStage) {
        ectx.emit({ type: 'favor_stage_changed', npc: arg.npc, from: fromStage, to: toStage });
      }
    },
  };

  const reputationDef: EffectInstructionDef<{ faction: string; amount: string | number }> = {
    id: 'reputation',
    schema: effectParamSchemas.reputation,
    touch: (): TouchReport => ({ reads: [], writes: ['factions'] }),
    execute: (arg, ectx) => {
      const amount = evalNumberParam(ectx, 'reputation', 'amount', arg.amount);
      const current = ectx.draft.factions[arg.faction];
      if (current === undefined) {
        throw instructionError(
          'reputation',
          `未知阵营 '${arg.faction}'（封闭域，新档由 bootstrap 建档）`,
          { faction: arg.faction },
        );
      }
      const bounds = options.reputationBounds;
      const next =
        bounds !== undefined ? clamp(current + amount, bounds.min, bounds.max) : current + amount;
      const thresholds = options.factions?.get(arg.faction)?.thresholds;
      const fromBand = thresholds !== undefined ? thresholdFor(thresholds, current)?.id : undefined;
      const toBand = thresholds !== undefined ? thresholdFor(thresholds, next)?.id : undefined;
      ectx.draft.factions[arg.faction] = next;
      if (thresholds !== undefined && thresholds.length > 0 && toBand !== fromBand) {
        ectx.emit({
          type: 'reputation_band_changed',
          faction: arg.faction,
          from: fromBand,
          to: toBand,
        });
      }
    },
  };

  return [eraseDef(favorDef), eraseDef(reputationDef)];
}
