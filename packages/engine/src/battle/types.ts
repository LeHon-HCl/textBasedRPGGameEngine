import type { EffectData, StatusInstance, TextKey } from '@game/shared';

/**
 * 战斗系统公共契约（detail-design §5.2，16 号；双人分工见 docs/plans/M2-stage2-battle-split.md）。
 *
 * 本文件是 **W0 冻结的稳定契约**（防重复劳动硬规则 3）：
 * - A 线（session/actions/resolution）与 B 线（damage/ai/status-tick/log）只经
 *   本文件协作——依赖方向单向（B 线不 import A 线实现文件）；
 * - 任何破坏性变更（改字段/改签名）必须另一位开发者 review 同意，宁加不改；
 * - DD-11：本文件与整个 battle/ 子系统**不 import 叙事模块**（narrative/），
 *   会话不读叙事栈、不直接改场景，结果由 `battle` 指令的后续路由消费。
 */

/** 八相位（§5.2 状态机图）：setup → turn_order →（await_player|resolving）→ round_end → 终局三态之一 */
export type BattlePhase =
  | 'setup'
  | 'turn_order'
  | 'await_player'
  | 'resolving'
  | 'round_end'
  | 'victory'
  | 'defeat'
  | 'escaped';

/** 参战单位（§5.2 BattleUnit）。ally 侧为 P2 预留（FR-XTRA-02），本里程碑不产出 AI 行为 */
export interface BattleUnit {
  uid: string;
  side: 'player' | 'enemy' | 'ally';
  nameKey: TextKey;
  hp: number;
  maxHp: number;
  /** 战斗内属性快照（atk/def/spd 等；spd 驱动行动序） */
  attrs: Record<string, number>;
  statuses: StatusInstance[];
  /** 玩家/敌方技能引用（结算子集指令的入口参数，W2 消费） */
  skills: SkillRef[];
  /** 敌方专用 AI 策略（§5.2；玩家单位必须缺省） */
  ai?: AiPolicy;
  /** 表现层立绘（DD-05；engine 只透传，不接触图像） */
  sprite?: string;
}

/** 技能引用（EncounterDef/单位声明面；结算语义归 W2，§5.2 结算管线） */
export interface SkillRef {
  id: string;
  /** 结算时传给效果子集的参数（伤害倍率、目标选择提示等；作者自定义） */
  params?: Readonly<Record<string, unknown>>;
}

/** AI 策略声明（§5.2 FR-CMBT-09；实现归 W4 damage/ai.ts） */
export type AiPolicy =
  | { kind: 'weighted'; entries: ReadonlyArray<{ weight: number; when?: string; action: AiActionSpec }> }
  | { kind: 'scripted'; sequence: ReadonlyArray<{ when?: string; action: AiActionSpec }> };

/** AI 可选行动（与 PlayerAction 同形，供决策输出） */
export type AiActionSpec =
  | { kind: 'skill'; skillId: string; targetUid?: string }
  | { kind: 'item'; itemId: string; targetUid?: string }
  | { kind: 'defend' };

/**
 * 玩家行动（§5.2 playerAction）。flee 由会话直接裁决（成功率 Rng 判定、
 * escapeRate 可配置），其余行动交结算管线（W2）。
 */
export type PlayerAction =
  | { kind: 'skill'; skillId: string; targetUid?: string }
  | { kind: 'item'; itemId: string; targetUid?: string }
  | { kind: 'defend' }
  | { kind: 'flee' };

/**
 * 伤害公式签名（§5.2：与 CheckRule 同级的可插拔预设，默认 `atk*mult − def`，
 * 作者可脚本注册覆盖）。**纯函数**：随机只经注入 Rng（DD-09）。
 * 实现归 W4 damage.ts；本文件只冻结签名。
 */
export interface DamageFn {
  (input: DamageInput, rng: import('@game/shared').Rng): DamageResult;
}

export interface DamageInput {
  /** 攻方结算面板值（atk 等快照） */
  attacker: Readonly<Record<string, number>>;
  /** 守方结算面板值（def 等；defend 行动的减免加成由调用方折算进 def） */
  defender: Readonly<Record<string, number>>;
  /** 技能倍率（SkillRef.params.mult 或作者表达式求值结果） */
  mult: number;
}

export interface DamageResult {
  /** 实际扣减 HP（≥ 0；会话统一入账并判倒下） */
  amount: number;
  /** 表现层数据（暴击标记/浮动说明等；自由结构） */
  detail?: Readonly<Record<string, unknown>>;
}

/**
 * 战斗日志条目（§5.2 FR-CMBT-10）：i18n 键 + 数值，可回看。
 * engine 不渲染——键的解析与展示归 runtime-ui（25B）。
 */
export interface BattleLogEntry {
  key: TextKey;
  /** 数值插值（伤害量/剩余 HP 等） */
  vars?: Readonly<Record<string, string | number>>;
  /** 条目产生时的相位（回看时按相位分组的依据） */
  phase: BattlePhase;
}

/**
 * 会话构造输入（设计 §5.2 签名的 W0 落地偏差，已登记 tasks/16-battle.md）：
 * 会话接受**已实例化的单位**——「EncounterDef/GameState → 单位」的实例化
 * （读玩家状态、模板参数化）是独立纯函数，归 W2/W6；会话本身保持纯内存
 * 状态机，会话级测试不依赖叙事（DD-11）。
 */
export interface BattleInit {
  player: BattleUnit;
  enemies: readonly BattleUnit[];
  /** 逃跑成功率（0–1；缺省 0.5，§5.2 可配置） */
  escapeRate?: number;
}

/** 终局结果（result() 的返回；rewards 结算归 W2 victory 路径） */
export interface BattleResult {
  outcome: 'victory' | 'defeat' | 'escaped';
  /** victory 时由 W2 填充：奖励 child 事务的结算出口 */
}
