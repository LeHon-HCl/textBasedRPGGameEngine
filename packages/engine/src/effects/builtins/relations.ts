import { effectParamSchemas } from '@game/shared';
import type { EffectRegistryOptions } from '../types.js';
import { eraseDef } from '../types.js';
import type { EffectInstructionDef, ErasedEffectDef, TouchReport } from '../types.js';
import { applyFavorChange } from '../../npcs/favor.js';
import { applyReputationChange } from '../../npcs/reputation.js';
import { evalNumberParam, instructionError } from './util.js';

/**
 * 关系类内置指令（设计 §3.3 / §4.6，FR-NPCR-02 / FR-NPCR-04；05 任务 B3、
 * 12 任务 3/6 落位 npcs 子系统纯机制）。
 *
 * - `favor`：好感变更唯一入口（§4.6）。收敛与阶段二分委托 `npcs/favor` 的
 *   {@link applyFavorChange}（未注入目录时不收敛）；阶段变化 emit
 *   `favor_stage_changed`（FR-NPCR-02）。未建档 NPC 自动建档（favor 自 0 起算、
 *   met 保持 false）；无好感系统的 NPC 只改数值；
 * - `reputation`：声望变更（faction.<id> 变量域的写入口）。收敛区间经
 *   options.reputationBounds 全局注入（FactionDef 无 min/max 字段，§4.6）；
 *   波段阈值表（FactionDef.thresholds）变化 emit `reputation_band_changed`
 *   （FR-NPCR-04）。阵营为封闭域（bootstrap 建档），未知阵营即 EFFECT_FAILED
 *   （与 rep() 求值口径一致，eval.ts）。
 */

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
      const change = applyFavorChange(options.npcs?.get(arg.npc)?.favor, record, amount);
      record.favor = change.favor;
      record.stage = change.stage;
      if (change.changed) {
        ectx.emit({
          type: 'favor_stage_changed',
          npc: arg.npc,
          from: change.from,
          to: change.to,
        });
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
      const thresholds = options.factions?.get(arg.faction)?.thresholds;
      const change = applyReputationChange(thresholds, bounds, current, amount);
      ectx.draft.factions[arg.faction] = change.value;
      if (change.changed) {
        ectx.emit({
          type: 'reputation_band_changed',
          faction: arg.faction,
          from: change.from,
          to: change.to,
        });
      }
    },
  };

  /**
   * `meet`：NPC 相识标记写入口（2026-09-21 人类裁定，独立指令形态）。
   * 语义要点：
   * - 幂等：已 met 再 meet 无副作用、不 emit（重复走同一场景不应刷事件）；
   * - 自动建档：与 favor 同款——未建档 NPC 先建 `{favor:0, met:false, flags:{}}`；
   * - 与 favor 的边界：favor 改好感不动 met（保持既有语义）；本指令只动 met。
   */
  const meetDef: EffectInstructionDef<{ npc: string }> = {
    id: 'meet',
    schema: effectParamSchemas.meet,
    touch: (): TouchReport => ({ reads: [], writes: ['npcs'] }),
    execute: (arg, ectx) => {
      const draft = ectx.draft;
      let record = draft.npcs[arg.npc];
      if (record === undefined) {
        record = { favor: 0, met: false, flags: {} };
        draft.npcs[arg.npc] = record;
      }
      if (record.met) return; // 幂等：已相识不重复 emit
      record.met = true;
      ectx.emit({ type: 'npc_met', npc: arg.npc });
    },
  };

  return [eraseDef(favorDef), eraseDef(reputationDef), eraseDef(meetDef)];
}
