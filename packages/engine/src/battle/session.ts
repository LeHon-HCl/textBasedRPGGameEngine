import { EngineError, type Rng } from '@game/shared';
import { actionError, validateAction, type ActionValidationContext } from './actions.js';
import { computeTurnOrder } from './turn-queue.js';
import type {
  AiActionSpec,
  BattleInit,
  BattleLogEntry,
  BattlePhase,
  BattleResult,
  BattleUnit,
  PlayerAction,
} from './types.js';

/**
 * BattleSession——独立战斗会话状态机（detail-design §5.2，16 号 W0 骨架）。
 *
 * - **纯内存状态机**（DD-11）：不读叙事栈、不直接改场景、不依赖 narrative/；
 *   构造接受已实例化单位（BattleInit），「EncounterDef/GameState → 单位」的
 *   实例化归 W2/W6 纯函数（偏差登记见 tasks/16-battle.md）；
 * - **八相位**（§5.2 状态机图）：setup → turn_order →（await_player | resolving）
 *   → round_end → victory/defeat/escaped；本类只管相位迁移与终局判定，
 *   行动结算走注入的 `executeAction` 缝（W2 提供真实管线，W0 测试用桩），
 *   敌方决策走 `aiResolve` 缝（W4 提供 weighted/scripted，W0 测试用桩）；
 * - 逃跑由会话直接裁决（成功率 escapeRate 经 Rng，可配置），成功在 round_end
 *   收敛为 escaped 终局；
 * - 行动序：spd 降序，平局组经 Rng 洗牌（DD-09 确定性）；
 * - 相位违例（非法迁移）一律 EFFECT_FAILED 显性化，不静默容错。
 */

/** 单次行动的结算出口（W2 真实管线与 W0 测试桩的共同形状） */
export interface ActionOutcome {
  /** 目标伤害（会话统一入账 HP 并判倒下；amount ≥ 0） */
  damage?: readonly { uid: string; amount: number }[];
  /** 结算日志（会话按相位归位） */
  log?: readonly BattleLogEntry[];
}

/** 会话注入面（缝）：W0 测试桩 / W2 结算管线 / W4 AI 实现各自装配 */
export interface BattleSessionOptions {
  /** 全部随机（行动序平局洗牌、逃跑判定）的唯一来源（DD-09） */
  rng: Rng;
  /** 敌方行动解析：AI 决策只用会话内状态（§5.2，无隐藏信息） */
  aiResolve: (unit: BattleUnit) => AiActionSpec;
  /** 行动结算管线（skill/item；defend/flee 由会话自理） */
  executeAction: (action: PlayerAction | AiActionSpec, actor: BattleUnit) => ActionOutcome;
  /** 行动校验上下文（W1；物品持有缝等，缺省 = item 行动一律拒绝） */
  validation?: ActionValidationContext;
}

/** beginTurn 的返回：本回合行动方与相位（await_player = 等玩家输入） */
export interface TurnStart {
  phase: Extract<BattlePhase, 'await_player' | 'resolving'>;
  actorUid: string;
}

const ESCAPE_RATE_DEFAULT = 0.5;

export class BattleSession {
  #phase: BattlePhase = 'setup';
  readonly #units: Map<string, BattleUnit>;
  readonly #order: string[] = [];
  readonly #log: BattleLogEntry[] = [];
  readonly #rng: Rng;
  readonly #aiResolve: BattleSessionOptions['aiResolve'];
  readonly #executeAction: BattleSessionOptions['executeAction'];
  readonly #escapeRate: number;
  readonly #validation: ActionValidationContext;
  /** 本回合 fleeing 标记（round_end 收敛 escaped 的依据） */
  #fledThisTurn = false;
  #result: BattleResult | null = null;

  constructor(init: BattleInit, options: BattleSessionOptions) {
    this.#rng = options.rng;
    this.#aiResolve = options.aiResolve;
    this.#executeAction = options.executeAction;
    this.#escapeRate = init.escapeRate ?? ESCAPE_RATE_DEFAULT;
    this.#validation = options.validation ?? {};
    if (init.escapeRate !== undefined && (init.escapeRate < 0 || init.escapeRate > 1)) {
      throw new EngineError({
        code: 'EFFECT_FAILED',
        where: { op: 'battle', detail: `escapeRate 须在 [0,1]，实际 ${init.escapeRate}` },
        messageKey: 'error.effects.instructionFailed',
      });
    }
    this.#units = new Map(
      [init.player, ...init.enemies].map((unit) => [
        unit.uid,
        { ...unit, statuses: [...unit.statuses] },
      ]),
    );
    this.#pushLog('battle.log.setup');
    // setup → turn_order：单位初始化完成，计算首回合行动序（§5.2 开场）
    this.#enterTurnOrder();
  }

  // —— 只读投影（§5.2 公共 API） ——

  phase(): BattlePhase {
    return this.#phase;
  }

  units(): readonly BattleUnit[] {
    return [...this.#units.values()];
  }

  /** 本回合剩余行动序（uid；spd 降序、平局 Rng 洗牌、已倒下者剔除） */
  turnQueue(): readonly string[] {
    return [...this.#order];
  }

  log(): readonly BattleLogEntry[] {
    return [...this.#log];
  }

  result(): BattleResult | null {
    return this.#result;
  }

  // —— 相位驱动 ——

  /**
   * turn_order 起始：弹出队首决定本回合行动方。
   * 玩家侧 → await_player（等 playerAction）；敌方侧 → resolving（AI 决策并
   * 同步结算至 round_end 收敛）。队列中已倒下者跳过。
   */
  beginTurn(): TurnStart {
    this.#assertPhase('turn_order', 'beginTurn');
    while (this.#order.length > 0) {
      const uid = this.#order.shift() as string;
      const unit = this.#units.get(uid) as BattleUnit;
      if (unit.hp <= 0) continue; // 回合中倒下者跳过其行动
      if (unit.side === 'enemy') {
        this.#phase = 'resolving';
        const action = this.#aiResolve(unit);
        this.#resolveAndSettle(action, unit);
        this.#settleRoundEnd();
        return { phase: 'resolving', actorUid: uid };
      }
      this.#phase = 'await_player';
      return { phase: 'await_player', actorUid: uid };
    }
    // 空队列（全员倒下应已被终局收敛拦截；防御性兜底回新回合）
    this.#enterTurnOrder();
    return this.beginTurn();
  }

  /** await_player → resolving：结算玩家行动（§5.2 playerAction） */
  playerAction(action: PlayerAction): void {
    this.#assertPhase('await_player', 'playerAction');
    const player = this.#playerUnit();
    // 合法性在消耗回合之前判定（W1）：非法 → EFFECT_FAILED，相位不变
    const rejection = validateAction(action, player, this.units(), this.#validation);
    if (rejection !== undefined) throw actionError(rejection);
    this.#phase = 'resolving';
    if (action.kind === 'flee') {
      // 逃跑由会话裁决：成功率 escapeRate 经 Rng（§5.2 可配置）
      this.#fledThisTurn = this.#rng.chance(this.#escapeRate);
      this.#pushLog(this.#fledThisTurn ? 'battle.log.escape_success' : 'battle.log.escape_fail', {
        actor: player.nameKey,
      });
    } else if (action.kind === 'defend') {
      // 防御：会话内置语义（W1）——置位持续到下一轮开始，减免归 DamageFn（B 线）
      player.defending = true;
      this.#pushLog('battle.log.defend', { actor: player.nameKey });
    } else {
      this.#resolveAndSettle(action, player);
    }
    this.#settleRoundEnd();
  }

  // —— 内部：相位迁移 ——

  #resolveAndSettle(action: PlayerAction | AiActionSpec, actor: BattleUnit): void {
    const outcome = this.#executeAction(action, actor);
    for (const entry of outcome.log ?? []) this.#log.push({ ...entry, phase: 'resolving' });
    for (const hit of outcome.damage ?? []) {
      const target = this.#units.get(hit.uid);
      if (target === undefined) continue;
      target.hp = Math.max(0, target.hp - hit.amount);
      this.#pushLog('battle.log.damage', {
        actor: actor.nameKey,
        target: target.nameKey,
        amount: hit.amount,
      });
      if (target.hp <= 0) {
        this.#pushLog('battle.log.down', { target: target.nameKey });
        // 即时剔除本回合队列中的死者（已行动完的自然不在队列里，删除是无操作）
        const index = this.#order.indexOf(target.uid);
        if (index >= 0) this.#order.splice(index, 1);
      }
    }
    // resolving → round_end：行动结算完成（状态 tick 缝在 W5 接入本相位）
    this.#phase = 'round_end';
  }

  /** round_end 收敛：victory / escaped / defeat / 回 turn_order（§5.2 图） */
  #settleRoundEnd(): void {
    if (this.#allDown('enemy')) {
      this.#terminal('victory', 'battle.log.victory');
      return;
    }
    if (this.#fledThisTurn) {
      this.#fledThisTurn = false;
      this.#terminal('escaped', 'battle.log.escaped');
      return;
    }
    if (this.#allDown('player') || this.#allDown('ally')) {
      this.#terminal('defeat', 'battle.log.defeat');
      return;
    }
    // 胜负未分 → turn_order：**延续本轮剩余行动序**（round_end 是单次行动的
    // 收敛点，§5.2 图）；本轮队列耗尽后由 beginTurn 惰性开启新一轮（重算行动序）
    this.#phase = 'turn_order';
  }

  #terminal(outcome: BattleResult['outcome'], key: string): void {
    this.#pushLog(key as BattleLogEntry['key']);
    this.#phase = outcome;
    this.#result = { outcome };
  }

  /** 回合开始：重算行动序（计算归 turn-queue.ts 纯函数）并清理上一轮防御态 */
  #enterTurnOrder(): void {
    // 防御只持续到下一轮开始（FR-CMBT-08 回合制语义）
    for (const unit of this.#units.values()) unit.defending = false;
    const order = computeTurnOrder([...this.#units.values()], this.#rng);
    this.#order.length = 0;
    this.#order.push(...order);
    this.#phase = 'turn_order';
  }

  #allDown(side: BattleUnit['side']): boolean {
    const units = [...this.#units.values()].filter((unit) => unit.side === side);
    return units.length > 0 && units.every((unit) => unit.hp <= 0);
  }

  #playerUnit(): BattleUnit {
    const player = [...this.#units.values()].find((unit) => unit.side === 'player');
    if (player === undefined) {
      throw new EngineError({
        code: 'INTERNAL',
        where: { op: 'battle', detail: '会话缺少玩家单位' },
        messageKey: 'error.internal',
      });
    }
    return player;
  }

  #pushLog(key: BattleLogEntry['key'], vars?: Record<string, string | number>): void {
    this.#log.push({ key, ...(vars !== undefined ? { vars } : {}), phase: this.#phase });
  }

  #assertPhase(expected: BattlePhase, caller: string): void {
    if (this.#phase !== expected) {
      throw new EngineError({
        code: 'EFFECT_FAILED',
        where: {
          op: 'battle',
          detail: `${caller} 要求相位 ${expected}，实际 ${this.#phase}`,
        },
        messageKey: 'error.effects.instructionFailed',
      });
    }
  }
}
