import { describe, expect, it } from 'vitest';
import {
  aiPolicySchema,
  encounterDefSchema,
  enemyDefSchema,
  skillRefSchema,
} from '../../src/index.js';

/**
 * 战斗数据域 schema（设计 §5.2 回填，16 号；proposal §5.10 FR-CMBT-07/09/12）。
 *
 * 设计缺口回填说明：§5.2 的 BattleSession 收 `EncounterDef`、`battle` 指令以 id
 * 引用遭遇，但 §2.4 schema 清单漏列该域——本文件按设计意图补齐数据面：
 * - EnemyDef（data/enemies.yaml 单文件数组域）：敌人 = HP/属性快照/技能表/AI/立绘；
 * - EncounterDef（data/encounters.yaml 单文件数组域）：遭遇 = 敌方队伍（FR-CMBT-12
 *   多人，允许重复 id 出现）+ 开场/回合/胜负文本键 + 逃跑率覆盖 + 奖励效果序列；
 * - SkillRef / AiPolicy（§5.2 注释级引用的形态落地；效果绑定面待 16 号 W2 裁定，
 *   additive 预留）。
 *
 * 引用种类（§2.1）：enemy / encounter 两个新 RefKind——crossRef 悬空核对归 06 号。
 */

describe('skillRefSchema：技能引用（§5.2 SkillRef 形态落地）', () => {
  it('id + 可选 params（宽松字面量/表达式值）', () => {
    expect(skillRefSchema.safeParse({ id: 'bite' }).success).toBe(true);
    expect(skillRefSchema.safeParse({ id: 'bite', params: { mult: 1.5, note: 'x' } }).success).toBe(
      true,
    );
  });

  it('附加效果（effects）可选声明：战斗子集指令序列（裁定 2026-09-19）', () => {
    expect(
      skillRefSchema.safeParse({
        id: 'heal_pulse',
        effects: [{ money: { currency: 'silver', amount: 1 } }],
      }).success,
    ).toBe(true);
    // effects 非数组 → 拒绝
    expect(skillRefSchema.safeParse({ id: 'x', effects: 'nope' }).success).toBe(false);
  });

  it('缺 id 或未知字段 → 拒绝', () => {
    expect(skillRefSchema.safeParse({}).success).toBe(false);
    expect(skillRefSchema.safeParse({ id: 'bite', extra: 1 }).success).toBe(false);
  });
});

describe('aiPolicySchema：weighted / scripted 双策略（FR-CMBT-09）', () => {
  it('weighted：权重 + 可选 when 条件 + 行动', () => {
    expect(
      aiPolicySchema.safeParse({
        kind: 'weighted',
        entries: [{ weight: 3, when: 'attr.hp < 5', action: { kind: 'skill', skillId: 'bite' } }],
      }).success,
    ).toBe(true);
  });

  it('scripted：表达式序列（首个满足者）', () => {
    expect(
      aiPolicySchema.safeParse({
        kind: 'scripted',
        sequence: [
          { when: 'enemy.hp < 3', action: { kind: 'skill', skillId: 'frenzy' } },
          { action: { kind: 'defend' } },
        ],
      }).success,
    ).toBe(true);
  });

  it('item 行动引用物品（refKind item）；未知 kind → 拒绝', () => {
    expect(
      aiPolicySchema.safeParse({
        kind: 'weighted',
        entries: [{ weight: 1, action: { kind: 'item', itemId: 'warm_bun' } }],
      }).success,
    ).toBe(true);
    expect(aiPolicySchema.safeParse({ kind: 'aggressive', entries: [] }).success).toBe(false);
  });

  it('空 entries / 空 sequence → 拒绝（AI 必须有候选行动）', () => {
    expect(aiPolicySchema.safeParse({ kind: 'weighted', entries: [] }).success).toBe(false);
    expect(aiPolicySchema.safeParse({ kind: 'scripted', sequence: [] }).success).toBe(false);
  });
});

describe('enemyDefSchema：敌人定义（FR-CMBT-07）', () => {
  const VALID = {
    id: 'rat',
    nameKey: 'enemies.rat.name',
    hp: 12,
    attrs: { atk: 4, def: 1, spd: 6 },
    skills: [{ id: 'bite', params: { mult: 1 } }],
  };

  it('最小正例', () => {
    expect(enemyDefSchema.safeParse(VALID).success).toBe(true);
  });

  it('ai（双策略任一）与 sprite（media 引用）可选', () => {
    expect(
      enemyDefSchema.safeParse({
        ...VALID,
        ai: {
          kind: 'weighted',
          entries: [{ weight: 1, action: { kind: 'skill', skillId: 'bite' } }],
        },
        sprite: 'sprite_rat',
      }).success,
    ).toBe(true);
  });

  it('hp < 1 / 空 skills / 未知字段 → 拒绝', () => {
    expect(enemyDefSchema.safeParse({ ...VALID, hp: 0 }).success).toBe(false);
    expect(enemyDefSchema.safeParse({ ...VALID, skills: [] }).success).toBe(false);
    expect(enemyDefSchema.safeParse({ ...VALID, loot: 'x' }).success).toBe(false);
  });
});

describe('encounterDefSchema：遭遇定义（FR-CMBT-07/12）', () => {
  const VALID = {
    id: 'enc_sewer_rats',
    enemies: ['rat', 'rat'],
    openingKey: 'encounters.sewer.opening',
    victoryKey: 'encounters.sewer.victory',
    defeatKey: 'encounters.sewer.defeat',
  };

  it('最小正例：敌方队伍（允许重复 id = 多只同种敌人）+ 开场/胜负文本键', () => {
    expect(encounterDefSchema.safeParse(VALID).success).toBe(true);
  });

  it('全量形态：回合键/逃跑键/逃跑率覆盖/奖励效果序列', () => {
    expect(
      encounterDefSchema.safeParse({
        ...VALID,
        roundKey: 'encounters.sewer.round',
        escapeKey: 'encounters.sewer.escape',
        escapeRate: 0.6,
        rewards: [{ money: { currency: 'silver', amount: '10 + 2' } }],
      }).success,
    ).toBe(true);
  });

  it('escapeRate 越界（<0 或 >1）→ 拒绝', () => {
    expect(encounterDefSchema.safeParse({ ...VALID, escapeRate: 1.5 }).success).toBe(false);
    expect(encounterDefSchema.safeParse({ ...VALID, escapeRate: -0.1 }).success).toBe(false);
  });

  it('空敌方队伍 → 拒绝；缺胜负文本键 → 拒绝', () => {
    expect(encounterDefSchema.safeParse({ ...VALID, enemies: [] }).success).toBe(false);
    expect(
      encounterDefSchema.safeParse({
        ...VALID,
        victoryKey: undefined,
        defeatKey: undefined,
      }).success,
    ).toBe(false);
  });
});
