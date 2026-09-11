import { describe, expect, it } from 'vitest';
import { createRng, EngineError } from '@game/shared';
import { compileExpr } from '../../src/expr-eval/compile.js';
import { evalExpr } from '../../src/expr-eval/eval.js';
import { makeCtx, makeScope } from './fixtures.js';
import type { ExprScope } from '@game/shared';

/**
 * 03 任务 B2：变量域白名单映射（§2.3 表格逐项）+ 已知 root 缺 key 严格报错。
 *
 * 缺席语义遵循「封闭域严格、渐进域宽松」（ExprScope TSDoc / DD-01）：
 * - 封闭域（键集由内容定义、状态初始化全量建立）：attr / skill / body /
 *   faction / wallet / npc 实体 / quest 实体 / meta.points / time / loop
 *   —— 缺 key = 状态完整性问题 → EVAL_ERROR（可捕获拼写错误）；
 * - 渐进域（「尚不存在」是合法游玩状态）：flag / item 计数 / npc 自定义
 *   flag / outfit 穿戴位 / npc.stage / quest.stage / meta.perk —— 缺席返回
 *   定义值（undefined / 0 / null / false）。
 */

function evalOk(source: string, scope: ExprScope = makeScope()): unknown {
  return evalExpr(compileExpr(source, new Map()), makeCtx(scope, createRng(42)));
}

function evalExpectError(source: string, scope: ExprScope = makeScope()): EngineError {
  let captured: unknown;
  try {
    evalOk(source, scope);
  } catch (err) {
    captured = err;
  }
  expect(captured, `expected EVAL_ERROR for: ${source}`).toBeInstanceOf(EngineError);
  const err = captured as EngineError;
  expect(err.code).toBe('EVAL_ERROR');
  expect(err.where['expr']).toBe(source);
  return err;
}

describe('B2：§2.3 白名单逐域映射（root → 解析目标）', () => {
  it('attr / skill → state.player.attrs / skills', () => {
    expect(evalOk('attr.strength')).toBe(7);
    expect(evalOk('skill.sword.value')).toBe(5);
    expect(evalOk('skill.sword.exp')).toBe(10);
    expect(evalOk('attr.hp + skill.stealth.value')).toBe(33);
  });

  it('flag → state.world.flags（值域 boolean | number | string）', () => {
    expect(evalOk('flag.door_opened')).toBe(true);
    expect(evalOk('flag.chapter')).toBe(2);
    expect(evalOk('flag.title')).toBe('novice');
  });

  it('item → 物品计数（item.<id>.count 语法糖 ≡ count 数据源）', () => {
    expect(evalOk('item.potion.count')).toBe(3);
    expect(evalOk('item.key.count')).toBe(1);
    expect(evalOk('item.herb.count')).toBe(0);
  });

  it('outfit / body → state.player.outfit / body', () => {
    expect(evalOk('outfit.torso.cloth')).toBe('robe');
    expect(evalOk('body.build')).toBe('slim');
  });

  it('npc → state.npcs[id]（.favor / .stage / .met / 自定义 flag）', () => {
    expect(evalOk('npc.raven.favor')).toBe(7);
    expect(evalOk('npc.raven.stage')).toBe('warm');
    expect(evalOk('npc.raven.met')).toBe(true);
    expect(evalOk('npc.raven.flags.mood')).toBe('calm');
    expect(evalOk('npc.raven.mood')).toBe('calm');
  });

  it('faction → state.factions', () => {
    expect(evalOk('faction.mages')).toBe(12);
    expect(evalOk('faction.thieves')).toBe(-3);
  });

  it('time → state.world.time（.day / .weekday / .slot）', () => {
    expect(evalOk('time.day')).toBe(5);
    expect(evalOk('time.weekday')).toBe('sat');
    expect(evalOk('time.slot')).toBe('morning');
  });

  it('loop → state.loop', () => {
    expect(evalOk('loop')).toBe(2);
  });

  it('meta → Profile 只读投影（meta.points / meta.perk）', () => {
    expect(evalOk('meta.points')).toBe(15);
    expect(evalOk('meta.perk.iron_will')).toBe(true);
  });

  it('quest → state.quests（.state / .stage）', () => {
    expect(evalOk('quest.main.state')).toBe('active');
    expect(evalOk('quest.main.stage')).toBe('s1');
    expect(evalOk('quest.side_fishing.state')).toBe('done');
  });

  it('wallet → state.player.wallet（多货币）', () => {
    expect(evalOk('wallet.gold')).toBe(100);
    expect(evalOk('wallet.gems')).toBe(2);
  });

  it('白名单域可组合为条件表达式', () => {
    expect(evalOk('flag.door_opened && item.key.count >= 1 && npc.raven.met ? attr.hp : 0')).toBe(
      30,
    );
  });
});

describe('B2：封闭域缺 key 严格报错（已知 root，EVAL_ERROR）', () => {
  it.each([
    ['attr.typo_key', 'attr.typo_key', 'typo_key'],
    ['skill.typo_skill', 'skill.typo_skill', 'typo_skill'],
    ['skill.typo_skill.value', 'skill.typo_skill.value', 'typo_skill'],
    ['body.typo_part', 'body.typo_part', 'typo_part'],
    ['faction.typo_faction', 'faction.typo_faction', 'typo_faction'],
    ['wallet.typo_currency', 'wallet.typo_currency', 'typo_currency'],
    ['npc.ghost.favor', 'npc.ghost.favor', 'ghost'],
    ['npc.ghost.mood', 'npc.ghost.mood', 'ghost'],
    ['quest.ghost.state', 'quest.ghost.state', 'ghost'],
  ])('%s', (source, path, key) => {
    const err = evalExpectError(source);
    expect(err.messageKey).toBe('error.eval.missingKey');
    expect(err.where['path']).toBe(path);
    expect(err.where['key']).toBe(key);
  });

  it('标量域数据缺失同样严格报错（time / loop / meta.points 的防御兜底）', () => {
    const broken = {
      world: { flags: {}, time: {} },
      loop: undefined,
      meta: { points: undefined, purchasedPerks: [] },
    } as unknown as ExprScope;
    expect(evalExpectError('time.day', broken).where['key']).toBe('day');
    expect(evalExpectError('loop', broken).where['key']).toBe('loop');
    expect(evalExpectError('meta.points', broken).where['key']).toBe('points');
  });

  it('缺 key 错误在嵌套算术中同样抛出（拼写错误必然可见）', () => {
    const err = evalExpectError('attr.hp + attr.strengh');
    expect(err.messageKey).toBe('error.eval.missingKey');
    expect(err.where['key']).toBe('strengh');
  });
});

describe('B2：渐进域缺席语义（不报错，返回定义值）', () => {
  it('flag 未设置 → undefined（顶层条件真值化为假）', () => {
    expect(evalOk('flag.never_set')).toBeUndefined();
  });

  it('item 未持有 → 0', () => {
    expect(evalOk('item.never_owned.count')).toBe(0);
  });

  it('npc 自定义 flag 未设置 → undefined（实体存在时）', () => {
    expect(evalOk('npc.raven.flags.never_mood')).toBeUndefined();
    expect(evalOk('npc.sela.any_flag')).toBeUndefined();
  });

  it('outfit 未穿戴层 → null（实体部分存在时）', () => {
    expect(evalOk('outfit.head.any_layer')).toBeNull();
    expect(evalOk('outfit.torso.underwear')).toBeNull();
  });

  it('npc.stage 未达阶段 → undefined（schema 可选字段）', () => {
    expect(evalOk('npc.sela.stage')).toBeUndefined();
  });

  it('quest.stage 未进入阶段 → undefined', () => {
    expect(evalOk('quest.side_fishing.stage')).toBeUndefined();
  });

  it('meta.perk 未购买 → false', () => {
    expect(evalOk('meta.perk.never_perk')).toBe(false);
  });

  it('渐进域缺席值进入算术仍严格报错（真值化不蔓延到算术语境）', () => {
    expect(evalExpectError('flag.never_set + 1').messageKey).toBe('error.eval.typeMismatch');
    expect(evalExpectError('item.never_owned.count / 0').messageKey).toBe(
      'error.eval.divisionByZero',
    );
  });
});
