import { describe, expect, it } from 'vitest';
import { createRng } from '@game/shared';
import {
  selectTarget,
  type TargetCandidate,
  type TargetingContext,
} from '../../src/battle/targeting.js';
import type { BattleUnit } from '../../src/battle/types.js';

/**
 * 目标选择（16 号 W6 子任务 10 前片，FR-CMBT-12 多敌人战斗）。
 *
 * 落点与动机：AI 行动缺 `targetUid` 时 W2 执行器视为「无目标增益」（#28 已
 * 向 A 方反馈）——本模块为**执行器回退**与 **AI 数据面缺省**提供统一的目标
 * 选择口径：
 * - 缺省策略（simple）：行动者阵营的对立面中**首个存活者**（声明序，确定性；
 *   单敌方场景显然正确，多敌方时作者可用数据面 targetUid 或 AI 策略显式指定）；
 * - 自身目标（heal 类）走 `side: 'self'` 显式声明；
 * - 全员倒下 → null（调用方显性化，不猜）。
 *
 * 纯函数、确定性（无随机——目标选择不消耗 DD-09 序列；「随机目标」类策略
 * 留作者扩展，不在内置面）。
 */

function unit(uid: string, side: BattleUnit['side'], hp = 10): BattleUnit {
  return {
    uid,
    side,
    nameKey: `actors.${uid}`,
    hp,
    maxHp: hp,
    attrs: {},
    statuses: [],
    skills: [{ id: 'strike' }],
  };
}

const ctx = (units: BattleUnit[]): TargetingContext => ({ units });

describe('selectTarget：缺省 simple 策略', () => {
  it('玩家行动（无 targetUid）→ 对立面（enemy）首个存活者', () => {
    const units = [unit('player', 'player'), unit('rat', 'enemy'), unit('bat', 'enemy')];
    const target = selectTarget('player', ctx(units));
    expect(target?.uid).toBe('rat'); // 声明序首个存活敌方
  });

  it('敌方行动（无 targetUid）→ 对立面（player/ally）首个存活者', () => {
    const units = [unit('player', 'player'), unit('rat', 'enemy'), unit('bat', 'enemy')];
    const target = selectTarget('rat', ctx(units));
    expect(target?.uid).toBe('player');
  });

  it('跳过已倒下者（hp ≤ 0 不入选）', () => {
    const units = [unit('player', 'player'), unit('rat', 'enemy', 0), unit('bat', 'enemy')];
    const target = selectTarget('player', ctx(units));
    expect(target?.uid).toBe('bat');
  });

  it('行动者自身不入候选（不打自己）', () => {
    const units = [unit('rat', 'enemy'), unit('bat', 'enemy', 0)];
    expect(selectTarget('rat', ctx(units))).toBeNull();
  });

  it('对立面全倒下 → null（调用方显性化；会话已判终局，此处防御）', () => {
    const units = [unit('player', 'player'), unit('rat', 'enemy', 0)];
    expect(selectTarget('rat', ctx(units))).toBeNull();
  });
});

describe('selectTarget：self 显式目标（heal 类）', () => {
  it("策略 'self' → 行动者自身（存活时）", () => {
    const units = [unit('player', 'player'), unit('rat', 'enemy')];
    const target = selectTarget('player', ctx(units), { strategy: 'self' });
    expect(target?.uid).toBe('player');
  });

  it("策略 'self' 且行动者已倒下 → null", () => {
    const units = [unit('player', 'player', 0)];
    expect(selectTarget('player', ctx(units), { strategy: 'self' })).toBeNull();
  });
});

describe('selectTarget：数据面显式 targetUid 优先（AI 策略声明的目标）', () => {
  it("candidates 中的 explicit 优先于缺省对立面（AI 数据面 'player' 约定落地）", () => {
    const units = [unit('player', 'player'), unit('rat', 'enemy'), unit('bat', 'enemy')];
    const candidates: readonly TargetCandidate[] = [{ explicit: 'bat' }];
    const target = selectTarget('player', ctx(units), { candidates });
    expect(target?.uid).toBe('bat');
  });

  it('explicit 引用已倒下者 → 忽略 explicit，回退缺省（不硬选尸体）', () => {
    const units = [unit('player', 'player'), unit('rat', 'enemy'), unit('bat', 'enemy', 0)];
    const target = selectTarget('player', ctx(units), { candidates: [{ explicit: 'bat' }] });
    expect(target?.uid).toBe('rat');
  });

  it('explicit 引用不存在 → 忽略，回退缺省', () => {
    const units = [unit('player', 'player'), unit('rat', 'enemy')];
    const target = selectTarget('player', ctx(units), { candidates: [{ explicit: 'ghost' }] });
    expect(target?.uid).toBe('rat');
  });
});

describe('targeting × resolution 回退联动（W6 接线，AI 缺 targetUid 的攻击不再落空）', () => {
  it('多敌方：AI 行动缺 targetUid → 执行器经 selectTarget 回退首个存活敌方（#28 反馈闭环）', async () => {
    const { createEffectExecutor } = await import('../../src/battle/resolution.js');
    const player = unit('player', 'player');
    const rat = unit('rat', 'enemy');
    const bat = unit('bat', 'enemy');
    const executor = createEffectExecutor({ damageFn: () => ({ amount: 3 }) });
    const outcome = executor(
      { kind: 'skill', skillId: 'strike' }, // 无 targetUid
      {
        actor: player,
        units: new Map([
          ['player', player],
          ['rat', rat],
          ['bat', bat],
        ]),
        rng: createRng(1),
      },
    );
    expect(outcome.damage).toEqual([{ uid: 'rat', amount: 3 }]);
  });

  it('无对立面存活：缺 targetUid 的技能保持自身增益面（A 方既有语义保留）', async () => {
    const { createEffectExecutor } = await import('../../src/battle/resolution.js');
    const hero = unit('hero', 'player');
    const executor = createEffectExecutor({ damageFn: () => ({ amount: 3 }) });
    const outcome = executor(
      { kind: 'skill', skillId: 'focus' },
      { actor: hero, units: new Map([['hero', hero]]), rng: createRng(1) },
    );
    expect(outcome.damage).toBeUndefined();
    expect(outcome.log).toContainEqual(
      expect.objectContaining({ key: 'battle.log.skill_nontarget' }),
    );
  });
});

describe('selectTarget：ally 阵营（P2 预留，语义就位）', () => {
  it('ally 行动者 → 对立面 enemy；无 enemy 时打不到任何目标', () => {
    const units = [unit('player', 'player'), unit('ally_1', 'ally'), unit('rat', 'enemy')];
    expect(selectTarget('ally_1', ctx(units))?.uid).toBe('rat');
    const noEnemy = [unit('player', 'player'), unit('ally_1', 'ally')];
    expect(selectTarget('ally_1', ctx(noEnemy))).toBeNull();
  });
});
